const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createAIConversation}=require('../electron/ai-chat.cjs');
const {CONTINUE_PROMPT,createReplyWatchdog}=require('../electron/reply.cjs');
const attachments=()=>({get:()=>[],markUsed:()=>{},clear:()=>{}});
function fixture(provider,parts,calls,onPart=()=>{}){
  let index=0;
  function next(params){calls.push(structuredClone(params));const part=parts[index++];assert.ok(part,'Unexpected extra API request');onPart(index);if(part.error)throw part.error;return part;}
  if(provider==='claude')return {messages:{stream(params){const emitter=new EventEmitter();emitter.finalMessage=async()=>{const part=next(params);emitter.emit('streamEvent',{type:'content_block_start',content_block:{type:'text'}});emitter.emit('text',part.text);return {stop_reason:part.more?'max_tokens':'end_turn',content:[{type:'text',text:part.text}]};};return emitter;}}};
  if(provider==='openai')return {responses:{stream(params){const emitter=new EventEmitter();emitter.finalResponse=async()=>{const part=next(params);emitter.emit('response.output_text.delta',{delta:part.text});return {status:part.more?'incomplete':'completed',incomplete_details:part.more?{reason:part.reason||'max_output_tokens'}:null,output:[{type:'reasoning',encrypted_content:'opaque-signature'},{type:'message',role:'assistant',content:[{type:'output_text',text:part.text,annotations:[]}]}]};};return emitter;}}};
  return {interactions:{async create(params){const part=next(params);return {status:part.more?'incomplete':'completed',steps:[{type:'thought',signature:'opaque-signature'},{type:'model_output',content:[{type:'text',text:part.text}]}]};}}};
}
for(const provider of ['claude','openai','gemini']){
  test(`${provider} automatically joins more than three length continuations, retains native context and emits one complete answer`,async()=>{
    const calls=[],events=[],parts=Array.from({length:5},(_,i)=>({text:`부분${i}:`+'가'.repeat(25000),more:i<4}));
    const engine=createAIConversation({attachments:attachments()}),client=fixture(provider,[...parts,{text:'후속 답변'}],calls),options={provider,client,model:'test',system:'test',emit:event=>events.push(event)};
    const answer=await engine.send({text:'긴 문서를 작성해 주세요'},options);
    assert.equal(answer.text,parts.map(part=>part.text).join(''));assert.ok(answer.text.length>100000);
    assert.equal(events.filter(event=>event.type==='delta').map(event=>event.text).join(''),answer.text);
    assert.equal(calls.length,5);assert.equal(engine.inspect().turns,1);
    for(const request of calls){if(provider==='claude')assert.equal(request.max_tokens,8192);else{assert.equal(request.max_output_tokens,undefined);assert.equal(request.generation_config,undefined);assert.equal(request.store,false);}}
    const context=JSON.stringify(calls[1].input||calls[1].messages);assert.ok(context.includes(CONTINUE_PROMPT));assert.ok(context.includes(parts[0].text));
    if(provider!=='claude')assert.ok(context.includes('opaque-signature'));
    assert.ok(!JSON.stringify(events).includes('opaque-signature'));
    await engine.send({text:'후속 질문'},options);assert.equal(engine.inspect().turns,2);assert.ok(JSON.stringify(calls.at(-1)).includes(parts[4].text));
  });
  test(`${provider} cancellation at continuation stops further calls and does not commit a partial turn`,async()=>{
    const calls=[],controller=new AbortController(),engine=createAIConversation({attachments:attachments()});
    const options={provider,model:'test',client:fixture(provider,[{text:'첫 부분',more:true}],calls),signal:controller.signal,emit:event=>{if(event.type==='progress'&&event.message.includes('이어서'))controller.abort();}};
    await assert.rejects(engine.send({text:'작성'},options),{name:'AbortError'});assert.equal(calls.length,1);assert.equal(engine.inspect().turns,0);assert.equal(engine.inspect().active,false);
  });
  test(`${provider} empty or repeated continuations cannot run forever`,async()=>{
    for(const parts of [[{text:'',more:true}],[{text:'반복',more:true},{text:'반복',more:true}]]){
      const calls=[],engine=createAIConversation({attachments:attachments()});
      await assert.rejects(engine.send({text:'작성'},{provider,model:'test',client:fixture(provider,parts,calls)}),/중지/);assert.equal(calls.length,parts.length);assert.equal(engine.inspect().turns,0);
    }
  });
  test(`${provider} a failed continuation preserves emitted text and does not pollute subsequent context`,async()=>{
    const calls=[],events=[],engine=createAIConversation({attachments:attachments()}),client=fixture(provider,[{text:'받은 내용',more:true},{error:new Error('offline')},{text:'재시도 성공'}],calls),options={provider,model:'test',client,emit:event=>events.push(event)};
    await assert.rejects(engine.send({text:'실패한 질문'},options),/offline/);assert.equal(events.filter(event=>event.type==='delta').map(event=>event.text).join(''),'받은 내용');assert.equal(engine.inspect().turns,0);
    await engine.send({text:'새 질문'},options);assert.ok(!JSON.stringify(calls.at(-1)).includes('실패한 질문'));
  });
}
test('GPT incomplete responses for reasons other than token limits do not trigger paid continuations',async()=>{
  const calls=[],events=[],engine=createAIConversation({attachments:attachments()});
  const result=await engine.send({text:'질문'},{provider:'openai',model:'test',client:fixture('openai',[{text:'일부 답변',more:true,reason:'content_filter'}],calls),emit:event=>events.push(event)});
  assert.equal(calls.length,1);assert.equal(result.text,'일부 답변');assert.ok(events.some(event=>event.type==='notice'));
});
test('idle watchdog refreshes during long activity and cannot rearm after completion',()=>{
  const timers=new Map();let id=0,timedOut=0;
  const watch=createReplyWatchdog(()=>timedOut++,{milliseconds:10,setTimer:callback=>{timers.set(++id,callback);return id;},clearTimer:id=>timers.delete(id)});
  for(let i=0;i<100;i++)watch.touch();assert.equal(timers.size,1);assert.equal(timedOut,0);
  watch.close();watch.touch();assert.equal(timers.size,0);
  const second=createReplyWatchdog(()=>timedOut++,{setTimer:callback=>{timers.set(++id,callback);return id;},clearTimer:id=>timers.delete(id)});
  [...timers.values()][0]();assert.equal(timedOut,1);second.touch();assert.equal(timers.size,1);second.close();
});
