const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const MODEL_ID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const MAX_BYTES=20*1024*1024;
function imageSize(bytes,mime){
  if(mime==='image/png'&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  if(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){
    let offset=2;while(offset+9<bytes.length){if(bytes[offset++]!==255)continue;let marker=bytes[offset++];while(marker===255&&offset<bytes.length)marker=bytes[offset++];if(marker===217||marker===218)break;if(marker===0||marker===1||marker>=208&&marker<=215)continue;
      const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];offset+=length;
    }
  }
  throw new Error('모델의 텍스처는 GLB 안에 포함된 PNG·JPEG를 사용해 주세요.');
}
function inspectGLB(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<20||buffer.length>MAX_BYTES||buffer.readUInt32LE(0)!==0x46546c67||buffer.readUInt32LE(4)!==2||buffer.readUInt32LE(8)!==buffer.length)throw new Error('20MB 이하의 올바른 GLB 2.0 파일을 선택해 주세요.');
  let json,binary,offset=12,chunks=0;
  while(offset<buffer.length){
    if(offset+8>buffer.length||++chunks>2)throw new Error('GLB 파일 구성을 확인해 주세요.');
    const length=buffer.readUInt32LE(offset),type=buffer.readUInt32LE(offset+4);offset+=8;
    if(length%4||offset+length>buffer.length)throw new Error('GLB 파일 길이가 올바르지 않아요.');
    if(type===0x4e4f534a&&!json&&chunks===1){if(length>2*1024*1024)throw new Error('GLB 모델 정보가 너무 많아요.');try{json=JSON.parse(buffer.subarray(offset,offset+length).toString('utf8'));}catch{throw new Error('GLB 모델 정보를 읽지 못했어요.');}}
    else if(type===0x004e4942&&!binary)binary=buffer.subarray(offset,offset+length);
    else throw new Error('JSON·BIN을 포함한 일반 GLB 파일로 내보내 주세요.');offset+=length;
  }
  if(!json||json.asset?.version!=='2.0'||!binary)throw new Error('메시·텍스처를 한 파일에 포함한 GLB 2.0을 사용해 주세요.');
  for(const [key,max]of [['nodes',1000],['meshes',100],['accessors',2000],['bufferViews',2000],['images',20],['animations',30],['scenes',10],['materials',100]])if(json[key]!==undefined&&(!Array.isArray(json[key])||json[key].length>max))throw new Error('모델이 너무 복잡해요. 메시·텍스처·애니메이션 수를 줄여 주세요.');
  if(!json.meshes?.length||!json.nodes?.length||!json.scenes?.length||!Array.isArray(json.buffers)||json.buffers.length!==1||json.buffers.some(item=>item.uri!==undefined)||!Number.isInteger(json.buffers[0].byteLength)||json.buffers[0].byteLength<1||json.buffers[0].byteLength>binary.length)throw new Error('외부 파일 없이 메시를 포함한 GLB를 선택해 주세요.');
  if((json.extensionsUsed||[]).some(name=>['KHR_draco_mesh_compression','KHR_texture_basisu','EXT_meshopt_compression'].includes(name)))throw new Error('Draco·KTX2·Meshopt 압축을 끄고 GLB로 다시 내보내 주세요.');
  for(const view of json.bufferViews||[])if(view.buffer!==0||!Number.isInteger(view.byteLength)||view.byteLength<0||!Number.isInteger(view.byteOffset??0)||(view.byteOffset??0)<0||(view.byteOffset??0)+view.byteLength>binary.length)throw new Error('모델의 메시·이미지 데이터 범위를 확인해 주세요.');
  let vertices=0,primitives=0,pixels=0;
  for(const mesh of json.meshes)for(const primitive of mesh.primitives||[]){if(++primitives>400)throw new Error('모델의 메시 조각을 400개 이하로 줄여 주세요.');const accessor=json.accessors?.[primitive.attributes?.POSITION];if(!accessor||!Number.isInteger(accessor.count)||accessor.count<1||(vertices+=accessor.count)>500000)throw new Error('모델의 정점을 50만 개 이하로 줄여 주세요.');}
  const meshVertices=json.meshes.map(mesh=>(mesh.primitives||[]).reduce((sum,primitive)=>sum+json.accessors[primitive.attributes.POSITION].count,0));let sceneVertices=0;
  for(const node of json.nodes)if(node.mesh!==undefined){if(!Number.isInteger(node.mesh)||!meshVertices[node.mesh]||(sceneVertices+=meshVertices[node.mesh])>500000)throw new Error('반복 배치한 메시를 포함해 정점을 50만 개 이하로 줄여 주세요.');}
  if((json.extensionsUsed||[]).includes('EXT_mesh_gpu_instancing'))throw new Error('인스턴싱 없이 GLB로 내보내 주세요.');
  for(const animation of json.animations||[])if(!Array.isArray(animation.channels)||!Array.isArray(animation.samplers)||animation.channels.length>300||animation.samplers.length>300)throw new Error('애니메이션 채널을 줄여서 다시 내보내 주세요.');
  for(const image of json.images||[]){
    if(image.uri!==undefined||!Number.isInteger(image.bufferView))throw new Error('텍스처를 외부 링크 없이 GLB 안에 포함해 주세요.');
    const view=json.bufferViews[image.bufferView];if(!view)throw new Error('텍스처 데이터가 없어요.');
    const start=view.byteOffset||0,[width,height]=imageSize(binary.subarray(start,start+view.byteLength),image.mimeType);
    if(!width||!height||width>4096||height>4096||(pixels+=width*height)>16777216)throw new Error('텍스처는 한 장당 4096px 이하, 전체 1,600만 픽셀 이하로 줄여 주세요.');
  }
  const visiting=new Set(),visited=new Set();
  function visit(index,depth=0){if(!Number.isInteger(index)||index<0||index>=json.nodes.length||depth>100||visiting.has(index))throw new Error('모델의 뼈대·노드 연결을 확인해 주세요.');if(visited.has(index))return;visiting.add(index);for(const child of json.nodes[index].children||[])visit(child,depth+1);visiting.delete(index);visited.add(index);}
  json.nodes.forEach((_,index)=>visit(index));
  return {vertices,animations:(json.animations||[]).map((animation,index)=>String(animation.name||`Animation ${index+1}`).slice(0,100))};
}
async function createModelStore(directory){
  const root=path.join(directory,'characters'),indexFile=path.join(root,'index.json');await fs.mkdir(root,{recursive:true});let records=[];let queue=Promise.resolve();
  try{records=JSON.parse(await fs.readFile(indexFile,'utf8'));if(!Array.isArray(records)||records.length>20||records.some(record=>!MODEL_ID.test(record.id)||typeof record.name!=='string'||!Array.isArray(record.animations)))throw new Error('Invalid model library');}catch(error){if(error.code!=='ENOENT')throw new Error('캐릭터 목록을 읽지 못했어요. 기존 파일은 보존했어요.');}
  const file=(id,extension=records.find(record=>record.id===id)?.extension||'glb')=>{if(typeof id!=='string'||!MODEL_ID.test(id)||!['glb','png','jpg'].includes(extension))throw new Error('캐릭터 ID를 확인해 주세요.');return path.join(root,`${id}.${extension}`);};
  const write=async next=>{await fs.writeFile(`${indexFile}.tmp`,JSON.stringify(next),{mode:0o600});await fs.rename(`${indexFile}.tmp`,indexFile);records=next;};
  function mutate(action){const operation=queue.then(action);queue=operation.catch(()=>{});return operation;}
  return {
    list:()=>structuredClone(records),
    has:id=>records.some(record=>record.id===id),
    info:id=>structuredClone(records.find(record=>record.id===id)),
    read:async id=>{if(!records.some(record=>record.id===id))throw new Error('캐릭터를 찾지 못했어요.');return fs.readFile(file(id));},
    add:source=>mutate(async()=>{
      if(records.length>=20)throw new Error('추가 캐릭터는 20개까지 보관해요. 필요 없는 캐릭터를 삭제해 주세요.');
      const ext=typeof source==='string'?path.extname(source).toLowerCase():'';
      if(ext!=='.glb')throw new Error('GLB 모델 파일을 선택해 주세요.');
      const handle=await fs.open(source,'r');let bytes;
      try{const stat=await handle.stat(),limit=ext==='.glb'?MAX_BYTES:6*1024*1024;if(!stat.isFile()||stat.size>limit||stat.size<20)throw new Error('이미지는 6MB, GLB 모델은 20MB 이하로 선택해 주세요.');bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const result=await handle.read(bytes,offset,bytes.length-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}const after=await handle.stat();if(offset!==bytes.length||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new Error('파일이 바뀌었어요. 다시 선택해 주세요.');}finally{await handle.close();}
      const kind='model',extension='glb',contentType='model/gltf-binary';
      const details=inspectGLB(bytes);
      const id=randomUUID(),record={id,name:path.basename(source,path.extname(source)).slice(0,100),size:bytes.length,kind,extension,contentType,...details};
      await fs.writeFile(file(id,extension),bytes,{flag:'wx',mode:0o600});try{await write([...records,record]);}catch(error){await fs.unlink(file(id,extension));throw error;}return structuredClone(record);
    }),
    remove:id=>mutate(async()=>{if(!records.some(record=>record.id===id))throw new Error('캐릭터를 찾지 못했어요.');const target=file(id);await write(records.filter(record=>record.id!==id));try{await fs.unlink(target);}catch(error){if(error.code!=='ENOENT')throw error;}return {ok:true};})
  };
}
module.exports={createModelStore,inspectGLB,MODEL_ID,MAX_BYTES};
