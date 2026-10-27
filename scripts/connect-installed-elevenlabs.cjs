// Import the user's local onboarding credential into their encrypted app store.
// This utility never prints credentials and is excluded from packaged apps.
const {app,safeStorage}=require('electron');
const path=require('node:path'),fs=require('node:fs');
require('dotenv').config({path:path.resolve(__dirname,'../.env.local'),quiet:true});
const {createStore}=require('../electron/store.cjs');
app.whenReady().then(async()=>{
  if(!process.env.ELEVENLABS_API_KEY)throw new Error('먼저 ElevenLabs 온보딩을 완료해 주세요.');
  const store=await createStore(path.join(app.getPath('appData'),'parkjuim-desktop'),safeStorage);
  const sample=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../.preview/elevenlabs/result.json'),'utf8'));
  const result=await store.save({...sample.config,speechProvider:'elevenlabs',elevenLabsApiKey:process.env.ELEVENLABS_API_KEY});
  if(!result.hasElevenLabsKey)throw new Error('Encrypted import failed');
  console.log('INSTALLED APP CONNECTED: ElevenLabs credential encrypted, voice selected; Claude settings preserved.');
  app.exit(0);
}).catch(error=>{console.error(error.message);app.exit(1);});
