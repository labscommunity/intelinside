import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { startHarness } from './harness.mjs'
const backend = await startHarness({port:8080})
process.env.VITE_API_MODE='supabase'
process.env.VITE_SUPABASE_URL=backend.origin
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-publishable-key'
const vite=await createServer({root:fileURLToPath(new URL('../../',import.meta.url)),server:{host:'127.0.0.1',port:5173,strictPort:true}})
await vite.listen();console.log('Isolated agent API fixture ready at http://127.0.0.1:5173')
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await vite.close();await backend.close();process.exit(0)})
