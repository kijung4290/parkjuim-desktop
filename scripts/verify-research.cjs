// Opt-in live test: sends only generated, non-personal fixtures to Claude.
const {app,safeStorage,nativeImage}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {createStore}=require('../electron/store.cjs');
const {createAttachmentStore}=require('../electron/attachments.cjs');
const {createConversation}=require('../electron/conversation.cjs');
const {SYSTEM_PROMPT}=require('../electron/core.cjs');
const {chatError}=require('../electron/chat-errors.cjs');
const {wordDocument,pdfDocument}=require('../tests/fixtures.cjs');
app.setPath('userData',path.join(app.getPath('appData'),'parkjuim-desktop'));
app.whenReady().then(async()=>{
  if(!process.argv.includes('--send'))throw new Error('Run with --send to authorize generated test files and a web search request.');
  const store=await createStore(app.getPath('userData'),safeStorage),settings=store.get();
  if(!store.key())throw new Error('Connect a Claude key in the app first');
  const directory=path.resolve(__dirname,'../.preview/research');await fs.mkdir(directory,{recursive:true});
  const XLSX=require('xlsx'),book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Item','Amount'],['Materials',120],['Transport',80],['Total',200]]),'Budget');
  const pixels=Buffer.alloc(64*64*4,255);for(let i=0;i<pixels.length;i+=4){pixels[i]=220;pixels[i+1]=140;pixels[i+2]=70;}
  const fixtures=[['budget.pdf',pdfDocument()],['budget.docx',await wordDocument()],['budget.xlsx',XLSX.write(book,{type:'buffer',bookType:'xlsx'})],['sample.png',nativeImage.createFromBitmap(pixels,{width:64,height:64}).toPNG()]];
  for(const [name,buffer]of fixtures)await fs.writeFile(path.join(directory,name),buffer);
  const attachments=createAttachmentStore(),chosen=await attachments.addPaths(fixtures.map(([name])=>path.join(directory,name)));
  if(chosen.errors.length||chosen.files.length!==4)throw new Error('Synthetic attachment parsing failed');
  const client=new(require('@anthropic-ai/sdk'))({apiKey:store.key(),maxRetries:0,timeout:150000}),session=createConversation({attachments});
  const first=await session.send({text:'첨부한 세 예산 문서의 총액을 숫자로 확인해 주세요. 그리고 web_search를 반드시 한 번 실제 사용해 Electron 공식 홈페이지 주소를 확인하고 출처를 인용해 주세요. 첨부 문서도 인용하고 답변은 한국어로 짧게 해 주세요.',attachmentIds:chosen.files.map(file=>file.id),search:true},{client,model:settings.model,system:SYSTEM_PROMPT});
  if(!first.text.includes('200')||first.searches<1||!first.sources.some(source=>source.kind==='web')||!first.sources.some(source=>source.kind==='document'))throw new Error('Live search/document citation response was incomplete');
  const second=await session.send({text:'검색은 하지 말고 방금 첨부한 Excel 표에서 교통비 Transport 금액을 숫자로 다시 알려 주세요. 한국어 한 문장으로 답해주세요.'},{client,model:settings.model,system:SYSTEM_PROMPT});
  if(!second.text.includes('80'))throw new Error('Attachment follow-up was incomplete');
  const result={files:chosen.files.length,searches:first.searches,documentCitations:first.sources.filter(source=>source.kind==='document').length,webCitations:first.sources.filter(source=>source.kind==='web').length,followup:true,success:true};
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log('RESEARCH LIVE PASS',JSON.stringify(result));app.exit(0);
}).catch(error=>{console.error('Research check failed:',error.status?chatError(error):'The generated-file/search verification did not complete. No credentials were printed.');app.exit(1);});
