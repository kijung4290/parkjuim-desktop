// Opt-in live check. --generate spends credits for ONE short Korean sample.
const fs=require('node:fs'),path=require('node:path');
require('dotenv').config({path:path.resolve(__dirname,'../.env.local'),quiet:true});
const {createElevenLabs,SAMPLE_TEXT}=require('../electron/elevenlabs.cjs');
async function main(){
  const service=createElevenLabs();
  const {voices}=await service.voices();
  if(!voices.length)throw new Error('No accessible voices');
  const voice=voices.find(item=>item.korean&&item.gender==='male') || voices.find(item=>item.id==='iP95p4xoKVk53GoZ742B') || voices[0];
  const config={elevenLabsVoiceId:voice.id,elevenLabsVoiceName:voice.name,elevenLabsModel:'eleven_v4',voiceStability:.4};
  const result={voices:voices.length,voice:voice.name,config,generated:false};
  if(process.argv.includes('--generate')){
    const audio=await service.synthesize(SAMPLE_TEXT,config);
    if(audio.length<1000)throw new Error('Audio was unexpectedly short');
    const directory=path.resolve(__dirname,'../.preview/elevenlabs');fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'sample.mp3'),audio);
    Object.assign(result,{generated:true,bytes:audio.length});
    fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));
  }
  console.log('ELEVENLABS LIVE PASS',JSON.stringify(result));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
