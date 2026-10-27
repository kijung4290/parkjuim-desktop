import { initializeUpdates } from './updates.js';
import { createSpeechPlayer } from './speech-player.mjs';
import { createVoiceSettings } from './voice-settings.js';
import { createAttachments,showAttachedFiles,showSources } from './attachments.js';
import {createAISettings,AI} from './ai-settings.js';
import {createHistory} from './history.js';
import {createCharacterSettings} from './character-settings.js';
const $=selector=>document.querySelector(selector);
const bridge=window.park;
const aiSettings=createAISettings(bridge);
const characterSettings=createCharacterSettings(bridge);
let settings={model:'claude-sonnet-5-5',hasKey:false,roam:true,alwaysOnTop:true,speak:true,scale:1,speed:22,startAtLogin:false,nickname:'',systemPrompt:''};
let pending=null,preparing=false,listening=false,chatOpen=!bridge;
let previewTimer;
let historyUI;
function notify(text){$('#notice').textContent=text;$('#notice').hidden=!text;}
function status(text){$('#presence').textContent=text;}
const speaker=createSpeechPlayer(bridge,notify);
const voiceSettings=createVoiceSettings({bridge,player:speaker,onSettings:next=>syncSettings(next)});
const attachments=createAttachments({bridge,notify,onChange:state=>{const busy=!!pending||preparing||state.loading;$('#new-chat').disabled=busy;historyUI?.setBusy(busy);}});
historyUI=createHistory({bridge,onOpen:restoreHistory,onNew:newConversation});
function syncStartup(){const supported=!bridge||settings.startAtLoginSupported;$('#setting-start').checked=settings.startAtLogin;$('#setting-start').disabled=!supported;$('#startup-status').textContent=!supported?'자동 실행은 설치형에서 사용할 수 있어요. 아래에서 최신 설치 파일을 받아 주세요.':settings.startAtLoginBlocked?'Windows에서 사용 안 함으로 설정되어 있어요. 켜면 다시 활성화돼요.':settings.startAtLogin?'켜짐 · 다음 Windows 로그인부터 함께 시작해요.':'꺼짐 · 켜면 바로 적용돼요.';}
function syncSettings(next){settings={...settings,...next};aiSettings.sync(settings);characterSettings.sync(settings);$('#connection-tip').hidden=settings.hasSelectedKey??settings.hasKey;$('.footnote').textContent=`${AI[settings.aiProvider||'claude'].label} · ${settings.historyAvailable?'대화를 이 PC에 암호화해 저장해요':'대화 기록 저장소를 확인해 주세요'}`;$('#toggle-speech').setAttribute('aria-pressed',String(settings.speak));syncStartup();voiceSettings.sync(next);}
function scrollBottom(){const area=$('#conversation');area.scrollTop=area.scrollHeight;}
function showSuggestions(element,ids=[]){for(const id of ids){if(!/^[\w-]+$/.test(id))continue;const frame=document.createElement('iframe');frame.className='google-suggestions';frame.title='Google 검색 제안';frame.sandbox='allow-popups allow-popups-to-escape-sandbox';frame.src=`park://app/grounding/${id}`;element.append(frame);}}
function addMessage(role,text,scroll=true){$('#welcome').hidden=true;const element=document.createElement('article');element.className=`message ${role}`;const label=document.createElement('span');label.className='speaker';label.textContent=role==='user'?'나':settings.characterName||'박주임';const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=text;element.append(label,bubble);$('#messages').append(element);if(scroll)scrollBottom();return{element,bubble};}
async function restoreHistory(result){
  await speaker.stop();syncSettings(result.settings);attachments.clear();$('#messages').replaceChildren();$('#messages').setAttribute('aria-live','off');
  for(const turn of result.record.turns){const user=addMessage('user',turn.user,false);showAttachedFiles(user.element,turn.files,turn.search);const reply=addMessage('assistant',turn.assistant,false);showSources(reply.element,turn.sources,bridge,notify);showSuggestions(reply.element,turn.suggestions);toolsFor(reply,turn.assistant);}
  $('#messages').setAttribute('aria-live','polite');$('#message').value='';resizeInput();scrollBottom();status('이전 이야기를 이어가요');
  notify(result.record.turns.some(turn=>turn.files.length)?'저장된 대화를 불러왔어요. 이전 첨부 파일을 다시 분석하려면 파일을 재첨부해 주세요.':'저장된 대화를 불러왔어요. 최근 대화 문맥으로 이어갈 수 있어요.');
}
async function newConversation(){if(pending||preparing||attachments.isLoading())return false;const result=await bridge?.resetChat();if(result?.error){notify(result.error);return false;}attachments.clear();$('#messages').replaceChildren();$('#welcome').hidden=false;notify('');await speaker.stop();status('곁에 있어요');$('#message').focus();return true;}
function toolsFor(message,text){if(!text)return;const actions=document.createElement('div');actions.className='message-tools';const copy=document.createElement('button');copy.type='button';copy.textContent='복사';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(text);copy.textContent='복사했어요';setTimeout(()=>copy.textContent='복사',1500);}catch{notify('텍스트를 선택한 뒤 Ctrl+C로 복사해 주세요.');}});actions.append(copy);if(bridge){const read=document.createElement('button');read.type='button';read.textContent='다시 듣기';read.addEventListener('click',async()=>{if(!settings.speak){notify('답변 읽기를 켜면 다시 들을 수 있어요.');return;}const result=await speaker.speak(text);if(result?.error)notify(result.error);});actions.append(read);}message.element.append(actions);}
function setBusy(busy){$('#send').querySelector('use').setAttribute('href',busy?'#i-stop':'#i-send');$('#send').setAttribute('aria-label',busy?'답변 중지':'메시지 보내기');$('#new-chat').disabled=busy;$('#microphone').disabled=busy;attachments.setBusy(busy);status(busy?'생각을 고르는 중이에요':'곁에 있어요');}
function finish(event){if(!pending||event.id!==pending.id)return;const request=pending;pending=null;request.reply.bubble.classList.remove('waiting');if(event.text)request.text=event.text;request.reply.bubble.textContent=request.text||'답변을 받지 못했어요.';
  if(event.type==='done'&&request.text){showSources(request.reply.element,event.sources||request.sources,bridge,notify);showSuggestions(request.reply.element,event.suggestions);toolsFor(request.reply,request.text);if(settings.speak&&chatOpen&&document.visibilityState==='visible')speaker.speak(request.text).then(result=>{if(result?.error)notify(result.error);});}
  if(event.type==='error'){attachments.restore(request.files);const meta=document.createElement('div');meta.className='message-meta';meta.textContent=event.message;request.reply.element.append(meta);notify(event.message);if(!request.text){const retry=document.createElement('button');retry.className='text-button';retry.textContent='다시 보내기';retry.addEventListener('click',()=>send(request.prompt,{files:request.files,search:request.search}));request.reply.element.append(retry);}}
  setBusy(false);scrollBottom();
}
async function send(text,options={}){if(pending||preparing)return;if(attachments.isLoading()){notify('첨부 파일을 읽고 있어요. 잠시 기다려 주세요.');return;}const files=options.files||attachments.snapshot(),search=options.search??attachments.search();text=text.trim()||(files.length?'첨부한 파일의 핵심 내용을 분석하고 요약해 주세요.':'');if(!text)return;if(!(settings.hasSelectedKey??settings.hasKey)&&bridge){notify('AI API 키를 연결하면 대화할 수 있어요.');openSettings();return;}if(text.length>12000){notify('한 번에 12,000자까지 보낼 수 있어요.');return;}notify('');preparing=true;setBusy(true);try{await speaker.stop();if(listening)await bridge?.voiceStop();}catch{preparing=false;setBusy(false);notify('대화 준비를 마치지 못했어요. 다시 보내 주세요.');return;}const id=crypto.randomUUID();const user=addMessage('user',text);showAttachedFiles(user.element,files,search);const reply=addMessage('assistant','');reply.bubble.classList.add('waiting');pending={id,prompt:text,reply,text:'',files,search,sources:[]};preparing=false;attachments.consume(files.map(file=>file.id));$('#message').value='';resizeInput();
  if(!bridge){const answer='여기는 화면 미리보기예요. 실제 앱에서 AI API 키를 연결하면 제가 답해 드릴게요. 우선 잠깐, 어깨 한 번 쭉 펴 볼까요?';let index=0;previewTimer=setInterval(()=>{if(!pending){clearInterval(previewTimer);return;}pending.text+=answer[index++];reply.bubble.classList.remove('waiting');reply.bubble.textContent=pending.text;scrollBottom();if(index>=answer.length){clearInterval(previewTimer);finish({type:'done',id,text:answer});}},24);return;}
  try{const result=await bridge.send(id,{text,search,attachmentIds:files.map(file=>file.id)});if(result?.error&&pending?.id===id)finish({type:'error',id,message:result.error,text:pending.text});}catch{finish({type:'error',id,message:'연결을 마치지 못했어요. 다시 시도해 주세요.',text:pending?.text||''});}
}
function resizeInput(){$('#message').style.height='auto';$('#message').style.height=`${Math.min(85,$('#message').scrollHeight)}px`;}
$('#composer').addEventListener('submit',event=>{event.preventDefault();if(pending){if(bridge)bridge.cancel();else{clearInterval(previewTimer);finish({type:'error',id:pending.id,message:'답변을 중지했어요.',text:pending.text});}}else send($('#message').value);});
$('#message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!pending)send($('#message').value);}});
$('#message').addEventListener('input',resizeInput);
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>send(button.dataset.prompt)));
$('#close-chat').addEventListener('click',()=>{if(bridge)bridge.closeChat();else location.href='pet.html';});
$('#new-chat').addEventListener('click',newConversation);
$('#toggle-speech').addEventListener('click',async()=>{const next={speak:!settings.speak};const result=bridge?await bridge.saveSettings(next):{...settings,...next};if(result?.error)notify(result.error);else syncSettings(result);});
function openSettings(){characterSettings.open();if(historyUI.isOpen())historyUI.close();aiSettings.open();$('#settings-panel').hidden=false;$('#settings-feedback').textContent='';voiceSettings.clearSensitive();$('#setting-roam').checked=settings.roam;$('#setting-top').checked=settings.alwaysOnTop;$('#setting-speak').checked=settings.speak;syncStartup();voiceSettings.open();bridge?.settings().then(next=>{if(!next.error)syncSettings(next);});$('#setting-scale').value=settings.scale;$('#setting-speed').value=settings.speed;$('#nickname').value=settings.nickname;$('#system-prompt').value=settings.systemPrompt;updateRanges();$('#settings-form').scrollTop=0;$('#back-chat').focus();}
$('#setting-start').addEventListener('change',async()=>{const control=$('#setting-start'),enabled=control.checked;control.disabled=true;try{const result=bridge?await bridge.saveSettings({startAtLogin:enabled}):{...settings,startAtLogin:enabled};if(result?.error)throw new Error(result.error);syncSettings(result);}catch(error){syncStartup();$('#startup-status').textContent=error.message;}finally{control.disabled=!!bridge&&!settings.startAtLoginSupported;}});
function updateRanges(){$('#scale-value').textContent=`${Math.round(Number($('#setting-scale').value)*100)}%`;const speed=Number($('#setting-speed').value);$('#speed-value').textContent=speed<18?'아주 느긋하게':speed<35?'느긋하게':'가벼운 발걸음';}
$('#setting-scale').addEventListener('input',updateRanges);$('#setting-speed').addEventListener('input',updateRanges);
$('#open-settings').addEventListener('click',openSettings);$('#connect-key').addEventListener('click',openSettings);
$('#back-chat').addEventListener('click',()=>{aiSettings.clearSensitive();voiceSettings.clearSensitive();$('#settings-panel').hidden=true;characterSettings.close();$('#message').focus();});
$('#speech-settings').addEventListener('click',()=>bridge?.openLink('speech'));
$('#settings-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#settings-form .save-button');button.disabled=true;
  try{
    const input={...characterSettings.input(),...voiceSettings.input(),elevenLabsApiKey:$('#eleven-key').value,...aiSettings.input(),roam:$('#setting-roam').checked,alwaysOnTop:$('#setting-top').checked,speak:$('#setting-speak').checked,scale:Number($('#setting-scale').value),speed:Number($('#setting-speed').value),nickname:$('#nickname').value,systemPrompt:$('#system-prompt').value};
    const result=bridge?await bridge.saveSettings(input):{...settings,...input,hasKey:!input.clearKey&&(!!input.apiKey||settings.hasKey)};
    if(result?.error)throw new Error(result.error);syncSettings(result);aiSettings.clearSensitive();voiceSettings.clearSensitive();aiSettings.open();characterSettings.open();
    $('#settings-feedback').className='settings-feedback';$('#settings-feedback').textContent='설정을 저장했어요. 대화를 이어가 보세요.';
  }catch(error){$('#settings-feedback').className='settings-feedback error';$('#settings-feedback').textContent=error.message;}finally{button.disabled=false;}
});

