const PROVIDERS=Object.freeze({
  claude:{id:'claude',label:'Claude',company:'Anthropic',modelField:'model',keyField:'encryptedKey',inputField:'apiKey',clearField:'clearKey',hasField:'hasKey',defaultModel:'claude-sonnet-5-5',models:['claude-sonnet-5-5','claude-opus-5-5','claude-haiku-5-5'],keyUrl:'https://platform.claude.com/settings/keys'},
  gemini:{id:'gemini',label:'Gemini',company:'Google',modelField:'geminiModel',keyField:'encryptedGeminiKey',inputField:'geminiApiKey',clearField:'clearGeminiKey',hasField:'hasGeminiKey',defaultModel:'gemini-3.8-flash',models:['gemini-3.8-flash','gemini-4-argon','gemini-2.5-flash'],keyUrl:'https://aistudio.google.com/api-keys'},
  openai:{id:'openai',label:'GPT',company:'OpenAI',modelField:'openaiModel',keyField:'encryptedOpenAIKey',inputField:'openaiApiKey',clearField:'clearOpenAIKey',hasField:'hasOpenAIKey',defaultModel:'gpt-5-mini',models:['gpt-5-mini','gpt-6-sol','gpt-6-astra'],keyUrl:'https://platform.openai.com/api-keys'}
});
function providerInfo(id){if(typeof id!=='string'||!Object.hasOwn(PROVIDERS,id))throw new Error('AI 서비스를 확인해 주세요.');return PROVIDERS[id];}
function selectedAI(settings){const info=providerInfo(settings.aiProvider||'claude');return {...info,model:settings[info.modelField]||info.defaultModel};}
function validKey(provider,value){
  const info=providerInfo(provider),key=typeof value==='string'?value.trim():'';
  if(!(provider==='claude'?/^sk-ant-[\w-]{12,}$/:/^[\w-]{20,512}$/).test(key))throw new Error(`${info.label} API 키 형식을 확인해 주세요.`);
  return key;
}
module.exports={PROVIDERS,providerInfo,selectedAI,validKey};
