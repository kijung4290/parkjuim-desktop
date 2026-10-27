const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const XLSX=require('xlsx');
const {contentFor,decodeText,createAttachmentStore,officeText}=require('../electron/attachments.cjs');
const {wordDocument,pdfDocument}=require('./fixtures.cjs');
test('attachments create native PDF and image blocks while enforcing types and text decoding',async()=>{
  const pdf=await contentFor('report.pdf',pdfDocument());assert.equal(pdf[0].source.media_type,'application/pdf');assert.equal(pdf[0].citations.enabled,true);
  const image=await contentFor('picture.png',Buffer.from('89504e470d0a1a0a','hex'));assert.equal(image[1].type,'image');assert.equal(image[1].source.media_type,'image/png');
  assert.equal(decodeText(Buffer.from([0xb0,0xa1])),'가');
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('보고서','utf16le')])),'보고서');
  await assert.rejects(contentFor('bad.png',Buffer.from('not an image')),/형식/);
  await assert.rejects(contentFor('bad.pdf',Buffer.from('not a PDF')),/PDF/);
  await assert.rejects(contentFor('run.exe',Buffer.from('MZ')),/첨부/);
  await assert.rejects(contentFor('binary.txt',Buffer.from([0,0,0,0])),/텍스트/);
  await assert.rejects(contentFor('huge.txt',Buffer.from('a'.repeat(150001))),/15만/);
});
test('Word and Excel parse in workers without executing formulas or losing Korean cell text',async()=>{
  const doc=await officeText(await wordDocument('사업 예산 합계 200'),'.docx');assert.match(doc,/사업 예산 합계 200/);
  const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([['항목','금액'],['재료비',120],['교통비',80],['합계',{t:'n',f:'B2+B3',v:200}]]);
  XLSX.utils.book_append_sheet(workbook,sheet,'예산');
  for(const [extension,bookType]of [['.xlsx','xlsx'],['.xls','biff8']]){
    const text=await officeText(XLSX.write(workbook,{type:'buffer',bookType}),extension);
    assert.match(text,/예산/);assert.match(text,/재료비/);assert.match(text,/200/);
  }
  await assert.rejects(officeText(Buffer.from('bad'),'.docx'),/손상|형식/);
});
test('only approved files become opaque attachment IDs and pending removal frees them',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'parkjuim-files-'));
  try{
    const file=path.join(directory,'private.txt');await fs.writeFile(file,'Sample analysis material');
    const store=createAttachmentStore(),result=await store.addPaths([file]);
    assert.equal(result.files.length,1);assert.equal(result.files[0].path,undefined);assert.equal(result.files[0].blocks,undefined);
    const id=result.files[0].id;assert.equal(store.get([id])[0].blocks[0].source.data,'Sample analysis material');
    store.remove(id);assert.throws(()=>store.get([id]),/다시 첨부/);
    const used=(await store.addPaths([file])).files[0].id;store.markUsed([used]);store.remove(used);assert.equal(store.get([used]).length,1);
    assert.throws(()=>store.get([used,used]),/서로 다른/);store.clear();assert.throws(()=>store.get([used]));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
