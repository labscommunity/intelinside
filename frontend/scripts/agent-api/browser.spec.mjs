import { test, expect } from '@playwright/test'
const owner='00000000-0000-0000-0000-000000000001'
async function signIn(page) {
  await page.addInitScript(({owner})=>{
    localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:'alice-test-session',refresh_token:'unused-test-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{id:owner,aud:'authenticated',role:'authenticated',email:'alice@example.test',created_at:new Date().toISOString(),user_metadata:{user_name:'alice'},app_metadata:{provider:'github'}}}))
  },{owner})
}

test('browser creates a key; agent registers fleet/build/results; browser revokes access',async({page,request},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await signIn(page);await page.goto('/settings/api-keys')
  await page.getByRole('button',{name:'Reject all',exact:true}).click()
  await expect(page.getByRole('heading',{name:'API keys',exact:true})).toBeVisible()
  await page.getByLabel('Key name').fill('Fleet browser test')
  await page.getByRole('button',{name:'Create key',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Save your key now'})).toBeVisible()
  const key=await page.getByTestId('new-api-key').textContent()
  expect(key).toMatch(/^ii_[A-Za-z0-9_-]{43}$/)
  await page.getByRole('button',{name:'I’ve saved it'}).click()
  await expect(page.getByTestId('new-api-key')).toHaveCount(0)
  await page.reload();await expect(page.getByText('Fleet browser test',{exact:true})).toBeVisible()
  expect(await page.content()).not.toContain(key)
  const headers={authorization:`Bearer ${key}`,'content-type':'application/json'}
  async function create(path,body,idem) {
    const response=await request.post('/api/v1'+path,{headers:{...headers,'idempotency-key':idem},data:body})
    expect(response.status(),await response.text()).toBe(201);return response.json()
  }
  const rig=await create('/rigs',{name:'Browser-tested eleven-node fleet',os:'Linux',components:[{hardwareId:'intel-core-ultra-x7-358h',quantity:11},{hardwareId:'intel-arc-b390',quantity:11}]},'browser-rig')
  expect(rig.ownerId).toBe(owner)
  const runtime=await create('/custom-runtimes',{runtimeId:'llamacpp',name:'Browser-tested custom build',repoUrl:'https://github.com/example/runtime',summary:'Experimental fleet runtime'},'browser-runtime')
  const measurement={rigId:rig.id,modelId:'qwen3-8b',quant:'q4_k_m',runtimeId:'llamacpp',runtimeVersion:'test',customRuntimeId:runtime.id,revision:'abc123',decodeTps:7.959989,runDate:'2026-09-27'}
  const batch=await create('/results/batch',{items:[measurement,{...measurement,decodeTps:60.286375,batchSize:88}]},'browser-results')
  const retry=await create('/results/batch',{items:[measurement,{...measurement,decodeTps:60.286375,batchSize:88}]},'browser-results')
  expect(retry).toEqual(batch);expect(batch.items).toHaveLength(2)
  await page.reload();await expect(page.getByText('Submitted result batch',{exact:false})).toBeVisible()
  await page.screenshot({path:testInfo.outputPath('api-keys-desktop.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await expect(page.getByRole('button',{name:'Copy agent instructions'})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('api-keys-mobile.png'),fullPage:true})
  await page.getByRole('button',{name:'Revoke Fleet browser test',exact:true}).click()
  await page.getByRole('button',{name:'Confirm revoke',exact:true}).click()
  await expect(page.getByText('Fleet browser test · Revoked',{exact:true})).toBeVisible()
  expect((await request.get('/api/v1/me',{headers})).status()).toBe(401)
  expect(errors).toEqual([])
})

test('signed-out settings explain sign-in and docs are directly readable',async({page,request})=>{
 await page.goto('/settings/api-keys')
 await expect(page.getByText('Sign in to manage your API keys',{exact:true})).toBeVisible()
 const docs=await request.get('/docs/agents.md');expect(docs.status()).toBe(200);expect(await docs.text()).toContain('# Intelinside agent API');expect(await docs.text()).not.toContain('<div id="root">')
 const spec=await request.get('/api/openapi.json');expect(spec.status()).toBe(200);expect((await spec.json()).paths['/results/batch']).toBeTruthy()
})
