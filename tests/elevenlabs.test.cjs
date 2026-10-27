const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createElevenLabs,voiceError}=require('../electron/elevenlabs.cjs');
const {createStore}=require('../electron/store.cjs');
const {sanitizeSettings}=require('../electron/core.cjs');

test('ElevenLabs keys stay encrypted and separate from existing Claude credentials',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parkjuim-voice-'));
  const safe={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from([...s].reverse().join('')),decryptString:b=>[...b.toString()].reverse().join('')};
  const claude='sk-ant-test-key-123456789',eleven='sk_test_elevenlabs_123456789012345';
  try{
    let store=await createStore(dir,safe);
    await store.save({apiKey:claude});await store.save({elevenLabsApiKey:eleven,speechProvider:'elevenlabs'});
    assert.equal(store.key(),claude);assert.equal(store.elevenLabsKey(),eleven);
    const publicState=JSON.stringify(store.get()),disk=fs.readFileSync(path.join(dir,'settings.json'),'utf8');
    for(const secret of [claude,eleven]){assert.ok(!publicState.includes(secret));assert.ok(!disk.includes(secret));}
    store=await createStore(dir,safe);assert.equal(store.elevenLabsKey(),eleven);
    await store.save({clearElevenLabsKey:true});assert.equal(store.key(),claude);assert.equal(store.elevenLabsKey(),'');
    await assert.rejects(store.save({apiKey:claude,elevenLabsApiKey:'bad'}));assert.equal(store.elevenLabsKey(),'');
    assert.equal(sanitizeSettings({voiceStability:10}).voiceStability,1);
    assert.throws(()=>sanitizeSettings({elevenLabsVoiceId:'../../token'}));
    assert.throws(()=>sanitizeSettings({elevenLabsModel:'unknown'}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('voice listing preserves pagination and highlights Korean without exposing SDK metadata',async()=>{
  let args;
  const service=createElevenLabs({key:()=> 'test',clientFactory:()=>({voices:{search:async input=>{args=input;return {voices:[{voiceId:'english',name:'A',labels:{language:'en'},secret:'never'},{voiceId:'korean',name:'B',verifiedLanguages:[{language:'ko'}]}],hasMore:true,nextPageToken:'page2'};}}})});
  const result=await service.voices({search:'Korean',nextPageToken:'page1'});
  assert.equal(args.pageSize,100);assert.equal(args.nextPageToken,'page1');assert.equal(args.search,'Korean');
  assert.equal(result.voices[0].id,'korean');assert.equal(result.nextPageToken,'page2');assert.ok(!JSON.stringify(result).includes('never'));
});

test('speech uses selected voice and model, joins chunks and rejects cancellation',async()=>{
  let sent,options;
  const service=createElevenLabs({key:()=> 'test',clientFactory:()=>({textToSpeech:{convert:async(id,body,opts)=>{sent={id,...body};options=opts;return new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3]));c.close();}});}}})});
  const config={elevenLabsVoiceId:'voice123',elevenLabsModel:'eleven_v4',voiceStability:.4};
  const controller=new AbortController();
  assert.deepEqual([...await service.synthesize('안녕하세요',config,controller.signal)],[1,2,3]);
  assert.equal(sent.id,'voice123');assert.equal(sent.languageCode,'ko');assert.equal(sent.voiceSettings.style,undefined);assert.equal(sent.voiceSettings.speed,undefined);assert.equal(options.maxRetries,0);assert.equal(options.abortSignal,controller.signal);
  await service.synthesize('hi',{...config,elevenLabsModel:'eleven_multilingual_v2'});assert.equal(sent.languageCode,undefined);
  await assert.rejects(service.synthesize('x'.repeat(5001),{...config,elevenLabsModel:'eleven_v3'}),/5,000/);
  controller.abort();await assert.rejects(service.synthesize('hi',config,controller.signal),{name:'AbortError'});
  assert.ok(!voiceError({statusCode:401,message:'secret-key',body:{key:'secret'}}).includes('secret'));
});

test('audio player cancels late results, revokes blobs and reports playback lifecycle',async()=>{
  const {createSpeechPlayer}=await import('../renderer/speech-player.mjs');
  let resolveSpeech,voiceListener,played=0,revoked=0,audio;
  const events=[];
  const bridge={onVoice:fn=>{voiceListener=fn;},stopSpeaking:async()=>{},speak:()=>new Promise(resolve=>{resolveSpeech=resolve;}),playback:(...args)=>events.push(args)};
  const player=createSpeechPlayer(bridge,()=>{},{urls:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{revoked++;}},makeAudio:()=>{audio={play:async()=>{played++;audio.onplaying();},pause:()=>{},removeAttribute:()=>{},load:()=>{}};return audio;}});
  const pending=player.speak('one');await new Promise(resolve=>setImmediate(resolve));await player.stop();resolveSpeech({id:'old',audio:new Uint8Array([1])});await pending;assert.equal(played,0);
  const next=player.speak('two');await new Promise(resolve=>setImmediate(resolve));resolveSpeech({id:'current',audio:new Uint8Array([1])});await next;
  assert.equal(played,1);assert.deepEqual(events[0],['current','playing']);audio.onended();assert.equal(revoked,1);assert.deepEqual(events[1],['current','ended']);
  voiceListener({type:'silence'});assert.equal(revoked,1);
});
