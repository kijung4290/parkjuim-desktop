const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chatError}=require('../electron/chat-errors.cjs');
test('Claude errors distinguish billing, authentication, network and request failures without leaking backend data',()=>{
  assert.match(chatError({status:400,error:{error:{message:'Your credit balance is too low'}}}),/크레딧/);
  assert.match(chatError({status:400}),/요청 설정/);
  assert.match(chatError({status:401}),/키/);
  assert.match(chatError({status:404}),/모델/);
  assert.match(chatError({status:429}),/한도/);
  assert.match(chatError({status:529}),/서버/);
  assert.match(chatError({name:'APIConnectionError'}),/방화벽/);
  assert.match(chatError({}, {cancelled:true}),/중지/);
  assert.match(chatError({}, {cancelled:true,timedOut:true}),/응답 시간/);
  assert.ok(!chatError({message:'sk-ant-private-secret',headers:{token:'private'}}).includes('private'));
});
