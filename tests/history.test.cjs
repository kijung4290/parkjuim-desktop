const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createHistoryStore,LIMITS}=require('../electron/history.cjs');
const {createAIConversation}=require('../electron/ai-chat.cjs');
const info={provider:'claude',model:'claude-sonnet-5-5'};
const turn={user:'예산을 정리해 주세요',assistant:'총예산은 200입니다.',files:[{name:'예산.xlsx',format:'XLSX',size:100,blocks:[{secret:'original-file-bytes'}]}],sources:[{kind:'web',title:'공식 자료',site:'example.com',url:'https://example.com/budget'},{kind:'web',url:'file:///secret'},{kind:'document',title:'예산.xlsx',site:'본문'}],suggestions:['<a target="_blank" href="https://www.google.com/search?q=budget">Google 검색</a>'],search:true,signature:'never-persist-opaque-api-data'};
function safe(){return {isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async text=>Buffer.from([...text].reverse().join('')),decryptStringAsync:async buffer=>({result:[...buffer.toString()].reverse().join(''),shouldReEncrypt:false})};}
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'park-history-'));}
test('long replies beyond the previous 100,000 character limit save, reopen and restore without truncation',async()=>{
  const dir=temp();try{
    const assistant='가나다'.repeat(50000)+'끝',store=await createHistoryStore(dir,safe());
    const id=await store.append(null,info,{user:'긴 답변',assistant});
    const reopened=await createHistoryStore(dir,safe());assert.equal(reopened.get(id).turns[0].assistant,assistant);
    const engine=createAIConversation({attachments:{get:()=>[],markUsed:()=>{},clear:()=>{}}});engine.restore(reopened.get(id));assert.equal(engine.inspect().turns,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('encrypted transcripts reopen with Unicode, file labels and safe links; raw files and API state are excluded',async()=>{
  const dir=temp();try{
    let store=await createHistoryStore(dir,safe());const id=await store.append(null,info,turn);
    const disk=fs.readFileSync(path.join(dir,'conversations.json'),'utf8');assert.ok(!disk.includes(turn.user));assert.ok(!disk.includes('예산.xlsx'));
    store=await createHistoryStore(dir,safe());const saved=store.get(id);assert.equal(saved.turns[0].user,turn.user);assert.equal(saved.turns[0].sources.length,2);assert.equal(saved.turns[0].files[0].name,'예산.xlsx');
    assert.ok(!JSON.stringify(saved).includes('original-file-bytes'));assert.ok(!JSON.stringify(saved).includes('never-persist'));assert.equal(saved.turns[0].files[0].blocks,undefined);
    assert.deepEqual(saved.turns[0].suggestions,turn.suggestions);
    saved.title='external mutation';assert.notEqual(store.get(id).title,saved.title);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('rename and deletion persist without touching another provider conversation',async()=>{
  const dir=temp();try{
    let store=await createHistoryStore(dir,safe());const first=await store.append(null,info,turn),second=await store.append(null,{provider:'gemini',model:'gemini-3.8-flash'},turn);
    await store.rename(first,'10월 예산 이야기');await assert.rejects(store.rename(first,' '));assert.equal(store.get(first).title,'10월 예산 이야기');
    await store.remove(second);store=await createHistoryStore(dir,safe());assert.equal(store.list().length,1);assert.equal(store.list()[0].id,first);assert.equal(store.list()[0].count,1);assert.throws(()=>store.get(second));
    await assert.rejects(store.append(first,{provider:'openai',model:'gpt-5-mini'},turn),/서비스/);assert.equal(store.get(first).turns.length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('concurrent appends serialize, and failed encryption rolls back without poisoning the queue',async()=>{
  const dir=temp(),crypto=safe();try{
    const store=await createHistoryStore(dir,crypto),id=await store.append(null,info,turn);
    await Promise.all([store.append(id,info,{...turn,user:'추가 질문 1'}),store.append(id,info,{...turn,user:'추가 질문 2'})]);assert.equal(store.get(id).turns.length,3);
    const encrypt=crypto.encryptStringAsync;crypto.encryptStringAsync=async()=>{throw new Error('storage offline');};await assert.rejects(store.append(id,info,turn));assert.equal(store.get(id).turns.length,3);
    crypto.encryptStringAsync=encrypt;await store.append(id,info,turn);assert.equal(store.get(id).turns.length,4);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unavailable encryption never writes plaintext and unreadable records are preserved',async()=>{
  const dir=temp();try{
    const store=await createHistoryStore(dir,{isEncryptionAvailable:()=>false});await assert.rejects(store.append(null,info,turn),/암호화/);assert.equal(fs.existsSync(path.join(dir,'conversations.json')),false);assert.equal(store.list().length,0);
    const file=path.join(dir,'conversations.json'),original='{unreadable';fs.writeFileSync(file,original);await assert.rejects(createHistoryStore(dir,safe()),/보존/);assert.equal(fs.readFileSync(file,'utf8'),original);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('history quotas report an error and never automatically delete existing records',async()=>{
  const dir=temp();try{
    const store=await createHistoryStore(dir,safe());let first;
    for(let i=0;i<LIMITS.conversations;i++){const id=await store.append(null,info,{user:`질문 ${i}`,assistant:'답변'});if(!first)first=id;}
    await assert.rejects(store.append(null,info,turn),/50/);assert.equal(store.list().length,LIMITS.conversations);assert.equal(store.get(first).turns.length,1);
    for(let i=1;i<LIMITS.turns;i++)await store.append(first,info,{user:`후속 ${i}`,assistant:'답변'});
    await assert.rejects(store.append(first,info,turn),/200/);assert.equal(store.get(first).turns.length,LIMITS.turns);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
for(const provider of ['claude','gemini','openai'])test(`${provider} resumes saved text without retaining attachment bytes or another provider context`,async()=>{
  const engine=createAIConversation({attachments:{get:()=>[],markUsed:()=>{},clear:()=>{}}});
  engine.restore({provider,turns:[turn]});let request;
  const client=provider==='gemini'?{interactions:{create:async params=>{request=params;return {status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'후속 답변'}]}]};}}}:provider==='openai'?{responses:{stream:params=>{request=params;const stream=new EventEmitter();stream.finalResponse=async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'후속 답변'}]}]});return stream;}}}:{messages:{stream:params=>{request=params;const stream=new EventEmitter();stream.finalMessage=async()=>{stream.emit('text','후속 답변');return {stop_reason:'end_turn',content:[{type:'text',text:'후속 답변'}]};};return stream;}}};
  await engine.send({text:'그 다음은요?'},{provider,client,model:'test',system:'test'});
  const context=JSON.stringify(request.input||request.messages);assert.ok(context.includes(turn.user));assert.ok(context.includes(turn.assistant));assert.ok(!context.includes('original-file-bytes'));assert.ok(!context.includes('never-persist'));assert.equal(engine.inspect().turns,2);
});
