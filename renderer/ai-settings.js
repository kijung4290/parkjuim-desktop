const $=selector=>document.querySelector(selector);
export const AI={claude:{label:'Claude',company:'Anthropic',model:'model',key:'apiKey',clear:'clearKey',has:'hasKey',link:'console',placeholder:'sk-ant-…',models:['claude-sonnet-5-5','claude-opus-5-5','claude-haiku-5-5']},gemini:{label:'Gemini',company:'Google',model:'geminiModel',key:'geminiApiKey',clear:'clearGeminiKey',has:'hasGeminiKey',link:'gemini',placeholder:'AIza…',models:['gemini-3.8-flash','gemini-4-argon','gemini-2.5-flash']},openai:{label:'GPT',company:'OpenAI',model:'openaiModel',key:'openaiApiKey',clear:'clearOpenAIKey',has:'hasOpenAIKey',link:'openai',placeholder:'sk-…',models:['gpt-5-mini','gpt-6-sol','gpt-6-astra']}};
export function createAISettings(bridge){
  let settings={},drafts={},selected='claude',generation=0;
  const loaded={};
  function snapshot(){if(drafts[selected]){drafts[selected].key=$('#api-key').value;drafts[selected].model=$('#model').value;}}
  function status(){
    const info=AI[selected],draft=drafts[selected];if(!draft)return;
    const saved=!!settings[info.has]&&!draft.clear;
    $('#key-status').textContent=draft.clear?'저장하면 삭제돼요':saved?'키 저장됨':'키 입력 필요';
    $('#key-status').classList.toggle('connected',saved);
    $('#delete-key').hidden=!saved;
  }
  function render(){
    const info=AI[selected],draft=drafts[selected];
    $('#ai-provider').value=selected;$('#api-key').value=draft.key;$('#api-key').placeholder=settings[info.has]&&!draft.clear?'저장된 키 유지 · 변경하려면 입력':info.placeholder;
    $('#model').value=draft.model;$('#ai-model-label').textContent=`${info.label} 모델`;
    $('#ai-models').replaceChildren(...(loaded[selected]||info.models).map(value=>{const option=document.createElement('option');option.value=value;return option;}));
    $('#ai-privacy').textContent=`보낸 대화·파일은 ${info.company} API로 전송되며 사용량에 따라 요금이 발생해요. 각 서비스의 구독과 API 결제는 별개예요.`;
    $('#ai-feedback').textContent='모델 목록은 계정별로 달라요. 파일·검색 지원 여부도 선택한 모델에 따라 달라요.';
    status();
  }
  $('#ai-provider').addEventListener('change',()=>{snapshot();selected=$('#ai-provider').value;generation++;render();});
  $('#delete-key').addEventListener('click',()=>{drafts[selected].clear=true;drafts[selected].key='';$('#api-key').value='';status();});
  $('#get-key').addEventListener('click',()=>bridge?.openLink(AI[selected].link));
  $('#load-models').addEventListener('click',async()=>{
    snapshot();const requested=selected,token=++generation,button=$('#load-models');button.disabled=true;$('#ai-feedback').textContent='모델 목록을 확인하고 있어요…';
    try{
      if(!bridge)throw new Error('모델 목록은 실제 앱에서 확인할 수 있어요.');
      if(drafts[requested].clear&&!drafts[requested].key.trim())throw new Error('새 API 키를 입력해 주세요.');
      const result=await bridge.aiModels({provider:requested,apiKey:drafts[requested].key});
      if(token!==generation)return;
      if(result?.error)throw new Error(result.error);
      loaded[requested]=result.models;render();$('#ai-feedback').textContent=result.models.length?`${result.models.length}개 모델을 불러왔어요. 모델 입력창에서 선택하거나 ID를 직접 입력하세요. 대화 연결은 메시지를 보내면 확인돼요.`:'모델 목록이 비어 있어요. 계정에서 제공하는 모델 ID를 직접 입력해 주세요.';
    }catch(error){if(token===generation)$('#ai-feedback').textContent=error.message;}finally{button.disabled=false;}
  });
  return {sync(next){settings={...settings,...next};status();},open(){generation++;selected=settings.aiProvider||'claude';drafts={};for(const [id,info]of Object.entries(AI))drafts[id]={key:'',clear:false,model:settings[info.model]||info.models[0]};render();},clearSensitive(){generation++;$('#api-key').value='';for(const draft of Object.values(drafts))draft.key='';},input(){snapshot();const input={aiProvider:selected};for(const [id,info]of Object.entries(AI)){const draft=drafts[id];input[info.model]=draft.model;input[info.key]=draft.key;input[info.clear]=draft.clear&&!draft.key.trim();}return input;}};
}
