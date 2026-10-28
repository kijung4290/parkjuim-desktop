const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {providerInfo}=require('./providers.cjs');
const {webUrl}=require('./conversation.cjs');
const LIMITS=Object.freeze({conversations:50,turns:200,bytes:12*1024*1024});
function cleanTurn(input){
  if(!input||typeof input.user!=='string'||!input.user.trim()||input.user.length>12000||typeof input.assistant!=='string'||!input.assistant.trim())throw new Error('저장할 대화 내용을 확인해 주세요.');
  const files=(Array.isArray(input.files)?input.files:[]).slice(0,4).map(file=>({name:String(file.name||'첨부 파일').slice(0,300),format:String(file.format||'FILE').slice(0,12),size:Number.isFinite(file.size)?file.size:0}));
  const sources=[];
  for(const source of (Array.isArray(input.sources)?input.sources:[]).slice(0,30)){
    if(!['web','document'].includes(source.kind))continue;
    const entry={kind:source.kind,title:String(source.title||'출처').slice(0,180),site:String(source.site||'').slice(0,180)};
    if(source.kind==='web'){entry.url=webUrl(source.url);if(!entry.url)continue;}
    sources.push(entry);
  }
  const suggestions=(Array.isArray(input.suggestions)?input.suggestions:[]).filter(html=>typeof html==='string'&&Buffer.byteLength(html)<=200000).slice(0,36);
  return {user:input.user,assistant:input.assistant,files,sources,suggestions,search:input.search===true};
}
function validateData(value){
  if(!value||value.version!==1||!Array.isArray(value.conversations)||value.conversations.length>LIMITS.conversations)throw new Error('대화 기록 형식을 확인할 수 없어요.');
  const ids=new Set();
  for(const record of value.conversations){
    if(!record||typeof record.id!=='string'||!/^[\w-]{1,80}$/.test(record.id)||ids.has(record.id)||typeof record.title!=='string'||!record.title.trim()||record.title.length>60||typeof record.model!=='string'||!/^[\w.:-]{1,150}$/.test(record.model)||!Number.isFinite(record.createdAt)||!Number.isFinite(record.updatedAt)||!Array.isArray(record.turns)||!record.turns.length||record.turns.length>LIMITS.turns)throw new Error('대화 기록이 손상됐어요.');
    providerInfo(record.provider);ids.add(record.id);record.turns=record.turns.map(cleanTurn);
  }
  return {version:1,conversations:value.conversations.map(({id,title,provider,model,createdAt,updatedAt,turns})=>({id,title,provider,model,createdAt,updatedAt,turns}))};
}
async function createHistoryStore(directory,safeStorage){
  await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'conversations.json');
  let data={version:1,conversations:[]},queue=Promise.resolve();
  try{
    const envelope=JSON.parse(await fs.readFile(file,'utf8'));
    if(envelope.version!==1||typeof envelope.encrypted!=='string'||envelope.encrypted.length>LIMITS.bytes*2)throw new Error('Invalid history envelope');
    const decrypt=safeStorage.decryptStringAsync||safeStorage.decryptString;
    const decrypted=await decrypt.call(safeStorage,Buffer.from(envelope.encrypted,'base64'));
    const text=typeof decrypted==='string'?decrypted:decrypted?.result;
    if(typeof text!=='string'||Buffer.byteLength(text)>LIMITS.bytes)throw new Error('Invalid history size');
    data=validateData(JSON.parse(text));
  }catch(error){if(error.code!=='ENOENT')throw new Error('저장된 대화 기록을 열지 못했어요. 기존 기록 파일은 보존했어요. 같은 Windows 계정에서 다시 실행해 주세요.');}
  function mutate(change){
    const operation=queue.then(async()=>{
      const next=structuredClone(data),result=change(next),text=JSON.stringify(next);
      if(Buffer.byteLength(text)>LIMITS.bytes)throw new Error('대화 기록 저장 용량에 도달했어요. 목록에서 필요 없는 대화를 삭제해 주세요.');
      const available=safeStorage.isAsyncEncryptionAvailable||safeStorage.isEncryptionAvailable;
      if(!await available.call(safeStorage))throw new Error('대화 기록을 암호화해 저장할 수 없어요. Windows 암호화 저장소를 확인해 주세요.');
      const encrypt=safeStorage.encryptStringAsync||safeStorage.encryptString;
      const encrypted=(await encrypt.call(safeStorage,text)).toString('base64');
      await fs.writeFile(`${file}.tmp`,JSON.stringify({version:1,encrypted}),{mode:0o600});
      await fs.rename(`${file}.tmp`,file);data=next;return result;
    });queue=operation.catch(()=>{});return operation;
  }
  const find=(next,id)=>{const record=next.conversations.find(item=>item.id===id);if(!record)throw new Error('대화를 찾지 못했어요. 목록을 새로 열어 주세요.');return record;};
  return {
    list:()=>data.conversations.map(({turns,...record})=>({...record,count:turns.length,preview:turns.at(-1).assistant.slice(0,80)})).sort((a,b)=>b.updatedAt-a.updatedAt),
    get:id=>structuredClone(find(data,id)),
    append:(id,info,input)=>mutate(next=>{
      providerInfo(info.provider);if(typeof info.model!=='string'||!/^[\w.:-]{1,150}$/.test(info.model))throw new Error('대화 모델을 확인해 주세요.');
      const turn=cleanTurn(input),now=Date.now();let record;
      if(id){record=find(next,id);if(record.provider!==info.provider||record.model!==info.model)throw new Error('AI 서비스가 달라졌어요. 새 대화를 시작해 주세요.');}
      else{
        if(next.conversations.length>=LIMITS.conversations)throw new Error('대화 목록이 50개로 가득 찼어요. 필요 없는 대화를 삭제한 뒤 새 대화를 저장해 주세요.');
        record={id:randomUUID(),title:turn.user.replace(/\s+/g,' ').slice(0,40),provider:info.provider,model:info.model,createdAt:now,updatedAt:now,turns:[]};next.conversations.push(record);
      }
      if(record.turns.length>=LIMITS.turns)throw new Error('이 대화는 저장 한도 200회에 도달했어요. 새 대화를 시작해 주세요.');
      record.turns.push(turn);record.updatedAt=now;return record.id;
    }),
    rename:(id,title)=>mutate(next=>{if(typeof title!=='string'||!title.trim()||title.trim().length>60)throw new Error('대화 이름은 1~60자로 입력해 주세요.');find(next,id).title=title.trim();return {ok:true};}),
    remove:id=>mutate(next=>{find(next,id);next.conversations=next.conversations.filter(record=>record.id!==id);return {ok:true};}),
    clear:()=>mutate(next=>{next.conversations=[];return {ok:true};})
  };
}
module.exports={createHistoryStore,cleanTurn,LIMITS};
