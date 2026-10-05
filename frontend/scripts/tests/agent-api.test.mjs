import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { startHarness } from '../agent-api/harness.mjs'
import { owner, other } from '../agent-api/database.mjs'
let h, key, bob, rig, runtime, result
let counter=0
const rigInput={name:'Panther Lake Lab',os:'Linux',components:[{hardwareId:'intel-core-ultra-x7-358h',quantity:11},{hardwareId:'intel-arc-b390',quantity:1}]}
const buildInput={runtimeId:'llamacpp',name:'Fleet experimental build',repoUrl:'https://github.com/example/runtime',summary:'Experimental fleet build'}
const resultInput=()=>({rigId:rig.id,modelId:'qwen3-8b',quant:'q4_k_m',runtimeId:'llamacpp',runtimeVersion:'test',customRuntimeId:runtime.id,revision:'abc123',decodeTps:7.959989,runDate:'2026-09-27'})
async function call(path,{method='GET',body,token=key?.key,idem,version,headers={}}={}) {
 const response=await fetch(h.origin+path,{method,headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(method!=='GET'?{'idempotency-key':idem??`test-${++counter}`} : {}),...(body?{'content-type':'application/json'} : {}),...(version?{'x-expected-version':version} : {}),...headers},...(body?{body:JSON.stringify(body)} : {})})
 return {status:response.status,body:await response.json(),headers:response.headers}
}
async function createKey(session='alice-test-session',scopes=['read','write','community'],name='Test agent') {
 const r=await call('/api/keys',{method:'POST',token:session,body:{name,scopes}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body
}
const okay=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body}
before(async()=>{h=await startHarness(); key=await createKey();bob=await createKey('bob-test-session')})
after(async()=>{await h?.close()})

test('keys are displayed once, hashed at rest, isolated, and cannot mint other keys',async()=>{
 assert.match(key.key,/^ii_[A-Za-z0-9_-]{43}$/)
 const stored=(await h.db.query('select * from private.agent_keys where id=$1',[key.id])).rows[0]
 assert.equal(stored.token_hash,h.hashKey(key.key));assert.ok(!JSON.stringify(stored).includes(key.key))
 const listed=okay(await call('/api/keys',{token:'alice-test-session'}))
 assert.equal(listed.items.length,1);assert.equal(listed.items[0].name,'Test agent');assert.ok(!JSON.stringify(listed).includes('tokenHash'));assert.ok(!JSON.stringify(listed).includes(key.key))
 assert.equal((await call('/api/keys',{token:key.key})).status,401)
 assert.equal((await call(`/api/keys/${key.id}`,{method:'DELETE',token:'bob-test-session'})).status,404)
 assert.equal(okay(await call('/api/v1/me')).id,owner)
 assert.equal((await call('/api/v1/me',{token:'invalid'})).status,401)
 assert.equal((await call('/api/v1/me',{token:null})).status,401)
})

test('catalog lookup, eleven-node rig, build, atomic result batch, and stable URLs work over HTTP',async()=>{
 const catalog=okay(await call('/api/v1/catalog',{token:null}));assert.ok(catalog.hardware.some(x=>x.id===rigInput.components[0].hardwareId))
 rig=okay(await call('/api/v1/rigs',{method:'POST',body:rigInput}),201)
 assert.equal(rig.ownerId,owner);assert.equal(rig.components.find(x=>x.hardwareId==='intel-arc-b390').quantity,11);assert.equal(rig.url,`/rigs/${rig.id}`)
 runtime=okay(await call('/api/v1/custom-runtimes',{method:'POST',body:buildInput}),201)
 const batch=okay(await call('/api/v1/results/batch',{method:'POST',body:{items:[resultInput(),{...resultInput(),decodeTps:60.286375,batchSize:88}]},idem:'batch-workflow'}),201)
 result=batch.items[0];assert.equal(result.submitterId,owner);assert.equal(result.decodeTps,7.959989);assert.equal(batch.items.length,2)
 const retry=okay(await call('/api/v1/results/batch',{method:'POST',body:{items:[resultInput(),{...resultInput(),decodeTps:60.286375,batchSize:88}]},idem:'batch-workflow'}),201)
 assert.deepEqual(retry,batch)
 assert.equal((await call('/api/v1/results/batch',{method:'POST',body:{items:[resultInput()]},idem:'batch-workflow'})).status,409)
 assert.equal(okay(await call('/api/v1/rigs?owner=me')).items.length,1)
 assert.equal(okay(await call('/api/v1/rigs?owner=me',{token:bob.key})).items.length,0)
})

test('failed batches roll back earlier results and allow a corrected retry',async()=>{
 const before=(await h.db.query('select count(*)::int n from public.results')).rows[0].n
 const r=await call('/api/v1/results/batch',{method:'POST',body:{items:[resultInput(),{...resultInput(),rigId:'99999'}]},idem:'failed-batch'})
 assert.ok([403,409].includes(r.status),JSON.stringify(r));assert.equal((await h.db.query('select count(*)::int n from public.results')).rows[0].n,before)
 okay(await call('/api/v1/results/batch',{method:'POST',body:{items:[resultInput()]},idem:'failed-batch'}),201)
})

test('ownership policies prevent edits, deletes, and submissions on someone else’s rig',async()=>{
 for(const path of [`/api/v1/rigs/${rig.id}`,`/api/v1/custom-runtimes/${runtime.id}`,`/api/v1/results/${result.id}`]) {
   const current=okay(await call(path))
   assert.equal((await call(path,{method:'PATCH',body:{notes:'Unauthorized'},token:bob.key,version:current.updatedAt})).status,404)
   assert.equal((await call(path,{method:'DELETE',token:bob.key,version:current.updatedAt})).status,404)
 }
 assert.equal((await call('/api/v1/results',{method:'POST',token:bob.key,body:resultInput()})).status,403)
 assert.equal((await call('/api/v1/rigs',{method:'POST',body:{...rigInput,ownerId:other}})).status,400)
 assert.equal((await call('/api/v1/results',{method:'POST',body:{...resultInput(),sourcePrUrl:'https://example.test'}})).status,400)
})

test('version checks prevent lost edits and retries remain stable',async()=>{
 assert.equal((await call(`/api/v1/rigs/${rig.id}`,{method:'PATCH',body:{notes:'Updated'}})).status,428)
 // Vercel's edge turns a successful If-Match write into its own 412, so it must never reach the database.
 const ifMatch=await call(`/api/v1/rigs/${rig.id}`,{method:'PATCH',body:{notes:'Via If-Match'},headers:{'if-match':JSON.stringify(rig.updatedAt)}})
 assert.equal(ifMatch.status,400);assert.equal(ifMatch.body.error.code,'use_expected_version')
 assert.equal(okay(await call(`/api/v1/rigs/${rig.id}`)).updatedAt,rig.updatedAt)
 assert.equal((await call(`/api/v1/rigs/${rig.id}`,{headers:{'if-match':'"x"'}})).status,400)
 const edit={method:'PATCH',body:{notes:'Updated'},version:rig.updatedAt,idem:'edit-rig'}
 const updated=okay(await call(`/api/v1/rigs/${rig.id}`,edit));assert.equal(updated.notes,'Updated')
 assert.deepEqual(okay(await call(`/api/v1/rigs/${rig.id}`,edit)),updated)
 assert.equal((await call(`/api/v1/rigs/${rig.id}`,{...edit,idem:'stale-edit',body:{notes:'Old edit'}})).status,412)
 rig=updated
})

test('confirm and flag use desired state, enforce scopes, and preserve self-action restrictions',async()=>{
 assert.equal((await call(`/api/v1/results/${result.id}/confirmation`,{method:'PUT'})).status,403)
 for(let i=0;i<2;i++) okay(await call(`/api/v1/results/${result.id}/confirmation`,{method:'PUT',token:bob.key}))
 assert.equal((await h.db.query('select count(*)::int n from public.result_confirmations where result_id=$1',[result.id])).rows[0].n,1)
 for(let i=0;i<2;i++) okay(await call(`/api/v1/results/${result.id}/flag`,{method:'PUT',token:bob.key,body:{reason:'other',note:'Check the run'}}))
 assert.equal((await h.db.query('select count(*)::int n from public.result_flags where result_id=$1',[result.id])).rows[0].n,1)
 okay(await call(`/api/v1/results/${result.id}/confirmation`,{method:'DELETE',token:bob.key}))
 okay(await call(`/api/v1/results/${result.id}/flag`,{method:'DELETE',token:bob.key}))
 const read=await createKey('alice-test-session',['read'],'Read only')
 assert.equal((await call('/api/v1/rigs',{method:'POST',token:read.key,body:rigInput})).status,403)
 const content=await createKey('bob-test-session',['read','write'],'Content only')
 assert.equal((await call(`/api/v1/results/${result.id}/flag`,{method:'PUT',token:content.key,body:{reason:'other'}})).status,403)
})

test('signed photo allocation, upload completion, attachment, and ownership work',async()=>{
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=','base64')
 const upload=okay(await call('/api/v1/uploads',{method:'POST',body:{contentType:'image/png',size:image.length}}),201)
 assert.equal((await call('/api/v1/uploads/complete',{method:'POST',body:{photoPath:upload.photoPath}})).status,400)
 assert.equal((await fetch(upload.uploadUrl,{method:'PUT',headers:{'content-type':'image/png'},body:image})).status,200)
 assert.equal((await call('/api/v1/uploads/complete',{method:'POST',token:bob.key,body:{photoPath:upload.photoPath}})).status,400)
 okay(await call('/api/v1/uploads/complete',{method:'POST',body:{photoPath:upload.photoPath}}))
 const current=okay(await call(`/api/v1/rigs/${rig.id}`))
 rig=okay(await call(`/api/v1/rigs/${rig.id}`,{method:'PATCH',body:{photoPath:upload.photoPath},version:current.updatedAt}));assert.equal(rig.photoPath,upload.photoPath)
 const bobRig=okay(await call('/api/v1/rigs',{method:'POST',token:bob.key,body:rigInput}),201)
 assert.equal((await call(`/api/v1/rigs/${bobRig.id}`,{method:'PATCH',token:bob.key,body:{photoPath:upload.photoPath},version:bobRig.updatedAt})).status,400)
})

test('catalog relationships, result edits, pagination, and hidden rows keep website rules',async()=>{
 assert.equal((await call('/api/v1/results',{method:'POST',body:{...resultInput(),componentId:'intel-arc-b390',componentQuantity:12}})).status,400)
 assert.equal((await call('/api/v1/results',{method:'POST',body:{...resultInput(),runtimeId:'vllm'}})).status,400)
 const unknownModel=await call('/api/v1/results',{method:'POST',body:{...resultInput(),modelId:'not-a-model'}})
 assert.equal(unknownModel.status,400);assert.match(unknownModel.body.error.message,/Unknown model: not-a-model/)
 assert.match((await call('/api/v1/results',{method:'POST',body:{...resultInput(),quant:'ptq1_0'}})).body.error.message,/does not support quant ptq1_0/)
 assert.equal((await call('/api/v1/results/batch',{method:'POST',body:{items:[resultInput(),{...resultInput(),runtimeId:'not-a-runtime'}]}})).status,400)
 assert.equal((await call(`/api/v1/custom-runtimes/${runtime.id}`,{method:'PATCH',body:{runtimeId:'vllm'},version:runtime.updatedAt})).status,409)
 const first=okay(await call('/api/v1/results?owner=me&limit=1'))
 assert.equal(first.items.length,1);assert.ok(first.nextCursor)
 const next=okay(await call(`/api/v1/results?owner=me&limit=1&cursor=${first.nextCursor}`))
 assert.notEqual(next.items[0].id,first.items[0].id)
 await h.db.query('update public.results set hidden=true where id=$1',[result.id])
 assert.equal((await call(`/api/v1/results/${result.id}`,{token:bob.key})).status,404)
 assert.equal(okay(await call(`/api/v1/results/${result.id}`)).hidden,true)
 assert.ok(!okay(await call('/api/v1/results',{token:bob.key})).items.some(x=>x.id===result.id))
 await h.db.query('update public.results set hidden=false where id=$1',[result.id])
 okay(await call(`/api/v1/results/${result.id}/confirmation`,{method:'PUT',token:bob.key}))
 const current=okay(await call(`/api/v1/results/${result.id}`))
 const updated=okay(await call(`/api/v1/results/${result.id}`,{method:'PATCH',body:{decodeTps:8.1},version:current.updatedAt}))
 assert.equal(updated.decodeTps,8.1);assert.equal(updated.confirmationsCount,0)
})

test('delete requires explicit cascade, and referenced custom builds cannot disappear',async()=>{
 const current=okay(await call(`/api/v1/rigs/${rig.id}`))
 assert.equal((await call(`/api/v1/rigs/${rig.id}`,{method:'DELETE',version:current.updatedAt})).status,409)
 assert.equal((await call(`/api/v1/custom-runtimes/${runtime.id}`,{method:'DELETE',version:runtime.updatedAt})).status,409)
 okay(await call(`/api/v1/rigs/${rig.id}?cascade=true`,{method:'DELETE',version:current.updatedAt}))
 assert.equal((await call(`/api/v1/results/${result.id}`)).status,404)
 okay(await call(`/api/v1/custom-runtimes/${runtime.id}`,{method:'DELETE',version:runtime.updatedAt}))
})

test('expiry, revocation, last use, activity attribution, and limits are enforced',async()=>{
 const activity=okay(await call('/api/keys/activity',{token:'alice-test-session'}));assert.ok(activity.items.some(x=>x.keyId===key.id&&x.action==='results.batch'))
 const list=okay(await call('/api/keys',{token:'alice-test-session'}));assert.ok(list.items.find(x=>x.id===key.id).lastUsedAt)
 const expiring=await createKey();await h.db.query("update private.agent_keys set expires_at=now()-interval '1 minute' where id=$1",[expiring.id])
 assert.equal((await call('/api/v1/me',{token:expiring.key})).status,401)
 const revoked=await createKey();okay(await call(`/api/keys/${revoked.id}`,{method:'DELETE',token:'alice-test-session'}))
 assert.equal((await call('/api/v1/me',{token:revoked.key})).status,401)
 await h.db.query("update private.agent_limits set window_start=date_trunc('minute',now()),requests=120 where owner_id=$1",[owner])
 const limited=await call('/api/v1/me');assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60')
 await h.db.query('delete from private.agent_limits where owner_id=$1',[owner])
})

test('RPC grants and dispatcher role prevent bypasses and restore request identity',async()=>{
 for(const role of ['anon','authenticated']) {
  await h.db.exec(`set role ${role}`)
  try {
   await assert.rejects(h.db.query('select public.agent_request($1,$2)',[h.hashKey(key.key),'me']),/permission denied/)
   await assert.rejects(h.db.query('select public.manage_agent_keys($1,$2)',[owner,'list']),/permission denied/)
   await assert.rejects(h.db.query("select private.agent_dispatch('me','{}')"),/permission denied/)
   await assert.rejects(h.db.query('select token_hash from private.agent_keys'),/permission denied/)
  } finally {await h.db.exec('reset role')}
 }
 const role=(await h.db.query("select rolcanlogin,rolbypassrls from pg_roles where rolname='intelinside_agent'")).rows[0]
 assert.deepEqual(role,{rolcanlogin:false,rolbypassrls:false})
 await h.db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'service_role'})])
 okay(await call('/api/v1/me'))
 assert.deepEqual(JSON.parse((await h.db.query("select current_setting('request.jwt.claims') claims")).rows[0].claims),{role:'service_role'})
})

