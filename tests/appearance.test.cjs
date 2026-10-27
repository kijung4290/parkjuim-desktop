const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DEFAULTS,sanitizeSettings,characterSystemPrompt}=require('../electron/core.cjs');
const {createStore}=require('../electron/store.cjs');
const {isPetRegion}=require('../electron/interaction.cjs');
test('existing settings retain the original character and new appearance inputs are bounded',()=>{
  const legacy=sanitizeSettings({roam:false,model:'claude-haiku-5-5'});assert.equal(legacy.characterName,'박주임');assert.equal(legacy.characterType,'human');assert.equal(legacy.hairStyle,'curly');assert.equal(legacy.glasses,false);
  const selected=sanitizeSettings({characterName:' 모찌 🐱 ',characterType:'cat',outfitColor:'#ABCDEF',glasses:true});assert.equal(selected.characterName,'모찌 🐱');assert.equal(selected.outfitColor,'#abcdef');
  for(const bad of [{characterName:''},{characterName:'가'.repeat(21)},{characterName:'이름\n지시'},{characterName:'<script>'},{characterType:'__proto__'},{hairStyle:'http://example.com/model'},{hairColor:'url(https://example.com)'},{skinColor:'#fff'},{glasses:'false'}])assert.throws(()=>sanitizeSettings(bad));
  assert.equal(DEFAULTS.skinColor,'#f2bf9d');
});
test('character identity changes independently from the name used to address the user',()=>{
  const settings=sanitizeSettings({characterName:'루루',nickname:'홍길동님',characterType:'rabbit'}),prompt=characterSystemPrompt(settings);
  assert.ok(prompt.includes('"루루"'));assert.ok(!prompt.includes("동료 '박주임'"));assert.equal(settings.nickname,'홍길동님');assert.ok(prompt.includes('실제 인물이나 기관의 직원인 척하지 않습니다'));
});
test('appearance survives restart per profile while API credentials and other preferences remain intact',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'park-appearance-')),safe={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from([...text].reverse().join('')),decryptString:buffer=>[...buffer.toString()].reverse().join('')};
  try{
    const firstPath=path.join(root,'first'),secondPath=path.join(root,'second');let first=await createStore(firstPath,safe),second=await createStore(secondPath,safe);
    await first.save({apiKey:'sk-ant-fake-key-123456789',characterName:'모찌',characterType:'cat',glasses:true,hairColor:'#a37a54',outfitColor:'#6f99ad',speak:false});await second.save({characterName:'루루',characterType:'rabbit'});
    first=await createStore(firstPath,safe);second=await createStore(secondPath,safe);assert.equal(first.get().characterName,'모찌');assert.equal(first.get().glasses,true);assert.equal(first.get().outfitColor,'#6f99ad');assert.equal(first.get().speak,false);assert.equal(first.key(),'sk-ant-fake-key-123456789');assert.equal(second.get().characterName,'루루');assert.equal(second.get().hasKey,false);
    await first.save({characterName:DEFAULTS.characterName,characterType:'human'});assert.equal(first.key(),'sk-ant-fake-key-123456789');assert.equal(second.get().characterType,'rabbit');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('animal ear clicks remain interactive without swallowing empty desktop corners',()=>{
  const bounds={x:100,y:100,width:200,height:250},ear={x:178,y:112};assert.equal(isPetRegion(ear,bounds,'human'),false);assert.equal(isPetRegion(ear,bounds,'rabbit'),true);
  for(const type of ['human','cat','rabbit'])assert.equal(isPetRegion({x:105,y:105},bounds,type),false);
});
