import { build } from 'esbuild'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createDatabase, seedUsers, owner, other } from './database.mjs'

export async function startHarness({ port = 0 } = {}) {
  const db = await createDatabase(); await seedUsers(db)
  const directory = mkdtempSync(join(tmpdir(),'intelinside-agent-api-'))
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../src/agent-api/server.ts',import.meta.url))], bundle:true, write:false, platform:'node', format:'cjs', logLevel:'silent' })
  const compiled = join(directory,'server.cjs'); writeFileSync(compiled,bundle.outputFiles[0].contents)
  const { createHandler, hashKey } = (await import(pathToFileURL(compiled))).default
  let origin
  const sessions = { 'alice-test-session': owner, 'bob-test-session': other }
  const uploadGrants = new Map()
  const backend = {
    async user(token) { return sessions[token] ?? null },
    async rpc(name, params) {
      const names = { agent_request: ['p_token_hash','p_action','p_params','p_request_key'], manage_agent_keys:['p_user_id','p_action','p_data'] }
      if (!names[name]) throw new Error('Unexpected RPC')
      try {
        // Exercise EXECUTE grants using the same role as the hosted backend.
        await db.exec('set role service_role')
        const values = names[name].map((field) => params[field] ?? (field === 'p_data' ? {} : null))
        const result = await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as result`,values)
        return { data:result.rows[0].result, error:null }
      } catch(error) { return {data:null,error:{code:error.code,message:error.message}} }
      finally { await db.exec('reset role') }
    },
    async signedUpload(path) { const grant=crypto.randomUUID(); uploadGrants.set(grant,path); return `${origin}/storage-upload/${grant}` },
    photoUrl(path) { return `${origin}/storage/v1/object/public/rig-photos/${path}` },
  }
  const handler = createHandler(()=>backend)
  // One connection represents one hosted RPC transaction at a time. Keep role
  // setup and teardown isolated between parallel test HTTP requests.
  let queue = Promise.resolve()
  const server = createServer((req,res)=>{
    const run = async()=>{
      const url=new URL(req.url,origin)
      res.setHeader('access-control-allow-origin','http://127.0.0.1:5173')
      res.setHeader('access-control-allow-headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version')
      res.setHeader('access-control-allow-methods','GET,POST,PUT,DELETE,OPTIONS')
      if(req.method==='OPTIONS'){res.statusCode=204;res.end();return}
      if(url.pathname==='/auth/v1/user') {
        const userId=sessions[(req.headers.authorization??'').replace('Bearer ','')]
        res.setHeader('content-type','application/json'); res.statusCode=userId?200:401
        res.end(JSON.stringify(userId?{id:userId,aud:'authenticated',role:'authenticated',email:'alice@example.test',created_at:new Date().toISOString(),user_metadata:{user_name:userId===owner?'alice':'bob'},app_metadata:{provider:'github'}}:{message:'Invalid session'}));return
      }
      if(url.pathname.startsWith('/storage-upload/') && req.method==='PUT') {
        const path=uploadGrants.get(url.pathname.split('/')[2])
        if(!path) {res.statusCode=403;res.end();return}
        const chunks=[];for await(const chunk of req) chunks.push(chunk)
        try {await db.query(`insert into storage.objects(bucket_id,name,metadata) values ('rig-photos',$1,$2)`,[path,{size:Buffer.concat(chunks).length,mimetype:req.headers['content-type']}]);res.end('{}')}
        catch {res.statusCode=409;res.end('{}')}
        return
      }
      if(url.pathname.startsWith('/rest/v1/')) {res.setHeader('content-type','application/json');res.end('[]');return}
      const init={method:req.method,headers:req.headers}
      if(!['GET','HEAD'].includes(req.method)) {init.body=Readable.toWeb(req);init.duplex='half'}
      const response=await handler(new Request(url,init))
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
    }
    queue=queue.then(run).catch((error)=>{res.statusCode=500;res.end(JSON.stringify({error:error.message}))})
  })
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`
  return {db,origin,handler,hashKey,backend,async close(){await new Promise(resolve=>server.close(resolve));await db.close();rmSync(directory,{recursive:true,force:true})}}
}
