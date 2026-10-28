const {randomUUID}=require('node:crypto');
const {CONTINUE_PROMPT,CONTINUE_PROGRESS,checkContext,checkContinuation}=require('./reply.cjs');
const MAX_REQUEST=28*1024*1024;
class ConversationError extends Error {}
function validateTurn(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.text!=='string'||input.text.length>12000)throw new ConversationError('대화 내용을 확인해 주세요. 한 번에 12,000자까지 보낼 수 있어요.');
  const attachmentIds=input.attachmentIds??[];
  if(!Array.isArray(attachmentIds)||attachmentIds.length>4||attachmentIds.some(id=>typeof id!=='string'||id.length>100)||new Set(attachmentIds).size!==attachmentIds.length)throw new ConversationError('첨부 파일은 4개까지 선택해 주세요.');
  const text=input.text.trim()||(attachmentIds.length?'첨부한 파일의 핵심 내용을 분석하고 요약해 주세요.':'');
  if(!text)throw new ConversationError('메시지를 입력하거나 파일을 첨부해 주세요.');
  if(input.search!==undefined&&typeof input.search!=='boolean')throw new ConversationError('검색 설정을 확인해 주세요.');
  return {text,attachmentIds,search:input.search===true};
}
function webUrl(value){
  if(typeof value!=='string'||value.length>2048)return null;
  try{
    const url=new URL(value),host=url.hostname.toLowerCase();
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!host)return null;
    if(host==='localhost'||host.endsWith('.local')||/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)||host.startsWith('['))return null;
    return url.href;
  }catch{return null;}
}
function createConversation({attachments}){
  let turns=[],carriedFiles=[],active=false;
  const links=new Map();
  async function send(input,{client,model,system,signal,emit=()=>{}}){
    if(active)throw new ConversationError('답변을 마치거나 중지한 뒤 다시 보내 주세요.');
    const turn=validateTurn(input),files=attachments.get(turn.attachmentIds);
    const blocks=files.flatMap(file=>file.blocks);
    const user={role:'user',content:blocks.length?[...blocks,{type:'text',text:turn.text}]:turn.text};
    // Retain attachment blocks when old dialogue is trimmed. This preserves
    // document indices used by citations and keeps files available for follow-ups.
    const removed=turns.slice(0,Math.max(0,turns.length-11));
    const carried=[...carriedFiles,...removed.flatMap(item=>Array.isArray(item.messages[0].content)?item.messages[0].content.slice(0,-1):[])];
    const recent=turns.slice(-11);
    const context=[...(carried.length?[{role:'user',content:[...carried,{type:'text',text:'이전 대화에서 첨부한 자료입니다.'}]}]:[]),...recent.flatMap(item=>item.messages),user];
    if(Buffer.byteLength(JSON.stringify(context))>MAX_REQUEST)throw new ConversationError('이 대화의 파일과 내용이 너무 많아요. 새 대화를 시작한 뒤 파일을 첨부해 주세요.');
    const documents=context.flatMap(message=>Array.isArray(message.content)?message.content.filter(block=>block.type==='document'):[]);
    let text='',searches=0;
    const citations=[],seen=new Set(),responses=[],newLinks=new Map();
    const append=delta=>{text+=delta;emit({type:'delta',text:delta});};
    function cite(citation){
      let entry,key;
      if(citation.type==='web_search_result_location'){
        const url=webUrl(citation.url);if(!url)return;
        key=url;entry={id:randomUUID(),kind:'web',title:String(citation.title||new URL(url).hostname).slice(0,180),site:new URL(url).hostname,url};
      }else if(['page_location','char_location','content_block_location'].includes(citation.type)){
        const document=documents[citation.document_index];if(!document)return;
        const page=Number.isInteger(citation.start_page_number)?citation.start_page_number:null;
        const end=Number.isInteger(citation.end_page_number)?Math.max(page,citation.end_page_number-1):page;
        const label=page?`${page===end?page:`${page}–${end}`}쪽`:'본문';
        key=`document:${citation.document_index}:${label}`;entry={id:randomUUID(),kind:'document',title:document.title||'첨부 문서',site:label};
      }else return;
      if(seen.has(key))return;seen.add(key);
      if(citations.length>=30)return;
      if(entry.url)newLinks.set(entry.id,entry.url);
      const {url,...publicEntry}=entry;citations.push(publicEntry);emit({type:'sources',sources:[...citations]});
    }
    active=true;
    try{
      if(files.length)emit({type:'progress',message:'첨부 파일을 살펴보고 있어요'});
      let pauses=0,previousChunk='',lengthContinuation=false;
      while(true){
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        try{checkContext(context);}catch(error){throw new ConversationError(error.message);}
        const start=text.length;
        let firstTextBlock=true;
        const params={model,max_tokens:8192,system,messages:context};
        if(turn.search)params.tools=[{type:'web_search_20250305',name:'web_search',max_uses:Math.max(1,3-searches)}];
        const stream=client.messages.stream(params,{signal});
        stream.on('text',append);
        stream.on('citation',cite);
        stream.on('streamEvent',event=>{
          if(event.type==='content_block_start'&&event.content_block.type==='text'){
            if(text&&!text.endsWith('\n')&&!(lengthContinuation&&firstTextBlock))append('\n\n');
            firstTextBlock=false;
          }
          if(event.type==='content_block_start'&&event.content_block.type==='server_tool_use'&&event.content_block.name==='web_search'){
            searches++;emit({type:'progress',message:'웹에서 정보를 찾고 있어요'});
          }
          if(event.type==='content_block_start'&&event.content_block.type==='web_search_tool_result'){
            const result=event.content_block.content;
            if(!Array.isArray(result)&&result?.type==='web_search_tool_result_error')emit({type:'notice',text:result.error_code==='max_uses_exceeded'?'이번 질문의 검색 횟수에 도달했어요.':'웹 검색을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.'});
          }
        });
        const message=await stream.finalMessage();
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        // Preserve search encrypted_content, citations and thinking signatures
        // exactly; only safe source metadata and answer text leave main.
        const assistant={role:'assistant',content:message.content};responses.push(assistant);context.push(assistant);
        if(message.stop_reason==='pause_turn'){
          if(++pauses>=3||searches>=3)throw new ConversationError('검색이 길어졌어요. 질문 범위를 줄여 다시 보내 주세요.');
          emit({type:'progress',message:'검색 결과를 더 확인하고 있어요'});continue;
        }
        if(message.stop_reason==='max_tokens'){
          const chunk=text.slice(start);
          try{checkContinuation(chunk,previousChunk);}catch(error){throw new ConversationError(error.message);}
          previousChunk=chunk;lengthContinuation=true;
          const followup={role:'user',content:CONTINUE_PROMPT};context.push(followup);responses.push(followup);
          emit({type:'progress',message:CONTINUE_PROGRESS});continue;
        }
        if(message.stop_reason==='model_context_window_exceeded')emit({type:'notice',text:'모델의 대화 문맥 한도에 도달했어요. 받은 답변은 보존했어요. 새 대화에서 이어갈 부분을 보내 주세요.'});
        if(message.stop_reason==='tool_use')throw new ConversationError('이 요청에 필요한 도구를 사용할 수 없어요. 질문을 바꾸어 다시 보내 주세요.');
        if(!text.trim())throw new ConversationError('답변 텍스트를 받지 못했어요. 질문을 줄여 다시 보내 주세요.');
        attachments.markUsed(turn.attachmentIds);
        carriedFiles=carried;turns=[...recent,{messages:[user,...responses]}];
        for(const [id,url]of newLinks)links.set(id,url);
        // Bound source links alongside the in-memory chat session.
        while(links.size>360)links.delete(links.keys().next().value);
        return {text,sources:citations,searches};
      }
    }finally{active=false;}
  }
  const reset=()=>{if(active)throw new ConversationError('답변을 중지한 뒤 새 대화를 시작해 주세요.');turns=[];carriedFiles=[];links.clear();attachments.clear();};
  function restore(saved){
    const restored=saved.slice(-12).map(turn=>{validateTurn({text:turn.user});if(typeof turn.assistant!=='string'||!turn.assistant.trim())throw new ConversationError('저장된 대화를 확인해 주세요.');return {messages:[{role:'user',content:turn.user},{role:'assistant',content:turn.assistant}]};});
    reset();turns=restored;
  }
  return {send,reset,restore,source:id=>links.get(id),inspect:()=>({turns:turns.length,active})};
}
module.exports={createConversation,validateTurn,webUrl,ConversationError};
