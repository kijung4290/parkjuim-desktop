export const MAX_MODEL_BYTES=20*1024*1024;
export async function readModelFile(file){
  if(!file||typeof file.name!=='string'||!/\.glb$/i.test(file.name)||file.name.length>300)throw new Error('실제 3D 모델인 .glb 파일을 선택해 주세요.');
  if(!Number.isInteger(file.size)||file.size<20||file.size>MAX_MODEL_BYTES)throw new Error('GLB 파일은 20MB 이하로 선택해 주세요.');
  if(typeof file.arrayBuffer!=='function')throw new Error('파일을 읽지 못했어요. 탐색기에서 다시 선택해 주세요.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.byteLength!==file.size)throw new Error('파일을 끝까지 읽지 못했어요. 다시 선택해 주세요.');
  return {name:file.name,bytes};
}
