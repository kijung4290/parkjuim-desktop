const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {checkedText}=require('./file-parser.cjs');
const EXTENSIONS=['pdf','png','jpg','jpeg','webp','gif','txt','md','csv','json','docx','xlsx','xls'];
const MAX_FILE=6*1024*1024,MAX_TOTAL=18*1024*1024,MAX_FILES=4;
function officeText(buffer,extension){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'file-worker.cjs'),{workerData:{buffer,extension},resourceLimits:{maxOldGenerationSizeMb:128}});
    let settled=false;
    const finish=(error,text)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve(text);};
    const timer=setTimeout(()=>finish(new Error('문서를 읽는 데 시간이 너무 걸려요. 문서를 나누거나 PDF로 저장해 주세요.')),15000);
    worker.on('message',result=>finish(result.error?new Error(result.error):null,result.text));
    worker.on('error',()=>finish(new Error('문서를 읽지 못했어요. 파일을 줄이거나 PDF로 저장해 주세요.')));
    worker.on('exit',()=>{if(!settled)finish(new Error('문서 처리가 중단됐어요. 파일을 줄이거나 PDF로 저장해 주세요.'));});
  });
}
function decodeText(buffer){
  let text;
  if(buffer[0]===0xff&&buffer[1]===0xfe)text=new TextDecoder('utf-16le',{fatal:true}).decode(buffer);
  else if(buffer[0]===0xfe&&buffer[1]===0xff)text=new TextDecoder('utf-16be',{fatal:true}).decode(buffer);
  else try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{text=new TextDecoder('euc-kr',{fatal:true}).decode(buffer);}
  if(/[\u0000-\u0008\u000e-\u001f]/.test(text))throw new Error('텍스트로 읽을 수 없는 파일이에요. PDF나 원래 문서 형식으로 첨부해 주세요.');
  return checkedText(text);
}
async function contentFor(name,buffer,{parse=officeText}={}){
  const extension=path.extname(name).toLowerCase();
  const title=name.slice(0,180);
  if(extension==='.pdf'){
    if(!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('올바른 PDF 파일이 아니에요.');
    return [{type:'document',title,source:{type:'base64',media_type:'application/pdf',data:buffer.toString('base64')},citations:{enabled:true}}];
  }
  const images={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
  if(images[extension]){
    const png=buffer.subarray(0,8).toString('hex')==='89504e470d0a1a0a',jpg=buffer.subarray(0,3).toString('hex')==='ffd8ff',gif=/^GIF8[79]a$/.test(buffer.subarray(0,6).toString()),webp=buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP';
    if(!({'.png':png,'.jpg':jpg,'.jpeg':jpg,'.gif':gif,'.webp':webp})[extension])throw new Error('확장자와 이미지 형식이 맞지 않아요.');
    if(buffer.length>4.5*1024*1024)throw new Error('이미지는 4.5MB 이하로 줄여 첨부해 주세요.');
    return [{type:'text',text:`첨부 이미지: ${title}`},{type:'image',source:{type:'base64',media_type:images[extension],data:buffer.toString('base64')}}];
  }
  let text;
  if(['.docx','.xlsx','.xls'].includes(extension))text=await parse(buffer,extension);
  else if(['.txt','.md','.csv','.json'].includes(extension))text=decodeText(buffer);
  else throw new Error('PDF·이미지·TXT·MD·CSV·JSON·DOCX·XLSX·XLS 파일을 첨부할 수 있어요. HWP는 PDF로 변환해 주세요.');
  return [{type:'document',title,source:{type:'text',media_type:'text/plain',data:text},citations:{enabled:true}}];
}
function createAttachmentStore(){
  const items=new Map();let queue=Promise.resolve();
  const metadata=item=>({id:item.id,name:item.name,size:item.size,format:item.format});
  async function addPaths(paths){
    const operation=queue.then(async()=>{
      if(!Array.isArray(paths)||paths.length>MAX_FILES)throw new Error(`한 번에 ${MAX_FILES}개까지 첨부할 수 있어요.`);
      const added=[],errors=[];
      for(const file of paths){
        const name=path.basename(file);let handle;
        try{
          handle=await fs.open(file,'r');const stat=await handle.stat();
          if(!stat.isFile()||!stat.size||stat.size>MAX_FILE)throw new Error('빈 파일과 6MB가 넘는 파일은 첨부할 수 없어요.');
          if(!EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase()))throw new Error('지원하지 않는 형식이에요. PDF·이미지·텍스트·DOCX·Excel 파일을 사용해 주세요.');
          const total=[...items.values()].reduce((sum,item)=>sum+item.size,0);
          if(total+stat.size>MAX_TOTAL)throw new Error('이 대화의 첨부 용량이 18MB를 넘어요. 새 대화를 시작해 주세요.');
          const bounded=Buffer.allocUnsafe(stat.size+1);let read=0;
          while(read<bounded.length){const result=await handle.read(bounded,read,bounded.length-read,null);if(!result.bytesRead)break;read+=result.bytesRead;}
          if(read!==stat.size)throw new Error('읽는 동안 파일이 변경됐어요. 저장을 마친 뒤 다시 첨부해 주세요.');
          const buffer=bounded.subarray(0,read);
          const blocks=await contentFor(name,buffer);
          const item={id:randomUUID(),name,size:buffer.length,format:path.extname(name).slice(1).toUpperCase(),blocks,used:false};
          items.set(item.id,item);added.push(metadata(item));
        }catch(error){errors.push(`${name}: ${error.message}`);}finally{await handle?.close();}
      }
      return {files:added,errors};
    });
    queue=operation.catch(()=>{});return operation;
  }
  function get(ids){
    if(!Array.isArray(ids)||ids.length>MAX_FILES||new Set(ids).size!==ids.length)throw new Error('첨부 파일은 서로 다른 파일 4개까지 선택해 주세요.');
    return ids.map(id=>{const item=items.get(id);if(!item)throw new Error('첨부 파일이 해제되었어요. 파일을 다시 첨부해 주세요.');return item;});
  }
  return {addPaths,get,markUsed:ids=>get(ids).forEach(item=>{item.used=true;}),remove:id=>{const item=items.get(id);if(item&&!item.used)items.delete(id);},clear:()=>items.clear(),metadata:ids=>get(ids).map(metadata)};
}
module.exports={createAttachmentStore,contentFor,decodeText,EXTENSIONS,MAX_FILE,MAX_TOTAL,MAX_FILES,officeText};
