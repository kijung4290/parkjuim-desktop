const yauzl=require('yauzl');
const MAX_TEXT=150000;

async function validateOfficeZip(buffer,required){
  await new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
    if(error){reject(new Error('문서가 손상됐거나 암호화되어 있어요. 암호를 해제하거나 PDF로 저장해 주세요.'));return;}
    let size=0,count=0,found=false,settled=false;
    const fail=()=>{if(settled)return;settled=true;zip.close();reject(new Error('문서 내부 용량이 너무 크거나 읽을 수 없는 형식이에요. 파일을 나누거나 PDF로 저장해 주세요.'));};
    zip.on('error',fail);
    zip.on('end',()=>{if(settled)return;settled=true;found?resolve():reject(new Error('확장자와 문서 형식이 맞지 않아요. 원래 형식으로 다시 저장해 주세요.'));});
    zip.on('entry',entry=>{
      if(settled)return;
      count++;size+=entry.uncompressedSize;
      if(count>2500||size>32*1024*1024||entry.uncompressedSize>12*1024*1024||(entry.generalPurposeBitFlag&1)){fail();return;}
      if(entry.fileName===required)found=true;
      if(entry.fileName.endsWith('/')){zip.readEntry();return;}
      zip.openReadStream(entry,(error,stream)=>{
        if(error){fail();return;}
        let read=0;
        stream.on('error',fail);
        stream.on('data',chunk=>{read+=chunk.length;if(read>entry.uncompressedSize||read>12*1024*1024){stream.destroy();fail();}});
        stream.on('end',()=>{if(!settled)zip.readEntry();});
      });
    });zip.readEntry();
  }));
}
function checkedText(text){
  text=String(text).replace(/\u0000/g,'').trim();
  if(!text)throw new Error('읽을 수 있는 텍스트가 없어요. 이미지로 된 문서는 PDF나 이미지로 첨부해 주세요.');
  if(text.length>MAX_TEXT)throw new Error('텍스트가 너무 많아요. 15만 자 이하로 문서를 나눠 첨부해 주세요.');
  return text;
}
async function parseOffice(buffer,extension){
  buffer=Buffer.from(buffer);
  if(extension==='.docx'){
    await validateOfficeZip(buffer,'word/document.xml');
    const result=await require('mammoth').extractRawText({buffer});
    return checkedText(result.value);
  }
  if(extension==='.xlsx')await validateOfficeZip(buffer,'xl/workbook.xml');
  else if(extension!=='.xls'||buffer.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1')throw new Error('Excel 파일 형식을 확인해 주세요.');
  const XLSX=require('xlsx');
  const book=XLSX.read(buffer,{type:'buffer',cellFormula:false,cellHTML:false,bookVBA:false,sheetRows:10001,dense:true});
  if(book.SheetNames.length>12)throw new Error('시트가 너무 많아요. 12개 이하로 나눠 첨부해 주세요.');
  let text='';
  for(const name of book.SheetNames){
    const sheet=book.Sheets[name],ref=sheet['!fullref']||sheet['!ref'];
    if(!ref)continue;
    const range=XLSX.utils.decode_range(ref);
    if(range.e.r>=10000||range.e.c>=256)throw new Error('큰 표는 시트당 1만 행·256열 이하로 나눠 첨부해 주세요.');
    text+=`\n[시트: ${name}]\n${XLSX.utils.sheet_to_csv(sheet,{FS:'\t',blankrows:false})}\n`;
    if(text.length>MAX_TEXT)throw new Error('표 내용이 너무 많아요. 파일을 나눠 첨부해 주세요.');
  }
  return checkedText(text);
}
module.exports={parseOffice,checkedText,MAX_TEXT};
