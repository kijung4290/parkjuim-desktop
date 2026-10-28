const {randomUUID}=require('node:crypto');
const {Parser}=require('htmlparser2');
const {createConversation,validateTurn,webUrl,ConversationError}=require('./conversation.cjs');
const {providerInfo}=require('./providers.cjs');
const {CONTINUE_PROMPT,CONTINUE_PROGRESS,checkContext,checkContinuation}=require('./reply.cjs');

function createClient(apiKey,provider='claude'){
  providerInfo(provider);
  if(provider==='openai')return new (require('openai'))({apiKey,maxRetries:0,timeout:600000});
  if(provider==='gemini')return new (require('@google/genai').GoogleGenAI)({apiKey});
  return new (require('@anthropic-ai/sdk'))({apiKey,maxRetries:0,timeout:600000});
}
async function listModels(provider,apiKey){
  const client=createClient(apiKey,provider),models=[];
  if(provider==='gemini'){
    const page=await client.models.list({config:{pageSize:100,httpOptions:{timeout:20000}}});
    for await(const model of page){
      if(model.name?.startsWith('models/gemini-')&&(!model.supportedActions||model.supportedActions.includes('generateContent')))models.push(model.name.replace(/^models\//,''));
      if(models.length>=200)break;
    }
  }else{
    for await(const model of client.models.list({}, {timeout:20000})){
      if(provider==='claude'||/^gpt-/.test(model.id))models.push(model.id);
      if(models.length>=200)break;
    }
  }
  return [...new Set(models)].sort();
}
function fileParts(blocks,provider){
  return blocks.map(block=>{
    if(block.type==='text')return provider==='openai'?{type:'input_text',text:block.text}:{type:'text',text:block.text};
    const source=block.source;
    if(block.type==='document'&&source.type==='text'){
      const text=`[첨부 문서: ${block.title}]\n${source.data}`;
      return provider==='openai'?{type:'input_text',text}:{type:'text',text};
    }
    if(provider==='gemini')return {type:block.type==='image'?'image':'document',data:source.data,mime_type:source.media_type};
    const data=`data:${source.media_type};base64,${source.data}`;
    return block.type==='image'?{type:'input_image',image_url:data,detail:'auto'}:{type:'input_file',filename:block.title||'attachment.pdf',file_data:data};
  });
}
function userInput(blocks,text,provider){
  const content=[...fileParts(blocks,provider),{type:provider==='openai'?'input_text':'text',text}];
  return provider==='openai'?{role:'user',content}:{type:'user_input',content};
}
function parseGrounding(html){
  if(typeof html!=='string'||Buffer.byteLength(html)>200000)return null;
  const urls=new Set();
  const parser=new Parser({onopentag(name,attrs){if(name==='a'){const url=webUrl(attrs.href);if(url)urls.add(url);}}},{decodeEntities:true});parser.end(html);
  return {html,urls};
}
// Each provider retains its native response items (including opaque reasoning
// signatures) in main-process memory. Changing providers resets this context.
function createAIConversation({attachments}){
  const claude=createConversation({attachments});
  let provider=null,turns=[],carried=[],active=false;
  const links=new Map(),groundings=new Map();
  function addGrounding(html){
    const document=parseGrounding(html);if(!document)return null;
    const id=randomUUID();groundings.set(id,document);while(groundings.size>36)groundings.delete(groundings.keys().next().value);
    return id;
  }
  async function send(input,options){
    const selected=options.provider||'claude';providerInfo(selected);
    if(provider&&provider!==selected)throw new ConversationError('AI 서비스가 변경됐어요. 새 대화를 시작해 주세요.');
    provider=selected;
    if(selected==='claude')return claude.send(input,options);
    if(active)throw new ConversationError('답변을 마치거나 중지한 뒤 다시 보내 주세요.');
    const {client,model,system,signal,emit=()=>{}}=options,turn=validateTurn(input),files=attachments.get(turn.attachmentIds);
    const blocks=files.flatMap(file=>file.blocks),recent=turns.slice(-11);
    const carriedNext=[...carried,...turns.slice(0,Math.max(0,turns.length-11)).flatMap(item=>item.blocks)];
    const user=userInput(blocks,turn.text,selected);
    const context=[...(carriedNext.length?[userInput(carriedNext,'이전 대화에서 첨부한 자료입니다.',selected)]:[]),...recent.flatMap(item=>item.native),user];
    if(Buffer.byteLength(JSON.stringify(context))>28*1024*1024)throw new ConversationError('대화와 파일이 너무 많아요. 새 대화를 시작해 주세요.');
    const sources=[],sourceUrls=new Set(),newLinks=new Map(),suggestions=[];
    function cite(annotation){
      if(annotation.type!=='url_citation')return;
      const url=webUrl(annotation.url);if(!url||sourceUrls.has(url)||sources.length>=30)return;
      sourceUrls.add(url);const id=randomUUID();newLinks.set(id,url);
      sources.push({id,kind:'web',title:String(annotation.title||new URL(url).hostname).slice(0,180),site:new URL(url).hostname});
    }
    let text='',searches=0,previousChunk='';
    const native=[user];
    active=true;
    try{
      emit({type:'progress',message:turn.search?'웹 검색과 답변을 준비하고 있어요':files.length?'첨부 파일을 살펴보고 있어요':'답변을 준비하고 있어요'});
      while(true){
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        try{checkContext(context);}catch(error){throw new ConversationError(error.message);}
        let output,chunk='',incomplete=false;
        if(selected==='openai'){
          const params={model,instructions:system,input:[...context],store:false,include:['reasoning.encrypted_content']};
          if(turn.search){params.tools=[{type:'web_search'}];params.max_tool_calls=3;}
          const stream=client.responses.stream(params,{signal});
          stream.on('response.output_text.delta',event=>{chunk+=event.delta;text+=event.delta;emit({type:'delta',text:event.delta});});
          stream.on('response.web_search_call.searching',()=>emit({type:'progress',message:'웹에서 정보를 찾고 있어요'}));
          const response=await stream.finalResponse();
          if(response.error||response.status==='failed')throw new ConversationError('GPT가 요청을 완료하지 못했어요. 모델·파일·검색 설정을 확인해 주세요.');
          output=response.output||[];
          let finalText='';
          for(const item of output){
            if(item.type==='web_search_call')searches++;
            if(item.type==='message')for(const part of item.content||[]){if(part.type==='output_text'){finalText+=part.text;for(const annotation of part.annotations||[])cite(annotation);}else if(part.type==='refusal')finalText+=part.refusal;}
          }
          if(!chunk&&finalText){emit({type:'delta',text:finalText});text+=finalText;chunk=finalText;}
          incomplete=response.status==='incomplete'&&response.incomplete_details?.reason==='max_output_tokens';
          if(response.status==='incomplete'&&!incomplete)emit({type:'notice',text:'GPT가 답변을 끝까지 생성하지 못했어요. 받은 내용은 보존했어요.'});
        }else{
          const params={model,system_instruction:system,input:[...context],store:false};
          if(turn.search)params.tools=[{type:'google_search'}];
          // A completed interaction provides every native step and signature for
          // stateless follow-ups; no server-side conversation ID is persisted.
          const response=await client.interactions.create(params,{signal,timeout_ms:600000,retry_codes:[]});
          if(response.status&& !['completed','incomplete'].includes(response.status))throw new ConversationError('Gemini가 답변을 완료하지 못했어요. 질문을 줄이거나 모델을 바꿔 주세요.');
          incomplete=response.status==='incomplete';
          output=response.steps||[];
          for(const step of output){
            if(step.type==='google_search_call')searches++;
            if(step.type==='google_search_result'){
              if(step.is_error)emit({type:'notice',text:'Google 검색을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.'});
              for(const result of step.result||[]){const id=addGrounding(result.search_suggestions);if(id)suggestions.push(id);}
            }
            if(step.type==='model_output')for(const part of step.content||[]){if(part.type==='text'){chunk+=part.text;for(const annotation of part.annotations||[])cite(annotation);}}
          }
          if(chunk){text+=chunk;emit({type:'delta',text:chunk});}
        }
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        native.push(...output);context.push(...output);
        if(!incomplete)break;
        try{checkContinuation(chunk,previousChunk);}catch(error){throw new ConversationError(error.message);}
        previousChunk=chunk;
        const followup=userInput([],CONTINUE_PROMPT,selected);context.push(followup);native.push(followup);
        emit({type:'progress',message:CONTINUE_PROGRESS});
      }
      if(!text.trim())throw new ConversationError('답변 텍스트를 받지 못했어요. 모델과 질문을 확인해 주세요.');
      attachments.markUsed(turn.attachmentIds);carried=carriedNext;turns=[...recent,{native,blocks}];
      for(const [id,url]of newLinks)links.set(id,url);while(links.size>360)links.delete(links.keys().next().value);
      return {text,sources,searches,suggestions};
    }finally{active=false;}
  }
  function reset(){if(active)throw new ConversationError('답변을 중지한 뒤 새 대화를 시작해 주세요.');claude.reset();provider=null;turns=[];carried=[];links.clear();groundings.clear();}
  function restore(record){
    providerInfo(record.provider);
    const saved=record.turns.slice(-12);for(const turn of saved){validateTurn({text:turn.user});if(typeof turn.assistant!=='string'||!turn.assistant.trim())throw new ConversationError('저장된 대화를 확인해 주세요.');}
    reset();provider=record.provider;
    if(provider==='claude')claude.restore(saved);
    else turns=saved.map(turn=>({blocks:[],native:[userInput([],turn.user,provider),provider==='openai'?{role:'assistant',content:turn.assistant}:{type:'model_output',content:[{type:'text',text:turn.assistant}]}]}));
  }
  return {send,reset,restore,source:id=>links.get(id)||claude.source(id),inspect:()=>provider==='claude'?claude.inspect():({turns:turns.length,active}),grounding:id=>groundings.get(id)?.html,suggestionLink:url=>{const safe=webUrl(url);return !!safe&&[...groundings.values()].some(item=>item.urls.has(safe));}};
}
module.exports={createClient,listModels,createAIConversation,fileParts,parseGrounding};