test('input errors, documentation, routing, and cache protection are explicit',async()=>{
 for(const body of [{...rigInput,unknown:true},{...rigInput,components:[]},{...rigInput,components:[{hardwareId:'intel-arc-b390',quantity:11}]}]) assert.equal((await call('/api/v1/rigs',{method:'POST',body})).status,400)
 assert.equal((await call('/api/v1/rigs?limit=100000')).status,400)
 assert.equal((await call('/api/v1/rigs',{method:'POST',body:rigInput,headers:{'content-type':'text/plain'}})).status,415)
 const invalidDate={...resultInput(),runDate:'2026-02-30'}
 assert.equal((await call('/api/v1/results',{method:'POST',body:invalidDate})).status,400)
 assert.equal((await call('/api/v1/rigs?owner=me&owner=me')).status,400)
 assert.equal((await call('/api/v1/rigs',{method:'POST',body:rigInput,headers:{'idempotency-key':''}})).status,400)
 assert.equal((await call('/api/v1/unknown')).status,404)
 const spec=okay(await call('/api/openapi.json',{token:null}));assert.ok(spec.paths['/results/batch'].post.requestBody);assert.ok(spec.paths['/uploads'].post)
 assert.equal((await call('/api/v1/me')).headers.get('cache-control'),'no-store')
 assert.equal((await call('/api/v1/handler?route=me')).status,200)
 assert.equal((await call('/api/keys?route=activity',{token:'alice-test-session'})).status,200)
})
