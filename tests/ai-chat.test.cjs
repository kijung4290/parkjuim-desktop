const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAIConversation,fileParts,createClient}=require('../electron/ai-chat.cjs');
const {createStore}=require('../electron/store.cjs');
const {sanitizeSettings}=require('../electron/core.cjs');
const {chatError}=require('../electron/chat-errors.cjs');
const blocks=[{type:'document',title:'예산.txt',source:{type:'text',data:'합계 200',media_type:'text/plain'}},{type:'document',title:'안내.pdf',source:{type:'base64',data:'cGRm',media_type:'application/pdf'}},{type:'image',source:{type:'base64',data:'aW1n',media_type:'image/png'}}];
function files(){let used=0;return {get:ids=>ids.length?[{blocks}]:[],markUsed:()=>used++,clear:()=>{},used:()=>used};}
test('provider keys migrate independently, encrypt, reopen and delete without affecting Claude or voice',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'park-ai-'));
  const safe={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from([...s].reverse().join('')),decryptString:b=>[...b.toString()].reverse().join('')};
  try{
    let store=await createStore(dir,safe);await store.save({apiKey:'sk-ant-test-123456789012345',elevenLabsApiKey:'eleven-test-123456789012345'});
    store=await createStore(dir,safe);assert.equal(store.get().aiProvider,'claude');assert.equal(store.get().hasSelectedKey,true);
    await store.save({aiProvider:'gemini',geminiApiKey:'AIza-test-123456789012345',openaiApiKey:'sk-proj-test-123456789012345',geminiModel:'models/gemini-2.5-flash',openaiModel:'gpt-5-mini'});
    store=await createStore(dir,safe);assert.equal(store.keyFor('gemini'),'AIza-test-123456789012345');assert.equal(store.keyFor('openai'),'sk-proj-test-123456789012345');assert.equal(store.get().geminiModel,'gemini-2.5-flash');
    const disk=fs.readFileSync(path.join(dir,'settings.json'),'utf8');for(const provider of ['claude','gemini','openai']){assert.ok(!disk.includes(store.keyFor(provider)));assert.ok(!JSON.stringify(store.get()).includes(store.keyFor(provider)));}
    await store.save({clearGeminiKey:true});assert.equal(store.get().hasSelectedKey,false);assert.ok(store.key());assert.ok(store.keyFor('openai'));assert.ok(store.elevenLabsKey());
    for(const aiProvider of ['__proto__','toString','invalid',null])assert.throws(()=>sanitizeSettings({aiProvider}));
    assert.throws(()=>sanitizeSettings({geminiModel:'https://evil.invalid/api'}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('attachments use native PDF, image and text inputs for both providers',()=>{
  const openai=fileParts(blocks,'openai'),gemini=fileParts(blocks,'gemini');
  assert.match(openai[0].text,/예산.txt.*\n합계 200/);assert.equal(openai[1].file_data,'data:application/pdf;base64,cGRm');assert.equal(openai[2].image_url,'data:image/png;base64,aW1n');
  assert.deepEqual(gemini[1],{type:'document',data:'cGRm',mime_type:'application/pdf'});assert.equal(gemini[2].type,'image');
});
for(const provider of ['openai','gemini'])test(`${provider} keeps native search/signature and attachment context, hides raw context and rejects provider crossover`,async()=>{
  const attachments=files(),chat=createAIConversation({attachments}),requests=[],events=[];
  const native=provider==='openai'?[{type:'reasoning',id:'r1',encrypted_content:'private-signature'},{type:'web_search_call',id:'s1',status:'completed',action:{type:'search',query:'예산'}},{type:'message',role:'assistant',content:[{type:'output_text',text:'합계 200',annotations:[{type:'url_citation',url:'https://example.com/budget',title:'예산 안내'},{type:'url_citation',url:'file:///secret',title:'bad'}]}]}]:[{type:'thought',signature:'private-signature'},{type:'google_search_call',id:'s1',queries:['예산']},{type:'google_search_result',call_id:'s1',result:[{search_suggestions:'<style>.chip{color:#333}</style><a target="_blank" href="https://www.google.com/search?q=budget">Google 검색</a><script>window.evil=1</script>'}]},{type:'model_output',content:[{type:'text',text:'합계 200',annotations:[{type:'url_citation',url:'https://example.com/budget',title:'예산 안내'},{type:'url_citation',url:'javascript:alert(1)',title:'bad'}]}]}];
  const client=provider==='openai'?{responses:{stream(params,options){requests.push({params,options});const stream=new EventEmitter();stream.finalResponse=async()=>{stream.emit('response.output_text.delta',{delta:'합계 200'});return {status:'completed',output:native};};return stream;}}}:{interactions:{async create(params,options){requests.push({params,options});return {status:'completed',steps:native};}}};
  const controller=new AbortController(),options={provider,model:provider==='gemini'?'gemini-3.8-flash':'gpt-5-mini',client,system:'system',signal:controller.signal,emit:event=>events.push(event)};
  const result=await chat.send({text:'분석',attachmentIds:['f1'],search:true},options);
  assert.equal(result.text,'합계 200');assert.equal(result.sources.length,1);assert.equal(result.searches,1);assert.equal(chat.source(result.sources[0].id),'https://example.com/budget');assert.ok(!JSON.stringify(result).includes('private-signature'));assert.equal(attachments.used(),1);
  assert.equal(requests[0].params.store,false);assert.equal(requests[0].options.signal,controller.signal);assert.equal(requests[0].params.tools[0].type,provider==='gemini'?'google_search':'web_search');
  if(provider==='gemini'){assert.ok(chat.grounding(result.suggestions[0]).includes('Google 검색'));assert.equal(chat.suggestionLink('https://www.google.com/search?q=budget'),true);assert.equal(chat.suggestionLink('https://example.com'),false);}
  await chat.send({text:'다시',search:false},options);
  assert.equal(requests[1].params.tools,undefined);assert.ok(JSON.stringify(requests[1].params.input).includes('private-signature'));assert.ok(JSON.stringify(requests[1].params.input).includes('cGRm'));
  for(let i=0;i<12;i++)await chat.send({text:'계속'},options);
  assert.ok(JSON.stringify(requests.at(-1).params.input).includes('cGRm'));assert.equal(chat.inspect().turns,12);
  await assert.rejects(chat.send({text:'cross'}, {...options,provider:provider==='gemini'?'openai':'gemini'}),/새 대화/);
  chat.reset();assert.equal(chat.inspect().turns,0);assert.equal(chat.source(result.sources[0].id),undefined);
});
test('aborted or failed provider requests do not enter history, and SDK errors do not expose secrets',async()=>{
  const chat=createAIConversation({attachments:files()}),controller=new AbortController();controller.abort();
  await assert.rejects(chat.send({text:'hello'},{provider:'gemini',model:'gemini-3.8-flash',signal:controller.signal,client:{interactions:{create:async()=>({steps:[{type:'model_output',content:[{type:'text',text:'ignore'}]}]})}}}),{name:'AbortError'});
  assert.equal(chat.inspect().turns,0);
  for(const provider of ['gemini','openai'])for(const status of [400,401,403,404,429,500]){const message=chatError({status,message:'secret-key',error:{message:'secret-key'}},{provider});assert.ok(!message.includes('secret-key'));assert.match(message,new RegExp(String(status)));}
  for(const provider of ['claude','gemini','openai'])assert.ok(createClient('fake-test-key-1234567890',provider));
});
test('official SDKs serialize native chat/search/files against a local HTTP fixture',async()=>{
  const http=require('node:http'),requests=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;requests.push(JSON.parse(body));
    if(req.url.includes('interactions')){
      res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'test-interaction',model:'gemini-3.8-flash',status:'completed',steps:[{type:'thought',signature:'opaque'},{type:'model_output',content:[{type:'text',text:'fixture answer'}]}]}));
    }else{
      const response={id:'resp_fixture',object:'response',created_at:1,status:'completed',output:[{id:'msg_fixture',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:'fixture answer',annotations:[]}]}]};
      res.setHeader('content-type','text/event-stream');res.end(`event: response.created\ndata: ${JSON.stringify({type:'response.created',sequence_number:0,response:{...response,status:'in_progress',output:[]}})}\n\nevent: response.completed\ndata: ${JSON.stringify({type:'response.completed',sequence_number:1,response})}\n\n`);
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const google=createClient('fake-test-key-1234567890','gemini');
    const clients={gemini:{interactions:{create:(params,options)=>google.interactions.create(params,{...options,server_url:base,timeout_ms:3000})}},openai:new(require('openai'))({apiKey:'fake-test-key-1234567890',baseURL:base,maxRetries:0,timeout:3000})};
    for(const provider of ['gemini','openai']){
      const chat=createAIConversation({attachments:files()});const result=await chat.send({text:'analyze',attachmentIds:['file'],search:true},{provider,model:provider==='gemini'?'gemini-3.8-flash':'gpt-5-mini',client:clients[provider],system:'system'});
      assert.equal(result.text,'fixture answer');const body=requests.at(-1);assert.equal(body.store,false);assert.ok(JSON.stringify(body.input).includes('cGRm'));assert.ok(body.tools.length);
    }
    assert.equal(requests.length,2);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