function voiceState(event){if(event.type==='listening'){listening=true;$('#microphone').setAttribute('aria-pressed','true');$('#mic-label').textContent='듣는 중 · 눌러서 중지';status('이야기를 듣고 있어요');notify('말씀한 내용이 입력창에 적혀요. 확인한 뒤 보내 주세요.');}if(event.type==='transcript'){$('#message').value=[$('#message').value,event.text].filter(Boolean).join(' ');resizeInput();$('#message').focus();notify('입력한 내용을 확인하고 보내 주세요.');}if(event.type==='stopped'||event.type==='error'||event.type==='transcript'){listening=false;$('#microphone').setAttribute('aria-pressed','false');$('#mic-label').textContent='말로 입력';if(!pending)status('곁에 있어요');}if(event.type==='error'){notify(({KOREAN_RECOGNIZER_MISSING:'이 PC에는 한국어 음성 인식기가 없어요. 입력창을 클릭하고 Win+H를 눌러 Windows 음성 입력을 사용해 주세요. 설정에서 자세히 볼 수 있어요.',KOREAN_VOICE_MISSING:'Windows 한국어 TTS 음성이 설치되지 않았어요. Windows 음성 설정에서 한국어 음성을 추가해 주세요.',NO_SPEECH:'목소리를 듣지 못했어요. 마이크를 확인하고 다시 눌러 주세요.',MICROPHONE_ERROR:'마이크를 사용할 수 없어요. Windows 마이크 권한과 기본 입력 장치를 확인해 주세요.'})[event.message]||event.message);}}
$('#microphone').addEventListener('click',async()=>{if(!bridge){notify('음성 입력은 Windows 앱에서 사용할 수 있어요.');return;}if(listening){await bridge.voiceStop();return;}listening=true;$('#microphone').setAttribute('aria-pressed','true');$('#mic-label').textContent='마이크 준비 중…';const result=await bridge.voiceStart();if(result?.error)voiceState({type:'error',message:result.error});});
bridge?.onVoice(event=>{
  if(event.type==='speech-state'){
    $('#stop-speech').hidden=event.state==='idle';
    $('#stop-speech').textContent=event.state==='generating'?'음성 준비 중 · 그만 읽기':'읽는 중 · 그만 읽기';
  }
  if(event.type==='silence')$('#stop-speech').hidden=true;
  voiceState(event);
  if(event.type==='error'&&event.message==='KOREAN_RECOGNIZER_MISSING'&&!document.hidden){
    $('#message').focus();
    notify('Windows 음성 입력으로 연결할게요. 말씀한 내용을 확인한 뒤 보내 주세요. 음성 입력 창이 열리지 않으면 Win+H를 눌러 주세요.');
    bridge.dictate().then(result=>{if(result?.error)notify(result.error);});
  }
});
$('#stop-speech').addEventListener('click',()=>{speaker.stop();$('#stop-speech').hidden=true;});
bridge?.onSettings(syncSettings);
bridge?.onPortrait(data=>characterSettings.portrait(data));
window.__characterSettingsState=()=>characterSettings.inspect();
bridge?.onView(view=>{chatOpen=view!=='hidden';if(!chatOpen){characterSettings.close();return;}if(historyUI.isOpen())historyUI.close();if(view==='settings')openSettings();else{$('#settings-panel').hidden=true;characterSettings.close();$('#message').focus();}});
bridge?.onChat(event=>{if(event.type==='character-error'){notify(event.message);return;}if(event.type==='history-changed'){historyUI.changed(event.activeId);return;}if(event.type==='reset'){attachments.clear();$('#messages').replaceChildren();$('#welcome').hidden=false;notify('');speaker.stop();status('곁에 있어요');return;}if(event.type==='settings-error'){$('#startup-status').textContent=event.message;return;}if(event.id!==pending?.id)return;if(event.type==='delta'){pending.text+=event.text;pending.reply.bubble.classList.remove('waiting');pending.reply.bubble.textContent=pending.text;status('이야기하는 중이에요');scrollBottom();}else if(event.type==='sources')pending.sources=event.sources;else if(event.type==='progress'){status(event.message);if(!pending.text)pending.reply.bubble.textContent=event.message;}else if(event.type==='notice')notify(event.text);else finish(event);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){bridge?.voiceStop();speaker.stop();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(historyUI.isOpen()){historyUI.close();return;}if(!$('#settings-panel').hidden){aiSettings.clearSensitive();voiceSettings.clearSensitive();$('#settings-panel').hidden=true;characterSettings.close();}else bridge?.closeChat();}});
if(bridge){bridge.settings().then(result=>{if(result?.error)notify(result.error);else syncSettings(result);});}else{syncSettings({...settings,hasKey:true,speak:false});status('화면 미리보기');}
window.__smokeTest=(keepOpen=false)=>{openSettings();const startup=$('#setting-start');const valid=$('#model').value===settings.model&&$('#settings-panel').hidden===false&&$('#character-name').getBoundingClientRect().top<200&&startup.disabled===!settings.startAtLoginSupported&&$('#voice-model').value==='eleven_v4'&&!!$('#voice-choice');if(!keepOpen){$('#settings-panel').hidden=true;characterSettings.close();}return valid&&typeof window.require==='undefined'&&typeof window.process==='undefined';};
window.__speechTestState=()=>speaker.inspect();
initializeUpdates(bridge, notify);
