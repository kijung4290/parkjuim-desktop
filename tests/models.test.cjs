const{test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{createModelStore,inspectGLB}=require('../electron/models.cjs');
const{modelFixture}=require('../electron/model-fixture.cjs');
function rewrite(buffer,change){const size=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+size)),binary=buffer.subarray(28+size);change(json);const raw=Buffer.from(JSON.stringify(json)),text=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(text);const out=Buffer.alloc(28+text.length+binary.length);out.writeUInt32LE(0x46546c67);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(text.length,12);out.writeUInt32LE(0x4e4f534a,16);text.copy(out,20);out.writeUInt32LE(binary.length,20+text.length);out.writeUInt32LE(0x004e4942,24+text.length);binary.copy(out,28+text.length);return out;}
test('real binary GLB meshes and animation metadata validate while external resources and unsafe complexity are rejected',()=>{
  const file=modelFixture();assert.deepEqual(inspectGLB(file).animations,['Idle']);
  for(const modify of [json=>json.buffers[0].uri='https://example.com/secret.bin',json=>json.images=[{uri:'file:///private.png'}],json=>json.nodes[0].children=[0],json=>json.extensionsUsed=['KHR_draco_mesh_compression'],json=>json.accessors[0].count=500001,json=>json.bufferViews[0].byteLength=99999999])assert.throws(()=>inspectGLB(rewrite(file,modify)));
  assert.throws(()=>inspectGLB(Buffer.from('not a model')));const broken=Buffer.from(file);broken.writeUInt32LE(4,8);assert.throws(()=>inspectGLB(broken));
});
test('imported models copy into the profile and survive reopen; deletion never modifies the original file',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'park-model-'));
  try{
    const original=path.join(root,'my-robot.glb'),bytes=modelFixture();fs.writeFileSync(original,bytes);let store=await createModelStore(path.join(root,'profile'));
    const item=await store.add(original);assert.equal(item.kind,'model');assert.equal(item.name,'my-robot');assert.deepEqual(await store.read(item.id),bytes);assert.equal(store.list()[0].path,undefined);
    store=await createModelStore(path.join(root,'profile'));assert.equal(store.has(item.id),true);assert.deepEqual(store.info(item.id).animations,['Idle']);await store.remove(item.id);assert.equal(store.list().length,0);assert.deepEqual(fs.readFileSync(original),bytes);
    await assert.rejects(store.read('../../settings'));const image=path.join(root,'image.png');fs.writeFileSync(image,bytes);await assert.rejects(store.add(image),/GLB/);assert.equal(store.list().length,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
