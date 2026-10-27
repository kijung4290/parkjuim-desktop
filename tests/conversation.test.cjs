const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createConversation,validateTurn,webUrl}=require('../electron/conversation.cjs');
function fakeClient(responses,calls){return {messages:{stream(params){calls.push(structuredClone(params));const stream=new EventEmitter(),response=responses.shift();stream.finalMessage=async()=>{
  if(response.fail)throw new Error('offline');
  for(const block of response.content){stream.emit('streamEvent',{type:'content_block_start',content_block:block});if(block.type==='text'){stream.emit('text',block.text);for(const citation of block.citations||[])stream.emit('citation',citation);}}
  return response;
};return stream;}}};}
const attachments=()=>({get:ids=>ids.map(id=>({blocks:[{type:'document',title:'budget.txt',source:{type:'text',media_type:'text/plain',data:'Total 200'},citations:{enabled:true}}]})),markUsed:()=>{},clear:()=>{}});
test('search and document citations keep full server context while renderer sees safe source metadata',async()=>{
  const calls=[],events=[];
  const blocks=[{type:'server_tool_use',id:'tool',name:'web_search',input:{query:'official'}},{type:'web_search_tool_result',tool_use_id:'tool',content:[{type:'web_search_result',url:'https://www.electronjs.org/',encrypted_content:'opaque-search-data'}]},{type:'thinking',thinking:'private',signature:'signature-preserved'},{type:'text',text:'분석 답변',citations:[{type:'web_search_result_location',title:'Electron',url:'https://www.electronjs.org/',encrypted_index:'opaque-index'},{type:'char_location',document_index:0,document_title:'budget.txt'}]}];
  const session=createConversation({attachments:attachments()}),client=fakeClient([{content:blocks,stop_reason:'end_turn'},{content:[{type:'text',text:'후속 답변'}],stop_reason:'end_turn'}],calls);
  const first=await session.send({text:'검색하고 파일을 분석해줘',attachmentIds:['file'],search:true},{client,model:'test',system:'test',emit:event=>events.push(event)});
  assert.equal(first.sources.length,2);assert.equal(first.searches,1);assert.equal(first.sources[0].url,undefined);assert.equal(session.source(first.sources[0].id),'https://www.electronjs.org/');
  assert.ok(!JSON.stringify(events).includes('opaque-search-data'));assert.ok(!JSON.stringify(events).includes('signature-preserved'));
  await session.send({text:'그 파일의 합계는?'},{client,model:'test',system:'test'});
  assert.deepEqual(calls[1].messages[1].content,blocks);assert.equal(calls[1].tools,undefined);assert.equal(calls[1].messages[0].content[0].title,'budget.txt');
  session.reset();assert.equal(session.inspect().turns,0);assert.equal(session.source(first.sources[0].id),undefined);
});
test('pause_turn resumes with unchanged search blocks, and a failed turn does not enter history',async()=>{
  const calls=[],paused=[{type:'server_tool_use',id:'x',name:'web_search',input:{query:'one'}},{type:'web_search_tool_result',tool_use_id:'x',content:[{encrypted_content:'exact'}]}];
  const session=createConversation({attachments:attachments()}),client=fakeClient([{content:paused,stop_reason:'pause_turn'},{content:[{type:'text',text:'완료'}],stop_reason:'end_turn'},{fail:true},{content:[{type:'text',text:'다시 완료'}],stop_reason:'end_turn'}],calls);
  await session.send({text:'search',search:true},{client,model:'test',system:'test'});
  assert.deepEqual(calls[1].messages.at(-1).content,paused);assert.equal(calls[1].tools[0].max_uses,2);
  await assert.rejects(session.send({text:'failed'},{client,model:'test',system:'test'}));
  await session.send({text:'retry'},{client,model:'test',system:'test'});assert.ok(!JSON.stringify(calls.at(-1).messages).includes('failed'));
});
test('unsafe links and malformed requests are rejected; file-only requests get an analysis prompt',()=>{
  for(const url of ['javascript:alert(1)','file:///C:/secret','https://user:password@example.com','http://127.0.0.1','http://192.168.0.1','http://[::1]'])assert.equal(webUrl(url),null);
  assert.equal(webUrl('https://example.com/page'),'https://example.com/page');
  assert.throws(()=>validateTurn({text:'hello',search:'true'}));assert.throws(()=>validateTurn({text:'',attachmentIds:[]}));assert.throws(()=>validateTurn({text:'x'.repeat(12001)}));
  assert.match(validateTurn({text:'',attachmentIds:['id']}).text,/파일/);
});
test('files and citation indices remain available after older dialogue is trimmed',async()=>{
  const calls=[],session=createConversation({attachments:attachments()});
  const responses=Array.from({length:16},()=>({content:[{type:'text',text:'답변',citations:[{type:'char_location',document_index:0}]}],stop_reason:'end_turn'}));
  const client=fakeClient(responses,calls);
  for(let i=0;i<16;i++)await session.send({text:`질문 ${i}`,attachmentIds:i===0?['file']:[]},{client,model:'test',system:'test'});
  const documents=calls.at(-1).messages.flatMap(message=>Array.isArray(message.content)?message.content.filter(block=>block.type==='document'):[]);
  assert.equal(documents.length,1);assert.equal(documents[0].title,'budget.txt');assert.equal(session.inspect().turns,12);
});
