// Read persisted credentials through Electron, without printing them.
// --send additionally makes one short, billable test message.
const {app,safeStorage}=require('electron');
const path=require('node:path');
const {createStore}=require('../electron/store.cjs');
const {chatError}=require('../electron/chat-errors.cjs');
app.setPath('userData',path.join(app.getPath('appData'),'parkjuim-desktop'));
app.whenReady().then(async()=>{
  const store=await createStore(app.getPath('userData'),safeStorage);
  const settings=store.get(),apiKey=store.key();
  if(typeof apiKey!=='string'||!apiKey)throw new Error('Claude API 키를 복원하지 못했어요. 앱 설정에서 연결 상태를 확인해 주세요.');
  const Anthropic=require('@anthropic-ai/sdk');
  const client=new Anthropic({apiKey,maxRetries:0,timeout:30000});
  try{
    const model=await client.models.retrieve(settings.model);
    const result={model:model.id,keyRestored:true,elevenLabsKeyRestored:!!store.elevenLabsKey(),sent:false};
    if(process.argv.includes('--send')){
      const stream=await client.messages.create({model:settings.model,max_tokens:2048,stream:true,system:'한국어로 짧게 답변하세요.',messages:[{role:'user',content:'연결 확인입니다. 안녕하세요라고 짧게 답해주세요.'}]});
      let textCharacters=0,stopReason='';
      for await(const event of stream){if(event.type==='content_block_delta'&&event.delta.type==='text_delta')textCharacters+=event.delta.text.length;if(event.type==='message_delta')stopReason=event.delta.stop_reason;}
      if(!textCharacters)throw new Error('Empty test response');
      Object.assign(result,{sent:true,textCharacters,stopReason});
    }
    console.log('CLAUDE LIVE PASS',JSON.stringify(result));app.exit(0);
  }catch(error){console.error('CLAUDE CHECK FAILED',JSON.stringify({status:error.status,message:chatError(error)}));app.exit(1);}
}).catch(()=>{console.error('Claude credential check failed; no credentials were printed.');app.exit(1);});
