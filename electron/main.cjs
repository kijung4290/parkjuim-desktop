const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, safeStorage, shell, protocol, net, session, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { DEFAULTS, SYSTEM_PROMPT, characterSystemPrompt, clampPosition, chatBounds, validateMessages, sanitizeSettings } = require('./core.cjs');
const { createStore } = require('./store.cjs');
const { createUpdateController, getUpdateMode } = require('./updater.cjs');
const { createWalker } = require('./movement.cjs');
const { isPetRegion } = require('./interaction.cjs');
const { createStartupController } = require('./startup.cjs');
const { createElevenLabs, SAMPLE_TEXT } = require('./elevenlabs.cjs');
const { randomUUID } = require('node:crypto');
const { chatError } = require('./chat-errors.cjs');
const { createAttachmentStore,EXTENSIONS } = require('./attachments.cjs');
const { validateTurn,ConversationError,webUrl } = require('./conversation.cjs');
const {createClient,listModels,createAIConversation,parseGrounding}=require('./ai-chat.cjs');
const {providerInfo,selectedAI,validKey}=require('./providers.cjs');
const {createHistoryStore}=require('./history.cjs');
const {createModelStore}=require('./models.cjs');
let modelStore,modelStoreError='';
const attachmentStore=createAttachmentStore();
const conversation=createAIConversation({attachments:attachmentStore});
let selectingFiles=false;
let historyStore,historyError='',activeConversationId=null,managingHistory=false;
let restoredWithoutFiles=false,portraitDataUrl='';
const historyLinks=new Map();
const historyGroundings=new Map();
let chooseFiles=(...args)=>dialog.showOpenDialog(...args);
let makeChatClient=createClient;
const voiceSmoke = process.argv.includes('--voice-smoke-test');
const modelImportPreview=process.argv.includes('--model-import-preview');
const smoke = process.argv.includes('--smoke-test') || voiceSmoke || modelImportPreview;
// Local onboarding credentials are development-only and never bundled.
if (!app.isPackaged && !smoke) require('dotenv').config({ path:path.join(__dirname,'../.env.local'), quiet:true });
const smokeRoot = app.isPackaged ? path.join(path.dirname(app.getPath('exe')), '.preview') : path.join(__dirname, '../.preview');
if (smoke) app.setPath('userData', path.join(smokeRoot, modelImportPreview?'model-import-data':'smoke-data'));
protocol.registerSchemesAsPrivileged([{ scheme: 'park', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setAppUserModelId('kr.parkjuim.desktop');
let pet, chat, tray, store, activeRequest, voiceProcess, speechProcess, settings, dragging, wanderTimer;
let hovered = false, lastTick = Date.now(), moving = false, direction = 1, pressed = false, pressAnchor = null;
let inputEnabled = null, lastCursor = null;
let pointerOverride = smoke ? {x:-999999,y:-999999} : null;
const walker = createWalker();
let motion = {walkDistance:0,walkSpeed:0,offsetX:0,offsetY:0};
let isQuitting = false;
let updates, startup, elevenLabs, cloudSpeech;
const environmentKey = () => smoke ? '' : process.env.ELEVENLABS_API_KEY || '';
const currentSettings = () => ({ ...store.get(), ...startup.get(),historyAvailable:!!historyStore,activeConversationId,portraitDataUrl, hasElevenLabsKey:!!(store.elevenLabsKey() || environmentKey()), elevenLabsKeySource:store.elevenLabsKey() ? 'saved' : environmentKey() ? 'environment' : '' });
const petSize = () => ({ width: Math.round(194 * settings.scale), height: Math.round(250 * settings.scale) });
function emit(win, channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function broadcast(channel, data) { emit(pet, channel, data); emit(chat, channel, data); }
function historyChanged(){emit(chat,'chat:event',{type:'history-changed',activeId:activeConversationId});}
function resetConversation(){conversation.reset();activeConversationId=null;restoredWithoutFiles=false;historyLinks.clear();historyGroundings.clear();historyChanged();}
function requireHistory(){if(!historyStore)throw new Error(historyError||'대화 기록 저장소를 사용할 수 없어요.');return historyStore;}
async function historyTask(action){
  if(activeRequest||selectingFiles||managingHistory)throw new Error('현재 답변과 파일 읽기가 끝난 뒤 대화 목록을 변경해 주세요.');
  managingHistory=true;try{return await action();}finally{managingHistory=false;}
}
function publicHistory(record){
  historyLinks.clear();historyGroundings.clear();
  return {...record,turns:record.turns.map(turn=>({...turn,suggestions:turn.suggestions.map(html=>{const document=parseGrounding(html);if(!document)return null;const id=randomUUID();historyGroundings.set(id,document);return id;}).filter(Boolean),sources:turn.sources.map(source=>{const {url,...metadata}=source,id=randomUUID();if(url)historyLinks.set(id,url);return {...metadata,id};})}))};
}
function suggestionLink(url){const safe=webUrl(url);return conversation.suggestionLink(url)||!!safe&&[...historyGroundings.values()].some(item=>item.urls.has(safe));}
function petState(extra = {}) { emit(pet, 'pet:state', { ...motion, moving, direction, hovered, scale:settings?.scale || 1, chatting: !!chat?.isVisible(), ...extra }); }
const readPointer = () => pointerOverride || screen.getCursorScreenPoint();
function setPetInteractive(value) {
  if (inputEnabled === value || !pet || pet.isDestroyed()) return;
  inputEnabled = value;
  pet.setIgnoreMouseEvents(!value, {forward:true});
}
function updatePetPointer() {
  if (!pet || pet.isDestroyed()) return;
  const point=readPointer(), bounds=pet.getBounds(), over=isPetRegion(point,bounds,settings.characterType);
  setPetInteractive(pressed || !!dragging || over);
  if (hovered !== over) {
    hovered=over;
    if (over) { walker.pause(Date.now()); moving=false; }
    petState();
  }
  if (over && (!lastCursor || point.x!==lastCursor.x || point.y!==lastCursor.y)) {
    emit(pet,'pet:state',{cursor:{x:(point.x-bounds.x)/bounds.width*2-1,y:(point.y-bounds.y)/bounds.height*2-1}});
  }
  lastCursor=point;
}
function releasePetPress() {
  pressed=false;dragging=null;pressAnchor=null;
  if(pet&&!pet.isDestroyed())walker.reset(pet.getBounds(),Date.now(),1800);
  updatePetPointer();
}
function trusted(event, kind) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const expected = kind === 'pet' ? pet : kind === 'chat' ? chat : null;
  if ((!expected && win !== pet && win !== chat) || (expected && win !== expected) || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith('park://app/')) {
    if(smoke)console.error('IPC TRUST DIAGNOSTIC',JSON.stringify({kind,win:win?.id,expected:expected?.id,pet:pet?.id,chat:chat?.id,sender:event.sender.id,sameFrame:event.senderFrame===event.sender.mainFrame,frame:event.senderFrame?.routingId,main:event.sender.mainFrame?.routingId,url:event.senderFrame?.url}));
    throw new Error('허용되지 않은 요청입니다.');
  }
}
function handle(channel, kind, fn) { ipcMain.handle(channel, async (event, ...args) => { trusted(event, kind); try { return await fn(...args); } catch (error) { return { error: error.message || '요청을 처리하지 못했어요.' }; } }); }
function on(channel, kind, fn) { ipcMain.on(channel, (event, ...args) => { try { trusted(event, kind); fn(...args); } catch {} }); }
function secureWindow(options) {
  const win = new BrowserWindow({ show: false, frame: false, resizable: false, maximizable: false, fullscreenable: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false }, ...options });
  win.webContents.setWindowOpenHandler(details => {if(suggestionLink(details.url))shell.openExternal(details.url);return {action:'deny'};});
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('will-frame-navigate', e => {if(!e.isMainFrame&&!e.url.startsWith('park://app/grounding/'))e.preventDefault();});
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  if(smoke)win.webContents.on('console-message',details=>{if(details.level==='error')console.error('RENDERER SMOKE:',details.message);});
  return win;
}
function placeChat() { if (chat && !chat.isDestroyed()) chat.setBounds(chatBounds(pet.getBounds(), screen.getDisplayMatching(pet.getBounds()).workArea)); }
function showChat(view = 'chat') {
  walker.pause(Date.now()); moving = false; placeChat(); chat.show(); chat.focus();
  emit(chat, 'view:open', view); petState();
}
function hideChat() { if(selectingFiles)return;voiceStop(); silence(); chat.hide(); walker.pause(Date.now(),2500); petState(); }
function contextMenu() {
  settings = currentSettings();
  Menu.buildFromTemplate([
    { label: `${settings.characterName}와 대화하기`, click: () => showChat() },
    { label: '산책하기', type: 'checkbox', checked: settings.roam, click: item => updateSettings({ roam: item.checked }) },
    { label: '항상 위에 표시', type: 'checkbox', checked: settings.alwaysOnTop, click: item => updateSettings({ alwaysOnTop: item.checked }) },
    { label: 'Windows 시작 시 자동 실행', type: 'checkbox', checked: settings.startAtLogin, enabled: settings.startAtLoginSupported, click: item => updateSettings({ startAtLogin: item.checked }).catch(error => { showChat('settings'); emit(chat, 'chat:event', { type: 'settings-error', message: error.message }); }) },
    { type: 'separator' }, { label: '설정', click: () => showChat('settings') },
    { label: '화면 오른쪽으로 돌아오기', click: resetPosition },
    { type: 'separator' },
    { label: updates?.get().status === 'downloaded' ? '업데이트 준비됨 · 설정에서 설치' : '업데이트 확인', click: () => { showChat('settings'); updates?.check(); } },
    { type: 'separator' }, { label: '종료', click: () => app.quit() }
  ]).popup();
}
function resetPosition() {
  const a = screen.getPrimaryDisplay().workArea, size = petSize();
  pet.setBounds({ ...size, x: a.x + a.width - size.width - 28, y: a.y + a.height - size.height - 16 });
  walker.reset(pet.getBounds(),Date.now(),3000);moving=false;
  motion={...motion,walkSpeed:0,offsetX:0,offsetY:0};petState();updatePetPointer();
  placeChat();
}
async function updateSettings(input) {
  const nextSettings=sanitizeSettings(input,settings),previous=selectedAI(settings),next=selectedAI(nextSettings);
  if(nextSettings.characterType==='custom'&&!modelStore?.has(nextSettings.customModelId))throw new Error('설정에서 사용할 GLB 캐릭터를 먼저 추가해 주세요.');
  if(nextSettings.characterName!==settings.characterName&&activeRequest)throw new Error('답변을 마친 뒤 캐릭터 이름을 변경해 주세요.');
  const changed=previous.id!==next.id||previous.model!==next.model;
  if(changed&&(activeRequest||selectingFiles))throw new Error('답변과 파일 읽기가 끝난 뒤 AI 서비스·모델을 변경해 주세요.');
  await store.save(input);
  if(changed){resetConversation();silence();emit(chat,'chat:event',{type:'reset'});}
  try {
    if (typeof input.startAtLogin === 'boolean' && (input.startAtLogin !== startup.get().startAtLogin || startup.get().startAtLoginBlocked)) startup.set(input.startAtLogin);
  } catch (error) {
    await store.save({ startAtLogin: startup.get().startAtLogin });
    settings = currentSettings(); broadcast('settings:changed', settings);
    throw error;
  }
  settings = currentSettings();
  pet.setAlwaysOnTop(settings.alwaysOnTop, 'floating'); chat.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  pet.setSize(petSize().width, petSize().height);
  const bounds = pet.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
  pet.setPosition(...Object.values(clampPosition(bounds, area, bounds))); placeChat();
  walker.reset(pet.getBounds(),Date.now(),2500);updatePetPointer();
  if (!settings.speak || ['speechProvider','elevenLabsVoiceId','elevenLabsModel','voiceStability','elevenLabsApiKey','clearElevenLabsKey'].some(field => Object.hasOwn(input,field))) silence();
  applyCharacterName();broadcast('settings:changed', settings);petState();return settings;
}
function applyCharacterName(){pet?.setTitle(`${settings.characterName} 미니미`);chat?.setTitle(`${settings.characterName}와 대화`);tray?.setToolTip(`${settings.characterName} 미니미 · 클릭해서 대화하기`);}
function wander() {
  const now = Date.now(), dt = Math.max(0,Math.min((now - lastTick) / 1000, 0.05)); lastTick = now;
  if (!pet || pet.isDestroyed()) return;
  updatePetPointer();
  if (dragging) {
    const cursor = readPointer(), size = pet.getBounds();
    const a = screen.getDisplayNearestPoint(cursor).workArea;
    const p = clampPosition({ x: cursor.x - dragging.x, y: cursor.y - dragging.y }, a, size);
    pet.setPosition(p.x, p.y);walker.reset(p,now,2500);return;
  }
  const b = pet.getBounds(), a = screen.getDisplayMatching(b).workArea;
  const wasMoving=moving;
  const next=walker.step({bounds:b,area:a,dt,now,speed:settings.speed,scale:settings.scale,paused:!settings.roam||hovered||pressed||chat.isVisible()});
  const x=Math.round(next.x),y=Math.round(next.y);
  if(x!==b.x||y!==b.y)pet.setPosition(x,y);
  moving=next.moving;direction=next.direction;
  motion={walkDistance:next.distance,walkSpeed:next.speed,offsetX:next.x-x,offsetY:next.y-y};
  if(moving||wasMoving!==moving)petState();
}
function voiceStop() { if (voiceProcess) { voiceProcess.kill(); voiceProcess = null; } emit(chat, 'voice:event', { type: 'stopped' }); }
function silence(notify = true) {
  if (speechProcess) { speechProcess.kill(); speechProcess = null; }
  if (cloudSpeech) { cloudSpeech.controller.abort(); clearTimeout(cloudSpeech.timer); cloudSpeech = null; }
  if (notify) emit(chat,'voice:event',{type:'silence'});
  emit(chat,'voice:event',{type:'speech-state',state:'idle'});
  petState({ speaking: false });
}
async function speak(text, previewSettings) {
  silence(false);
  if (!chat.isVisible() || (!previewSettings && !settings.speak)) return {cancelled:true};
  if (typeof text !== 'string' || !text.trim()) return {cancelled:true};
  if (previewSettings || settings.speechProvider === 'elevenlabs') {
    const request = { id:randomUUID(), controller:new AbortController(), timer:null };
    cloudSpeech = request;
    request.timer=setTimeout(()=>{if(cloudSpeech===request){silence();emit(chat,'voice:event',{type:'error',message:'음성 생성 시간이 길어졌어요. 다시 듣기를 눌러 주세요.'});}},90000);
    emit(chat,'voice:event',{type:'speech-state',state:'generating'});
    try {
      const audio = await elevenLabs.synthesize(text, previewSettings || settings, request.controller.signal);
      if (cloudSpeech !== request || request.controller.signal.aborted || !chat.isVisible()) return {cancelled:true};
      // Release busy state if the renderer never acknowledges playback.
      clearTimeout(request.timer);
      request.timer = setTimeout(() => { if (cloudSpeech === request) silence(); }, 20000);
      return { id:request.id, audio:new Uint8Array(audio), mime:'audio/mpeg' };
    } catch (error) {
      if (cloudSpeech !== request || request.controller.signal.aborted) return {cancelled:true};
      silence(); throw error;
    }
  }
  speechProcess = speechTask('speak', text.slice(0, 8000)); const proc = speechProcess;
  petState({ speaking: true }); emit(chat,'voice:event',{type:'speech-state',state:'playing'});
  proc.on('error', () => { if(speechProcess===proc)silence(); emit(chat, 'voice:event', { type: 'error', message: '답변 읽기를 시작하지 못했어요.' }); });
  proc.stdout.setEncoding('utf8'); proc.stdout.on('data', chunk => { try { const event = JSON.parse(chunk.trim()); if (event.type === 'error') emit(chat, 'voice:event', event); } catch {} });
  proc.on('close', () => { if (speechProcess === proc) { speechProcess = null; petState({ speaking: false }); emit(chat,'voice:event',{type:'silence'}); } });
  return {native:true};
}
function speechTask(mode, text) {
  if (process.platform !== 'win32') throw new Error('이 버전의 음성 기능은 Windows에서 사용할 수 있어요.');
  if (!['listen','speak','dictate','probe'].includes(mode)) throw new Error('잘못된 음성 요청입니다.');
  // PowerShell cannot address files inside app.asar. Read the bundled helper
  // through Electron's filesystem, then pass static code as UTF-16LE. User text
  // stays on stdin and is never inserted into the command.
  const script = fs.readFileSync(path.join(__dirname, 'speech.ps1'), 'utf8');
  const encoded = Buffer.from(`& {\n${script}\n} -Mode ${mode}`, 'utf16le').toString('base64');
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  if (text) proc.stdin.end(text); else proc.stdin.end();
  return proc;
}
function registerIpc() {
  handle('update:get', null, () => updates.get());
  handle('update:check', 'chat', () => updates.check());
  handle('update:install', 'chat', () => updates.install());
  handle('settings:get', null, () => (settings = currentSettings()));
  on('pet:portrait','pet',data=>{
    if(typeof data!=='string'||data.length>350000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data))return;
    const bytes=Buffer.from(data.slice('data:image/png;base64,'.length),'base64');
    if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)!==160||bytes.readUInt32BE(20)!==160)return;
    portraitDataUrl=data;emit(chat,'pet:portrait',data);
  });
  on('pet:model-error','pet',()=>emit(chat,'chat:event',{type:'character-error',message:'추가한 3D 캐릭터를 불러오지 못했어요. 설정에서 파일을 다시 선택해 주세요.'}));
  handle('models:list','chat',()=>{if(!modelStore)throw new Error(modelStoreError||'캐릭터 보관함을 사용할 수 없어요.');return {items:modelStore.list()};});
  handle('models:add','chat',async()=>{
    if(activeRequest||selectingFiles||managingHistory)throw new Error('현재 작업을 마친 뒤 캐릭터를 추가해 주세요.');
    if(!modelStore)throw new Error(modelStoreError||'캐릭터 보관함을 사용할 수 없어요.');selectingFiles=true;
    // Windows native dialogs can lose foreground ownership behind floating pet
    // windows. Lower both topmost windows for the modal dialog and restore them.
    pet.setAlwaysOnTop(false);chat.setAlwaysOnTop(false);chat.show();chat.focus();
    try{const selected=await chooseFiles(chat,{title:'내 3D 캐릭터 추가',buttonLabel:'캐릭터 추가',defaultPath:app.getPath('downloads'),properties:['openFile','dontAddToRecent'],filters:[{name:'3D GLB 모델',extensions:['glb']},{name:'모든 파일',extensions:['*']}]});if(selected.canceled)return {canceled:true};return {model:await modelStore.add(selected.filePaths[0])};}finally{selectingFiles=false;pet.setAlwaysOnTop(settings.alwaysOnTop,'floating');chat.setAlwaysOnTop(settings.alwaysOnTop,'floating');chat.show();chat.focus();}
  });
  handle('models:import','chat',async input=>{
    if(activeRequest||selectingFiles||managingHistory)throw new Error('현재 작업을 마친 뒤 캐릭터를 추가해 주세요.');
    if(!modelStore)throw new Error(modelStoreError||'캐릭터 보관함을 사용할 수 없어요.');
    selectingFiles=true;try{return {model:await modelStore.addBytes(input)};}finally{selectingFiles=false;}
  });
  handle('models:delete','chat',id=>historyTask(async()=>{
    if(!modelStore)throw new Error(modelStoreError||'캐릭터 보관함을 사용할 수 없어요.');
    if(settings.customModelId===id)await updateSettings({characterType:'human',customModelId:''});
    return modelStore.remove(id);
  }));
  handle('settings:save', 'chat', input => {if(managingHistory)throw new Error('대화를 불러온 뒤 설정을 변경해 주세요.');return updateSettings(input);});
  handle('history:list','chat',()=>({items:requireHistory().list(),activeId:activeConversationId}));
  handle('history:open','chat',id=>historyTask(async()=>{
    const record=requireHistory().get(id),info=providerInfo(record.provider);
    await updateSettings({aiProvider:record.provider,[info.modelField]:record.model});
    conversation.restore(record);activeConversationId=record.id;restoredWithoutFiles=record.turns.some(turn=>turn.files.length);silence();historyChanged();
    return {record:publicHistory(record),settings:currentSettings()};
  }));
  handle('history:rename','chat',(id,title)=>historyTask(async()=>{const result=await requireHistory().rename(id,title);historyChanged();return result;}));
  handle('history:delete','chat',id=>historyTask(async()=>{const result=await requireHistory().remove(id);if(activeConversationId===id){resetConversation();silence();emit(chat,'chat:event',{type:'reset'});}historyChanged();return result;}));
  handle('ai:models','chat',async input=>{
    if(!input||typeof input!=='object')throw new Error('AI 서비스를 선택해 주세요.');
    const info=providerInfo(input.provider);
    const key=input.apiKey?validKey(info.id,input.apiKey):store.keyFor(info.id);
    if(!key)throw new Error(`${info.label} API 키를 입력하거나 저장해 주세요.`);
    try{return {provider:info.id,models:await listModels(info.id,key)};}catch(error){throw new Error(chatError(error,{provider:info.id}));}
  });
  handle('pet:chat', 'pet', () => chat.isVisible() ? hideChat() : showChat());
  handle('chat:hide', 'chat', hideChat);
  handle('pet:menu', 'pet', contextMenu);
  on('pet:pointer','pet',updatePetPointer);
  on('pet:drag', 'pet', phase => {
    if(phase==='press'){const p=readPointer(),b=pet.getBounds();pressed=true;pressAnchor={x:p.x-b.x,y:p.y-b.y};walker.pause(Date.now());moving=false;setPetInteractive(true);petState();}
    else if (phase === 'start') { const p=readPointer(),b=pet.getBounds();dragging=pressAnchor||{x:p.x-b.x,y:p.y-b.y};pressed=true;moving=false;walker.pause(Date.now());setPetInteractive(true);petState(); }
    else if(phase==='end'){releasePetPress();if(chat.isVisible())placeChat();}
  });
  handle('chat:cancel', 'chat', () => activeRequest?.controller.abort());
  handle('chat:reset','chat',()=>{if(selectingFiles||managingHistory)throw new Error('파일이나 대화를 읽고 있어요. 잠시 기다려 주세요.');resetConversation();return {ok:true};});
  handle('attachments:choose','chat',async remaining=>{
    if(activeRequest||selectingFiles||managingHistory)throw new Error('현재 작업을 마친 뒤 파일을 첨부해 주세요.');
    if(!Number.isInteger(remaining)||remaining<1||remaining>4)throw new Error('한 번에 파일 4개까지 첨부할 수 있어요.');
    selectingFiles=true;
    try{
      const chosen=await chooseFiles(chat,{title:`${settings.characterName}에게 보여 줄 파일`,properties:['openFile','multiSelections'],filters:[{name:'PDF · 이미지 · 텍스트 · Word · Excel',extensions:EXTENSIONS}]});
      if(chosen.canceled)return {files:[],errors:[]};
      if(chosen.filePaths.length>remaining)throw new Error(`추가로 ${remaining}개까지 첨부할 수 있어요.`);
      return await attachmentStore.addPaths(chosen.filePaths);
    }finally{selectingFiles=false;}
  });
  handle('attachments:remove','chat',id=>{if(activeRequest)throw new Error('전송 중에는 첨부를 해제할 수 없어요.');attachmentStore.remove(id);return {ok:true};});
  handle('chat:source','chat',id=>{const url=conversation.source(id)||historyLinks.get(id);if(!url)throw new Error('출처 링크를 찾지 못했어요. 다시 검색해 주세요.');return shell.openExternal(url);});
  handle('chat:send', 'chat', async (id, input) => {
    if (activeRequest) throw new Error('답변을 마치거나 중지한 뒤 다시 보내 주세요.');
    if (selectingFiles) throw new Error('첨부 파일을 읽고 있어요. 잠시 기다려 주세요.');
    if (managingHistory) throw new Error('대화 목록 작업이 끝난 뒤 보내 주세요.');
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new Error('잘못된 요청입니다.');
    const turn=validateTurn(input),ai=selectedAI(settings),apiKey=store.keyFor(ai.id);
    if (!apiKey) throw new Error(`설정에서 ${ai.label} API 키를 먼저 입력해 주세요.`);
    const sentFiles=attachmentStore.metadata(turn.attachmentIds);
    const controller = new AbortController(); activeRequest = { controller, id };
    let timedOut = false;
    const watchdog = require('./reply.cjs').createReplyWatchdog(() => { timedOut = true; controller.abort(); });
    let text = '';
    petState({ thinking: true });
    try {
      const client = makeChatClient(apiKey,ai.id);
      const result=await conversation.send(turn,{client,provider:ai.id,model:ai.model,system:characterSystemPrompt(settings) + (restoredWithoutFiles ? '\n이 대화는 저장된 텍스트로 복원됐습니다. 과거 첨부 파일의 원문은 없으므로 다시 첨부한 자료만 직접 분석하세요. 원문이 필요한 질문에는 재첨부를 안내하고 추측하지 마세요.' : '') + (settings.nickname ? `\n사용자 호칭: ${settings.nickname}` : '') + (settings.systemPrompt ? `\n추가 요청: ${settings.systemPrompt}` : ''),signal:controller.signal,emit:event=>{watchdog.touch();if(event.type==='delta')text+=event.text;emit(chat,'chat:event',{...event,id});}});
      try{
        const sources=result.sources.map(source=>({...source,url:conversation.source(source.id)}));
        const suggestions=(result.suggestions||[]).map(id=>conversation.grounding(id)).filter(Boolean);
        activeConversationId=await requireHistory().append(activeConversationId,{provider:ai.id,model:ai.model},{user:turn.text,assistant:result.text,files:sentFiles,sources,suggestions,search:turn.search});historyChanged();
      }catch(error){emit(chat,'chat:event',{type:'notice',id,text:`답변은 받았지만 대화 기록을 저장하지 못했어요. ${error.message}`});}
      emit(chat, 'chat:event', { type: 'done', id, ...result });
      return { ok: true };
    } catch (error) {
      const message = error instanceof ConversationError ? error.message : chatError(error, { cancelled:controller.signal.aborted, timedOut,provider:ai.id });
      emit(chat, 'chat:event', { type: 'error', id, text, message }); return { error: message };
    } finally { watchdog.close(); activeRequest = null; petState({ thinking: false }); }
  });
  handle('voice:start', 'chat', () => {
    voiceStop(); silence();
    voiceProcess = speechTask('listen'); const proc = voiceProcess; let output = '';
    proc.stdout.setEncoding('utf8'); proc.stdout.on('data', chunk => {
      output += chunk;
      const lines = output.split(/\r?\n/); output = lines.pop();
      for (const line of lines) { try { emit(chat, 'voice:event', JSON.parse(line)); } catch {} }
    });
    proc.on('error', () => emit(chat, 'voice:event', { type: 'error', message: 'Windows 음성 기능을 시작하지 못했어요. 입력창에서 Win+H를 사용해 보세요.' }));
    proc.on('close', () => { if (voiceProcess === proc) { voiceProcess = null; emit(chat, 'voice:event', { type: 'stopped' }); } });
    return { ok: true };
  });
  handle('voice:stop', 'chat', voiceStop);
  handle('voice:dictate', 'chat', () => {
    chat.focus(); const proc = speechTask('dictate');
    proc.on('error', () => emit(chat, 'voice:event', {type:'error',message:'Windows 음성 입력을 열지 못했어요. 입력창에서 Win+H를 눌러 주세요.'}));
    return {ok:true};
  });
  handle('voice:silence', 'chat', () => silence(false));
  handle('voice:speak', 'chat', text => speak(text));
  handle('voice:voices', 'chat', input => elevenLabs.voices(input));
  handle('voice:preview', 'chat', input => speak(SAMPLE_TEXT.replace('박주임',settings.characterName), input || {}));
  on('voice:playback','chat',(id,state) => {
    if (id !== cloudSpeech?.id || !['playing','ended','error'].includes(state)) return;
    if (state === 'playing') {
      const request=cloudSpeech; clearTimeout(request.timer);
      request.timer=setTimeout(()=>{if(cloudSpeech===request)silence();},15*60*1000);
      petState({speaking:true}); emit(chat,'voice:event',{type:'speech-state',state:'playing'});
    } else silence();
  });
  handle('link:open', 'chat', name => { const url = { console:providerInfo('claude').keyUrl,gemini:providerInfo('gemini').keyUrl,openai:providerInfo('openai').keyUrl, elevenlabs:'https://elevenlabs.io/app/settings/api-keys', voices:'https://elevenlabs.io/app/voice-library', speech: 'ms-settings:speech', releases: 'https://github.com/kijung4290/parkjuim-desktop/releases/latest' }[name]; if (url) return shell.openExternal(url); });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (pet) { pet.show(); showChat(); } });
  app.whenReady().then(async () => {
    if(modelImportPreview)console.log('MODEL PREVIEW: Electron ready');
    protocol.handle('park', async request => {
      const url = new URL(request.url), relative = decodeURIComponent(url.pathname);
      if(url.host==='app'&&/^\/models\/[\da-f-]{36}$/i.test(relative)){
        try{return new Response(await modelStore.read(relative.split('/').pop()),{headers:{'Content-Type':'model/gltf-binary','Cache-Control':'no-store'}});}catch{return new Response('Not found',{status:404});}
      }
      if(url.host==='app'&&relative.startsWith('/vendor/addons/')){
        const module=relative.slice('/vendor/addons/'.length);
        if(!['loaders/GLTFLoader.js','utils/BufferGeometryUtils.js','utils/SkeletonUtils.js'].includes(module))return new Response('Forbidden',{status:403});
        const source=await fs.promises.readFile(app.isPackaged?path.join(process.resourcesPath,'three-addons',module):path.join(__dirname,'../node_modules/three/examples/jsm',module),'utf8');
        return new Response(source.replaceAll("from 'three'","from '/vendor/three.module.js'"),{headers:{'Content-Type':'application/javascript'}});
      }
      if(url.host==='app'&&/^\/grounding\/[\w-]+$/.test(relative)){
        const id=relative.split('/').pop(),html=conversation.grounding(id)||historyGroundings.get(id)?.html;
        if(!html)return new Response('Not found',{status:404});
        return new Response(`<!doctype html><meta charset="utf-8">${html}`,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https://www.gstatic.com https://www.google.com; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"}});
      }
      const root = path.resolve(__dirname, '..');
      const file = relative.startsWith('/vendor/') ? path.join(root, 'node_modules/three/build', relative.slice('/vendor/'.length)) : path.join(root, 'renderer', relative);
      const allowed = relative.startsWith('/vendor/') ? path.join(root, 'node_modules/three/build') : path.join(root, 'renderer');
      if (url.host !== 'app' || !file.startsWith(allowed + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    });
    session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const mode = smoke ? 'development' : getUpdateMode({ packaged:app.isPackaged, platform:process.platform, portable:!!process.env.PORTABLE_EXECUTABLE_FILE, executable:app.getPath('exe') });
    startup = createStartupController({ app, mode });
    if(modelImportPreview)console.log('MODEL PREVIEW: opening isolated settings');
    store = await createStore(app.getPath('userData'), safeStorage);
    if(smoke)await store.save({...DEFAULTS,clearKey:true,clearGeminiKey:true,clearOpenAIKey:true,clearElevenLabsKey:true});
    try{historyStore=await createHistoryStore(app.getPath('userData'),safeStorage);if(smoke)await historyStore.clear();}catch(error){historyError=error.message;}
    try{modelStore=await createModelStore(app.getPath('userData'));if(smoke)for(const model of modelStore.list())await modelStore.remove(model.id);}catch(error){modelStoreError=error.message;}
    if(modelImportPreview)console.log('MODEL PREVIEW: isolated stores ready');
    settings = currentSettings();
    elevenLabs = createElevenLabs({ key:() => store.elevenLabsKey() || environmentKey(), allowEnvironment:!smoke });
    pet = secureWindow({ ...petSize(), transparent: true, skipTaskbar: true, hasShadow: false, title: '박주임 미니미' });
    chat = secureWindow({ width: 380, height: 490, transparent: true, hasShadow: false, skipTaskbar: true, title: '박주임과 대화' });
    pet.setAlwaysOnTop(settings.alwaysOnTop, 'floating'); chat.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
    pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    chat.on('close', event => { if (!isQuitting) { event.preventDefault(); hideChat(); } });
    pet.on('closed', () => { if (!isQuitting) app.quit(); });
    chat.on('hide', () => { emit(chat, 'view:open', 'hidden'); petState(); });
    updates = createUpdateController({
      updater: mode === 'installed' ? require('electron-updater').autoUpdater : null,
      mode, version:app.getVersion(), notify:state=>broadcast('update:state',state),
      isBusy:()=>!!(activeRequest || voiceProcess || speechProcess || cloudSpeech || selectingFiles || managingHistory)
    });
    registerIpc();
    if(modelImportPreview)console.log('MODEL PREVIEW: loading windows');
    await Promise.all([pet.loadURL('park://app/pet.html'), chat.loadURL('park://app/chat.html')]);
    resetPosition(); pet.showInactive();
    const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png'));
    tray = new Tray(icon); tray.setToolTip('박주임 미니미 · 클릭해서 대화하기'); tray.on('click', () => showChat()); tray.on('right-click', contextMenu);applyCharacterName();
    wanderTimer = setInterval(wander, 1000 / 60);
    updates.start();
    screen.on('display-metrics-changed', resetPosition); screen.on('display-removed', resetPosition);
    app.on('browser-window-blur', () => { if (dragging || pressed) releasePetPress(); });
    if (process.argv.includes('--dev')) chat.webContents.openDevTools({ mode: 'detach' });
    if(modelImportPreview){showChat('settings');chat.setPosition(80,80);}
    if (smoke&&!modelImportPreview) {
      try {
        await pet.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{if(window.__petTestState?.().portraitReady){clearInterval(timer);resolve(true);}else if(++tries>120){clearInterval(timer);reject(new Error('3D pet did not become ready'));}},50);})`);
        await new Promise(resolve => setTimeout(resolve, 300));
        // Exercise movement and pauses through the real native window and IPC.
        const start = pet.getBounds();
        hovered=false;walker.setGoal(start,{x:start.x-100,y:start.y},Date.now());
        fs.mkdirSync(smokeRoot,{recursive:true});
        let walkState;
        for(let i=0;i<40;i++){await new Promise(resolve=>setTimeout(resolve,50));walkState=await pet.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>resolve(window.__petTestState())))');if(walkState.moving&&walkState.distance>0&&Math.abs(walkState.yaw)>.4)break;}
        if(!walkState.moving||!(walkState.distance>0)||Math.abs(walkState.yaw)<.4)throw new Error(`Essential gait is not animating: ${JSON.stringify(walkState)}`);
        fs.writeFileSync(path.join(smokeRoot,'walk-a.png'),(await pet.webContents.capturePage()).toPNG());
        await new Promise(resolve=>setTimeout(resolve,550));
        fs.writeFileSync(path.join(smokeRoot,'walk-b.png'),(await pet.webContents.capturePage()).toPNG());
        const walked = pet.getBounds().x;
        if (walked >= start.x - 5) throw new Error('Roaming did not move the pet');
        const hoverBounds=pet.getBounds();
        pointerOverride={x:hoverBounds.x+hoverBounds.width*.5,y:hoverBounds.y+hoverBounds.height*.55};
        updatePetPointer();
        await new Promise(resolve => setTimeout(resolve, 150));
        const stopped = pet.getBounds().x;
        await new Promise(resolve => setTimeout(resolve, 250));
        if (pet.getBounds().x !== stopped) throw new Error('Pet failed to pause on hover');
        if(!inputEnabled||!hovered)throw new Error('Native cursor recovery did not enable input');
        const clickPoint={x:Math.round(hoverBounds.width*.5),y:Math.round(hoverBounds.height*.55)};
        const globalPoint={globalX:Math.round(hoverBounds.x+clickPoint.x),globalY:Math.round(hoverBounds.y+clickPoint.y)};
        const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        await pet.webContents.executeJavaScript("window.__clickTrace=[];['pointerdown','mousemove','pointerup','click','blur'].forEach(type=>document.addEventListener(type,event=>{window.__clickTrace.push({type,x:event.clientX,sx:event.screenX,buttons:event.buttons});},true));");
        const flushInput=async()=>{await pet.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');await delay(100);};
        const clickPet=async()=>{
          pet.focus();await delay(60);
          pet.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...clickPoint,...globalPoint});
          await delay(50);
          pet.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...clickPoint,...globalPoint});
          await delay(800);
          await flushInput();
        };
        // No renderer mousemove or window.park.toggleChat call: exercise the
        // previously untested first click, including focus and pointer capture.
        await clickPet();
        if(!chat.isVisible()){console.error('CLICK TRACE',JSON.stringify(await pet.webContents.executeJavaScript('window.__clickTrace')));throw new Error('First actual renderer mouse click did not open chat');}
        await clickPet();
        if(chat.isVisible())throw new Error('Second mouse click did not close chat');
        pet.focus();await delay(60);
        pet.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...clickPoint,...globalPoint});await delay(50);
        pet.webContents.sendInputEvent({type:'mouseMove',button:'left',modifiers:['leftButtonDown'],x:clickPoint.x+25,y:clickPoint.y,globalX:globalPoint.globalX+25,globalY:globalPoint.globalY});await delay(100);
        pet.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:clickPoint.x+25,y:clickPoint.y,globalX:globalPoint.globalX+25,globalY:globalPoint.globalY});await delay(800);
        await flushInput();
        if(chat.isVisible()){console.error('DRAG TRACE',JSON.stringify(await pet.webContents.executeJavaScript('window.__clickTrace')));throw new Error('Dragging must not open the conversation');}
        await clickPet();
        if(!chat.isVisible())throw new Error('Click after drag failed to open chat');
        pointerOverride={x:-999999,y:-999999};updatePetPointer();
        resetPosition();
        placeChat();
        const state = await pet.webContents.executeJavaScript('({ ready: document.body.dataset.ready, error: document.body.dataset.error, canvas: !!document.querySelector("canvas") })');
        if (state.ready !== 'true') throw new Error(`3D renderer failed: ${JSON.stringify(state)}`);
        const dir = smokeRoot; fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pet.png'), (await pet.webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(dir, 'chat.png'), (await chat.webContents.capturePage()).toPNG());
        const chatTest = await chat.webContents.executeJavaScript('window.__smokeTest(true)');
        await chat.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
        fs.writeFileSync(path.join(dir,'settings.png'),(await chat.webContents.capturePage()).toPNG());
        await chat.webContents.executeJavaScript("document.querySelector('#back-chat').click()");
        const keyState = await chat.webContents.executeJavaScript('window.park.settings()');
        if (chatTest !== true || !keyState.model) throw new Error('Chat bridge check failed');
        const missingKey = await chat.webContents.executeJavaScript('window.park.send("smoke-no-key", {text:"test"})');
        if (!missingKey.error?.includes('API 키')) throw new Error('Missing API key guard failed');
        const secureKey = 'sk-ant-smoke-test-key-123456789';
        const secured = await store.save({apiKey:secureKey});
        if (!secured.hasKey || secured.apiKey || fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'),'utf8').includes(secureKey)) throw new Error('OS key encryption failed');
        await store.save({elevenLabsApiKey:'sk-test-restart-key-123456789'});
        const reopened = await createStore(app.getPath('userData'),safeStorage);
        if (reopened.key() !== secureKey || reopened.elevenLabsKey() !== 'sk-test-restart-key-123456789') throw new Error('Credentials did not survive an actual async decrypt/reopen');
        await store.save({clearElevenLabsKey:true});
        for(const [type,hairStyle]of [['cat','curly'],['rabbit','curly'],['human','bob'],['human','short'],['cat','curly']]){
          const before=await pet.webContents.executeJavaScript('window.__petTestState().appearance');
          const preview=await chat.webContents.executeJavaScript(`(async()=>{
            document.querySelector('#open-settings').click();
            const change=(id,value)=>{const field=document.querySelector('#'+id);if(typeof value==='boolean')field.checked=value;else field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));};
            change('character-name','모찌');change('character-type','${type}');change('character-hair','${hairStyle}');change('character-outfit','#6f99ad');change('character-glasses',true);
            document.querySelector('#character-preview').scrollIntoView({block:'center'});
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            return window.__characterSettingsState();
          })()`);
          if(!preview.ready||!preview.visible||preview.appearance.characterType!==type)throw new Error('3D appearance preview failed');
          const unsaved=await pet.webContents.executeJavaScript('window.__petTestState().appearance');
          if(unsaved.characterType!==before.characterType||unsaved.hairStyle!==before.hairStyle)throw new Error('Unsaved appearance leaked to desktop pet');
          await delay(120);fs.writeFileSync(path.join(dir,`character-preview-${type}-${hairStyle}.png`),(await chat.webContents.capturePage()).toPNG());
          await chat.webContents.executeJavaScript(`(async()=>{
            document.querySelector('#settings-form').requestSubmit();
            for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));const settings=await window.park.settings();if(settings.characterName==='모찌'&&settings.characterType==='${type}'&&settings.hairStyle==='${hairStyle}'&&!document.querySelector('#settings-form .save-button').disabled){if(document.querySelector('#character-label').textContent!=='모찌')throw new Error('Custom name did not reach chat header');document.querySelector('#back-chat').click();return true;}}throw new Error('Appearance settings did not save');
          })()`);
          for(let i=0;i<30;i++){await delay(50);const state=await pet.webContents.executeJavaScript('window.__petTestState()');if(state.appearance.characterType===type&&state.appearance.hairStyle===hairStyle&&state.portraitReady)break;}
          const applied=await pet.webContents.executeJavaScript('window.__petTestState()');
          if(applied.appearance.characterType!==type||applied.appearance.outfitColor!=='#6f99ad'||!applied.appearance.glasses||!applied.portraitReady)throw new Error('Saved appearance did not reach desktop mesh');
          const portrait=await chat.webContents.executeJavaScript(`({src:document.querySelector('.identity img').src,width:document.querySelector('.identity img').naturalWidth})`);
          if(!portrait.src.startsWith('data:image/png;base64,')||portrait.width!==160)throw new Error('Custom 3D portrait did not reach the chat avatar');
          if(await chat.webContents.executeJavaScript('window.__characterSettingsState().visible'))throw new Error('Hidden 3D preview kept running');
          fs.writeFileSync(path.join(dir,`pet-${type}-${hairStyle}.png`),(await pet.webContents.capturePage()).toPNG());
        }
        const appearanceReopened=await createStore(app.getPath('userData'),safeStorage);
        if(appearanceReopened.get().characterName!=='모찌'||appearanceReopened.get().characterType!=='cat'||appearanceReopened.key()!==secureKey||appearanceReopened.get().nickname!=='')throw new Error('Appearance persistence or credential separation failed');
        const originalGLB=path.join(dir,'smoke-robot.glb'),modelBytes=require('./model-fixture.cjs').modelFixture();fs.writeFileSync(originalGLB,modelBytes);
        const originalPicker=chooseFiles;
        try{
          chooseFiles=async()=>({canceled:false,filePaths:[originalGLB]});
          // File inputs and HTML drops send only the chosen File's bytes. These
          // DOM events exercise the real renderer, preload, IPC and GLB store.
          for(const method of ['input','drop']){
            await chat.webContents.executeJavaScript(`(async()=>{
              document.querySelector('#open-settings').click();
              const data=new DataTransfer(),file=new File([new Uint8Array(${JSON.stringify([...modelBytes])})],'${method}-robot.GLB',{type:'application/octet-stream'});data.items.add(file);
              if('${method}'==='input'){const input=document.querySelector('#character-file');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
              else document.querySelector('#character-drop-zone').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
              for(let i=0;i<300;i++){await new Promise(r=>setTimeout(r,50));if(window.__characterSettingsState().appearance?.customReady&&!document.querySelector('#character-file').disabled){
                const all=(await window.park.customModels()).items;if(all.length!==1||all[0].name!=='${method}-robot')throw new Error('Selected file bytes not imported');
                document.querySelector('#character-delete').click();document.querySelector('#character-delete').click();
                for(let j=0;j<100;j++){await new Promise(r=>setTimeout(r,50));if(!(await window.park.customModels()).items.length&&!document.querySelector('#character-file').disabled)return true;}
              }}throw new Error('${method} GLB import failed: '+document.querySelector('#character-model-feedback').textContent);
            })()`);
          }
          await chat.webContents.executeJavaScript(`(async()=>{
            const input=document.querySelector('#character-file'),data=new DataTransfer();data.items.add(new File(['not a GLB'],'image.png'));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
            for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));if(document.querySelector('#character-model-feedback').textContent.includes('.glb')&&!input.disabled){if((await window.park.customModels()).items.length)throw new Error('Invalid file entered library');return true;}}
            throw new Error('Invalid file feedback missing');
          })()`);
          await chat.webContents.executeJavaScript(`(async()=>{
            document.querySelector('#open-settings').click();document.querySelector('#character-import').click();
            for(let i=0;i<300;i++){await new Promise(r=>setTimeout(r,50));const preview=window.__characterSettingsState();if(preview.appearance?.customReady){document.querySelector('#character-rotation').value='90';document.querySelector('#character-rotation').dispatchEvent(new Event('input'));document.querySelector('#character-preview').scrollIntoView({block:'center'});return true;}}throw new Error('GLB preview failed: '+document.querySelector('#character-model-feedback').textContent);
          })()`);
          if(store.get().characterType==='custom')throw new Error('Unsaved GLB preview changed the desktop');
          await delay(150);fs.writeFileSync(path.join(dir,'custom-model-preview.png'),(await chat.webContents.capturePage()).toPNG());
          await chat.webContents.executeJavaScript(`(async()=>{
            document.querySelector('#settings-form').requestSubmit();for(let i=0;i<150;i++){await new Promise(r=>setTimeout(r,50));const settings=await window.park.settings();if(settings.characterType==='custom'&&settings.modelRotation===90&&!document.querySelector('#settings-form .save-button').disabled){document.querySelector('#back-chat').click();return true;}}throw new Error('GLB selection did not save');
          })()`);
          let importedState;for(let i=0;i<100;i++){await delay(50);importedState=await pet.webContents.executeJavaScript('window.__petTestState()');if(importedState.appearance.customReady)break;}
          if(!importedState.appearance.customReady||!importedState.appearance.animations.includes('Idle'))throw new Error('Desktop did not load the imported mesh and animation');
          await pet.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');await delay(150);
          importedState=await pet.webContents.executeJavaScript('window.__petTestState()');
          fs.writeFileSync(path.join(dir,'custom-model-state.json'),JSON.stringify(importedState));
          if(!importedState.modelProjection?.inside)throw new Error('Imported model exceeds the desktop canvas: '+JSON.stringify(importedState.modelProjection));
          fs.writeFileSync(path.join(dir,'pet-custom-model.png'),(await pet.webContents.capturePage()).toPNG());
          const restoredModelStore=await createModelStore(app.getPath('userData')),restoredModelSettings=await createStore(app.getPath('userData'),safeStorage);
          if(!restoredModelStore.has(restoredModelSettings.get().customModelId)||restoredModelSettings.get().modelRotation!==90)throw new Error('Imported GLB did not survive profile reopen');
          await chat.webContents.executeJavaScript(`(async()=>{
            document.querySelector('#open-settings').click();document.querySelector('#character-delete').click();document.querySelector('#character-delete').click();
            for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));if(window.__characterSettingsState().appearance.characterType==='human'&&(await window.park.customModels()).items.length===0){document.querySelector('#back-chat').click();return true;}}throw new Error('GLB deletion failed');
          })()`);
          if(!fs.readFileSync(originalGLB).equals(modelBytes)||store.get().customModelId||store.key()!==secureKey)throw new Error('GLB deletion modified the original or other settings');
        }finally{chooseFiles=originalPicker;}
        const XLSX=require('xlsx'),book=XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['항목','금액'],['재료비',120],['교통비',80],['합계',200]]),'예산');
        const sampleFile=path.join(dir,'smoke-budget.xlsx');fs.writeFileSync(sampleFile,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
        const realChoose=chooseFiles,realFactory=makeChatClient,priorSpeak=settings.speak;
        let fakeTurn=0,followupPreserved=false;
        try{
          chooseFiles=async()=>({canceled:false,filePaths:[sampleFile]});
          makeChatClient=()=>({messages:{stream:params=>{
            if(!params.system.includes('"모찌"'))throw new Error('Custom name did not reach AI identity');
            const stream=new(require('node:events').EventEmitter)();
            stream.finalMessage=async()=>{
              await delay(50);fakeTurn++;
              if(fakeTurn===2)followupPreserved=JSON.stringify(params.messages).includes('smoke-search-context')&&JSON.stringify(params.messages).includes('smoke-budget.xlsx');
              const citations=[{type:'char_location',document_index:0,document_title:'smoke-budget.xlsx'}];
              const content=[];
              if(params.tools){
                content.push({type:'server_tool_use',id:'smoke-tool',name:'web_search',input:{query:'Electron official'}},{type:'web_search_tool_result',tool_use_id:'smoke-tool',content:[{type:'web_search_result',url:'https://www.electronjs.org/',title:'Electron',encrypted_content:'smoke-search-context'}]});
                citations.push({type:'web_search_result_location',url:'https://www.electronjs.org/',title:'Electron 공식 문서',encrypted_index:'smoke-index'});
              }
              const answer=fakeTurn===1?'첨부한 예산의 합계는 200입니다. 공식 사이트도 확인했어요.':'교통비는 80입니다.';
              content.push({type:'text',text:answer,citations});
              for(const block of content){stream.emit('streamEvent',{type:'content_block_start',content_block:block});if(block.type==='text'){stream.emit('text',block.text);for(const citation of citations)stream.emit('citation',citation);}}
              return {content,stop_reason:'end_turn'};
            };return stream;
          }}});
          settings=await store.save({speak:false});settings=currentSettings();broadcast('settings:changed',settings);
          const researchUI=await chat.webContents.executeJavaScript(`(async()=>{
            const wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Attachment/search UI timed out: '+document.querySelector('#notice').textContent);};
            document.querySelector('#attach-file').click();await wait(()=>document.querySelectorAll('.attachment-chip').length===1);
            document.querySelector('.attachment-chip button').click();await wait(()=>document.querySelectorAll('.attachment-chip').length===0);
            document.querySelector('#attach-file').click();await wait(()=>document.querySelectorAll('.attachment-chip').length===1);
            document.querySelector('#toggle-search').click();
            document.querySelector('#message').value='첨부 예산을 분석하고 웹에서 출처를 확인해 주세요.';document.querySelector('#composer').requestSubmit();
            await wait(()=>document.querySelector('.answer-source')&&document.querySelector('#send').getAttribute('aria-label')==='메시지 보내기');
            if(document.querySelectorAll('.answer-source').length!==2||!document.querySelector('.message.assistant .bubble').textContent.includes('200'))throw new Error('Sources or analysis answer missing');
            return true;
          })()`);
          await flushInput();fs.writeFileSync(path.join(dir,'research.png'),(await chat.webContents.capturePage()).toPNG());
          await chat.webContents.executeJavaScript(`(async()=>{
            document.querySelector('#toggle-search').click();document.querySelector('#message').value='그 파일의 교통비는 얼마인가요?';document.querySelector('#composer').requestSubmit();
            for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,50));if(document.querySelectorAll('.message.assistant').length===2&&document.querySelector('#send').getAttribute('aria-label')==='메시지 보내기')return true;}throw new Error('Attachment follow-up failed');
          })()`);
          if(!researchUI||!followupPreserved)throw new Error('Search or attachment multi-turn context was lost');
          let longCalls=0;
          const longAnswer='긴 답변 테스트입니다.\n'.repeat(12000)+'끝까지 받았습니다.';
          makeChatClient=()=>({messages:{stream:params=>{
            const stream=new(require('node:events').EventEmitter)();
            stream.finalMessage=async()=>{
              longCalls++;await delay(30);
              if(longCalls===2&&!JSON.stringify(params.messages).includes(require('./reply.cjs').CONTINUE_PROMPT))throw new Error('Continuation prompt missing');
              const answer=longCalls===1?longAnswer.slice(0,70000):longAnswer.slice(70000);
              for(let i=0;i<answer.length;i+=500)stream.emit('text',answer.slice(i,i+500));
              return {stop_reason:longCalls===1?'max_tokens':'end_turn',content:[{type:'text',text:answer}]};
            };return stream;
          }}});
          await chat.webContents.executeJavaScript(`(async()=>{
            document.querySelector('#message').value='긴 답변을 끝까지 작성해 주세요';document.querySelector('#composer').requestSubmit();
            for(let i=0;i<300;i++){await new Promise(r=>setTimeout(r,50));if(document.querySelectorAll('.message.assistant').length===3&&document.querySelector('#send').getAttribute('aria-label')==='메시지 보내기'){
              const text=document.querySelectorAll('.message.assistant .bubble')[2].textContent;
              if(text!==${JSON.stringify(longAnswer)})throw new Error('Long reply UI lost text');return true;
            }}throw new Error('Long reply did not complete');
          })()`);
          if(longCalls!==2||historyStore.get(activeConversationId).turns.at(-1).assistant!==longAnswer)throw new Error('Long reply continuation or encrypted storage failed');
          await chat.webContents.executeJavaScript(`(async()=>{document.querySelector('#new-chat').click();for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));if(!document.querySelector('.message'))return true;}throw new Error('New chat did not clear history');})()`);
          if(conversation.inspect().turns!==0)throw new Error('Main conversation did not reset');
          for(const provider of ['gemini','openai']){
            makeChatClient=(_key,id)=>{
              if(id!==provider)throw new Error('Wrong provider selected');
              const answer='새 AI도 첨부 예산의 합계 200을 확인했어요.';
              const annotation={type:'url_citation',url:'https://www.electronjs.org/',title:'Electron'};
              if(id==='gemini')return {interactions:{create:async params=>{if(!params.tools||!JSON.stringify(params.input).includes('smoke-budget.xlsx'))throw new Error('Gemini files/search missing');return {status:'completed',steps:[{type:'google_search_call',queries:['Electron']},{type:'google_search_result',call_id:'s1',result:[{search_suggestions:'<div style="padding:8px;font:13px sans-serif">Google · <a target="_blank" href="https://www.google.com/search?q=Electron">Electron 검색</a></div><script>parent.evil=1</script>'}]},{type:'model_output',content:[{type:'text',text:answer,annotations:[annotation]}]}]};}}};
              return {responses:{stream:params=>{if(!params.tools||!JSON.stringify(params.input).includes('smoke-budget.xlsx'))throw new Error('GPT files/search missing');const stream=new(require('node:events').EventEmitter)();stream.finalResponse=async()=>{stream.emit('response.output_text.delta',{delta:answer});return {status:'completed',output:[{type:'web_search_call'},{type:'message',content:[{type:'output_text',text:answer,annotations:[annotation]}]}]};};return stream;}}};
            };
            const saved=await chat.webContents.executeJavaScript(`(async()=>{
              document.querySelector('#open-settings').click();const select=document.querySelector('#ai-provider');select.value='${provider}';select.dispatchEvent(new Event('change'));
              document.querySelector('#api-key').value='test-${provider}-key-123456789012345';document.querySelector('#settings-form').requestSubmit();
              for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));const settings=await window.park.settings();if(settings.aiProvider==='${provider}'&&settings.hasSelectedKey&&!document.querySelector('#settings-form .save-button').disabled){if(document.querySelector('#api-key').value)throw new Error('Key not cleared');return settings;}}throw new Error('Provider settings did not save');
            })()`);
            if(!saved.hasKey||!saved.hasSelectedKey)throw new Error('Provider key isolation failed');
            fs.writeFileSync(path.join(dir,`settings-${provider}.png`),(await chat.webContents.capturePage()).toPNG());
            await chat.webContents.executeJavaScript(`(async()=>{
              document.querySelector('#back-chat').click();if(document.querySelector('.message'))throw new Error('Provider change did not clear chat');
              document.querySelector('#attach-file').click();for(let i=0;i<400;i++){if(document.querySelector('.attachment-chip'))break;await new Promise(r=>setTimeout(r,50));}
              if(document.querySelector('#toggle-search').getAttribute('aria-pressed')!=='true')document.querySelector('#toggle-search').click();
              document.querySelector('#message').value='분석하고 검색해 주세요';document.querySelector('#composer').requestSubmit();
              for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,50));if(document.querySelector('.answer-source')&&document.querySelector('#send').getAttribute('aria-label')==='메시지 보내기'){if(!document.querySelector('.message.assistant .bubble').textContent.includes('200'))throw new Error('Provider answer missing');return true;}}throw new Error('Provider chat failed: '+document.querySelector('#notice').textContent);
            })()`);
            if(provider==='gemini'){
              await delay(300);
              const frame=await chat.webContents.executeJavaScript(`({sandbox:document.querySelector('.google-suggestions')?.getAttribute('sandbox'),evil:!!window.evil})`);
              if(frame.evil||frame.sandbox!=='allow-popups allow-popups-to-escape-sandbox')throw new Error('Google suggestions sandbox failed');
              let child;
              for(let i=0;i<40;i++){child=chat.webContents.mainFrame.frames.find(item=>item.url.startsWith('park://app/grounding/'));if(child)break;await delay(100);}
              if(!child)throw new Error('Google suggestions did not load: '+JSON.stringify(chat.webContents.mainFrame.frames.map(item=>item.url)));
              fs.writeFileSync(path.join(dir,'gemini-search.png'),(await chat.webContents.capturePage()).toPNG());
            }
          }
          const allKeys=await createStore(app.getPath('userData'),safeStorage);
          if(!allKeys.keyFor('gemini')||!allKeys.keyFor('openai')||!allKeys.key())throw new Error('Provider keys did not survive reopen');
          const savedGemini=historyStore.list().find(record=>record.provider==='gemini');
          if(!savedGemini||historyStore.list().length!==3)throw new Error('Completed chats were not saved separately');
          await chat.webContents.executeJavaScript(`(async()=>{
            const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('History list UI timed out: '+document.querySelector('#history-feedback').textContent);};
            document.querySelector('#open-history').click();await wait(()=>document.querySelectorAll('.history-item').length===3&&!document.querySelector('#history-new').disabled);
            document.querySelector('[data-id="${savedGemini.id}"] .history-actions button').click();const input=document.querySelector('[data-id="${savedGemini.id}"] input');input.value='10월 예산 이야기';input.form.requestSubmit();
            await wait(()=>!document.querySelector('.history-edit')&&document.querySelector('[data-id="${savedGemini.id}"] strong')?.textContent==='10월 예산 이야기'&&!document.querySelector('#history-new').disabled);
            const search=document.querySelector('#history-search');search.value='10월';search.dispatchEvent(new Event('input'));if(document.querySelectorAll('.history-item').length!==1)throw new Error('History title search failed');
            search.value='';search.dispatchEvent(new Event('input'));document.querySelector('#history-list').scrollTop=0;
          })()`);
          await chat.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');await delay(100);
          fs.writeFileSync(path.join(dir,'history.png'),(await chat.webContents.capturePage()).toPNG());
          makeChatClient=(_key,id)=>{if(id!=='gemini')throw new Error('Saved chat did not select its original provider');return {interactions:{create:async params=>{
            if(!JSON.stringify(params.input).includes('200')||JSON.stringify(params.input).includes('mime_type')||!params.system_instruction.includes('과거 첨부 파일의 원문은 없으므로'))throw new Error('Restored history did not preserve text-only context');
            return {status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'저장된 대화에서 이어서 답했어요.'}]}]};
          }}};};
          await chat.webContents.executeJavaScript(`(async()=>{
            document.querySelector('[data-id="${savedGemini.id}"] .history-open').click();
            for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,50));if(document.querySelector('#history-panel').hidden&&document.querySelectorAll('.message.assistant').length===1){if(!document.querySelector('#notice').textContent.includes('재첨부')||!document.querySelector('.google-suggestions'))throw new Error('Missing attachment notice or Google search suggestions');break;}}
            if(document.querySelector('#toggle-search').getAttribute('aria-pressed')==='true')document.querySelector('#toggle-search').click();
            document.querySelector('#message').value='이전 대화에서 이어서 답해 주세요.';document.querySelector('#composer').requestSubmit();
            for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,50));if(document.querySelectorAll('.message.assistant').length===2&&document.querySelector('#send').getAttribute('aria-label')==='메시지 보내기')return true;}throw new Error('Saved conversation follow-up failed');
          })()`);
          const reopenedHistory=await createHistoryStore(app.getPath('userData'),safeStorage);
          if(reopenedHistory.get(savedGemini.id).turns.length!==2||reopenedHistory.get(savedGemini.id).title!=='10월 예산 이야기')throw new Error('Renamed conversation did not survive encrypted reopen');
          const historyDisk=fs.readFileSync(path.join(app.getPath('userData'),'conversations.json'),'utf8');
          if(historyDisk.includes('10월 예산 이야기')||historyDisk.includes('저장된 대화에서'))throw new Error('Conversation history was stored in plaintext');
          await chat.webContents.executeJavaScript(`(async()=>{
            document.querySelector('#open-history').click();const search=document.querySelector('#history-search');search.value='';search.dispatchEvent(new Event('input'));
            for(let i=0;i<100;i++){if(document.querySelectorAll('.history-item').length===3&&!document.querySelector('#history-new').disabled)break;await new Promise(r=>setTimeout(r,50));}
            document.querySelectorAll('[data-id="${savedGemini.id}"] .history-actions button')[1].click();document.querySelector('[data-id="${savedGemini.id}"] .history-edit .danger').click();
            for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));if(document.querySelectorAll('.history-item').length===2&&!document.querySelector('#history-new').disabled){document.querySelector('#close-history').click();return true;}}throw new Error('History deletion failed');
          })()`);
          if(historyStore.list().length!==2||historyStore.list().some(record=>record.id===savedGemini.id)||activeConversationId!==null||conversation.inspect().turns!==0)throw new Error('Active conversation deletion did not reset context');
          await updateSettings({aiProvider:'claude',clearGeminiKey:true,clearOpenAIKey:true});
          await chat.webContents.executeJavaScript(`(async()=>{document.querySelector('#open-settings').click();document.querySelector('#character-reset').click();document.querySelector('#settings-form').requestSubmit();for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));const settings=await window.park.settings();if(settings.characterName==='박주임'&&settings.characterType==='human'&&!document.querySelector('#settings-form .save-button').disabled){document.querySelector('#back-chat').click();return true;}}throw new Error('Default character reset failed');})()`);
        }finally{chooseFiles=realChoose;makeChatClient=realFactory;conversation.reset();settings=await store.save({speak:priorSpeak});settings=currentSettings();broadcast('settings:changed',settings);}
        await store.save({clearKey:true});
        const paused = pet.getBounds().x;
        await new Promise(resolve => setTimeout(resolve, 250));
        if (pet.getBounds().x !== paused) throw new Error('Pet failed to pause during chat');
        const capabilities = await new Promise((resolve,reject)=>{
          const proc=speechTask('probe'); let output='';
          const timeout=setTimeout(()=>{proc.kill();reject(new Error('Packaged speech helper timed out'));},20000);
          proc.stdout.setEncoding('utf8');proc.stdout.on('data',data=>{output+=data;});
          proc.on('error',error=>{clearTimeout(timeout);reject(error);});
          proc.on('close',code=>{clearTimeout(timeout);try{const parsed=JSON.parse(output.trim());if(code!==0||parsed.type!=='capabilities')throw new Error(output);resolve(parsed);}catch(error){reject(error);}});
        });
        let voicePlayback = null;
        if (voiceSmoke) {
          // Reuse the ONE authorized live sample, so renderer regression tests
          // exercise decoding and IPC without spending more API credits.
          const sampleDir=path.join(__dirname,'../.preview/elevenlabs');
          const sample=fs.readFileSync(path.join(sampleDir,'sample.mp3'));
          const sampleResult=JSON.parse(fs.readFileSync(path.join(sampleDir,'result.json'),'utf8'));
          const config=sampleResult.config;
          let observedConfig;
          elevenLabs={voices:async()=>({voices:[{id:config.elevenLabsVoiceId,name:config.elevenLabsVoiceName,description:'한국어 미리듣기 검사',korean:false}],nextPageToken:''}),synthesize:async(_text,input)=>{observedConfig=input;return sample;}};
          await store.save({...config,speechProvider:'elevenlabs',elevenLabsApiKey:'sk-test-voice-key-1234567890'});
          settings=currentSettings();broadcast('settings:changed',settings);showChat('settings');
          await chat.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,300))`);
          voicePlayback=await chat.webContents.executeJavaScript(`(async()=>{
            const wait=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Voice UI timed out: '+JSON.stringify(window.__speechTestState())+' '+document.querySelector('#voice-feedback').textContent);};
            await wait(()=>document.querySelector('#voice-choice').options.length>1);
            document.querySelector('#voice-stability').value='0.6';
            document.querySelector('#settings-form').requestSubmit();
            await wait(()=>document.querySelector('#settings-feedback').textContent.includes('저장했어요'));
            document.querySelector('#preview-voice').scrollIntoView({block:'center'});
            document.querySelector('#preview-voice').click();
            await wait(()=>window.__speechTestState().started>0);
            const playing=window.__speechTestState();
            if(!playing.active||!(playing.duration>1))throw new Error('HTML audio playback did not start');
            await wait(()=>window.__speechTestState().ended>0);
            return {...window.__speechTestState(),saved:document.querySelector('#voice-choice').value};
          })()`);
          if(store.get().voiceStability!==.6||observedConfig?.voiceStability!==.6||cloudSpeech)throw new Error('Voice config or playback lifecycle failed');
          fs.writeFileSync(path.join(dir,'voice-settings.png'),(await chat.webContents.capturePage()).toPNG());
          await store.save({clearElevenLabsKey:true});
        }
        const result={...state,chatTest,glbFileInput:true,glbDrop:true,glbInvalidFile:true,longReplyContinuation:true,longReplyHistory:true,customCharacter:true,glbImport:true,glbAnimation:true,glbReopen:true,glbDelete:true,customName:true,appearanceReopen:true,live3DPreview:true,dynamicPortrait:true,defaultAppearanceReset:true,nativeClick:true,repeatClick:true,dragDoesNotChat:true,nativeHitRecovery:true,essentialGait:true,reducedMotion:walkState.reduced,roaming:true,hoverPause:true,chatPause:true,encryptedKey:true,keyReopen:true,aiProviders:true,providerKeyReopen:true,providerSearchFiles:true,historyList:true,historyRename:true,historyResume:true,historyDelete:true,historyEncryptedReopen:true,googleSuggestionsSandbox:true,attachments:true,officeWorker:true,searchUI:true,sourceLinks:true,followupContext:true,newChatReset:true,missingKeyGuard:true,speechHelper:true,voicePlayback,capabilities,model:keyState.model,pet:pet.getBounds(),chat:chat.getBounds()};
        fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
        console.log('SMOKE PASS', JSON.stringify(result));
        app.exit(0);
      } catch (error) {
        console.error(error);
        try{fs.writeFileSync(path.join(smokeRoot,'smoke-failure.png'),(await chat.webContents.capturePage()).toPNG());console.error('SMOKE UI STATE',JSON.stringify(await chat.webContents.executeJavaScript(`({notice:document.querySelector('#notice').textContent,settings:!document.querySelector('#settings-panel').hidden,send:document.querySelector('#send').getAttribute('aria-label'),messages:[...document.querySelectorAll('.message .bubble')].map(item=>item.textContent.slice(0,200)),model:document.querySelector('#character-model-feedback').textContent})`)));}catch{}
        app.exit(1);
      }
    }
  }).catch(error => { console.error(error); app.exit(1); });
}
app.on('before-quit', () => { isQuitting = true; updates?.dispose(); clearInterval(wanderTimer); activeRequest?.controller.abort(); voiceStop(); silence(); });
app.on('window-all-closed', () => app.quit());
