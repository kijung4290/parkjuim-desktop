const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, safeStorage, shell, protocol, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { DEFAULTS, SYSTEM_PROMPT, clampPosition, chatBounds, validateMessages } = require('./core.cjs');
const { createStore } = require('./store.cjs');
const { createUpdateController, getUpdateMode } = require('./updater.cjs');
const { createWalker } = require('./movement.cjs');
const { isPetRegion } = require('./interaction.cjs');
const { createStartupController } = require('./startup.cjs');
const { createElevenLabs, SAMPLE_TEXT } = require('./elevenlabs.cjs');
const { randomUUID } = require('node:crypto');
const voiceSmoke = process.argv.includes('--voice-smoke-test');
const smoke = process.argv.includes('--smoke-test') || voiceSmoke;
// Local onboarding credentials are development-only and never bundled.
if (!app.isPackaged && !smoke) require('dotenv').config({ path:path.join(__dirname,'../.env.local'), quiet:true });
const smokeRoot = app.isPackaged ? path.join(path.dirname(app.getPath('exe')), '.preview') : path.join(__dirname, '../.preview');
if (smoke) app.setPath('userData', path.join(smokeRoot, 'smoke-data'));
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
const currentSettings = () => ({ ...store.get(), ...startup.get(), hasElevenLabsKey:!!(store.elevenLabsKey() || environmentKey()), elevenLabsKeySource:store.elevenLabsKey() ? 'saved' : environmentKey() ? 'environment' : '' });
const petSize = () => ({ width: Math.round(194 * settings.scale), height: Math.round(250 * settings.scale) });
function emit(win, channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function broadcast(channel, data) { emit(pet, channel, data); emit(chat, channel, data); }
function petState(extra = {}) { emit(pet, 'pet:state', { ...motion, moving, direction, hovered, scale:settings?.scale || 1, chatting: !!chat?.isVisible(), ...extra }); }
const readPointer = () => pointerOverride || screen.getCursorScreenPoint();
function setPetInteractive(value) {
  if (inputEnabled === value || !pet || pet.isDestroyed()) return;
  inputEnabled = value;
  pet.setIgnoreMouseEvents(!value, {forward:true});
}
function updatePetPointer() {
  if (!pet || pet.isDestroyed()) return;
  const point=readPointer(), bounds=pet.getBounds(), over=isPetRegion(point,bounds);
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  return win;
}
function placeChat() { if (chat && !chat.isDestroyed()) chat.setBounds(chatBounds(pet.getBounds(), screen.getDisplayMatching(pet.getBounds()).workArea)); }
function showChat(view = 'chat') {
  walker.pause(Date.now()); moving = false; placeChat(); chat.show(); chat.focus();
  emit(chat, 'view:open', view); petState();
}
function hideChat() { voiceStop(); silence(); chat.hide(); walker.pause(Date.now(),2500); petState(); }
function contextMenu() {
  settings = currentSettings();
  Menu.buildFromTemplate([
    { label: '박주임과 대화하기', click: () => showChat() },
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
  await store.save(input);
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
  broadcast('settings:changed', settings); return settings;
}
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
  handle('settings:save', 'chat', input => updateSettings(input));
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
  handle('chat:send', 'chat', async (id, input) => {
    if (activeRequest) throw new Error('답변을 마치거나 중지한 뒤 다시 보내 주세요.');
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new Error('잘못된 요청입니다.');
    const messages = validateMessages(input), apiKey = store.key();
    if (!apiKey) throw new Error('설정에서 Claude API 키를 먼저 입력해 주세요.');
    const Anthropic = require('@anthropic-ai/sdk');
    const controller = new AbortController(); activeRequest = { controller, id };
    const timeout = setTimeout(() => controller.abort(), 90000);
    let text = '';
    petState({ thinking: true });
    try {
      const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60000 });
      const stream = await client.messages.create({ model: settings.model, max_tokens: 2048, stream: true, system: SYSTEM_PROMPT + (settings.nickname ? `\n사용자 호칭: ${settings.nickname}` : '') + (settings.systemPrompt ? `\n추가 요청: ${settings.systemPrompt}` : ''), messages }, { signal: controller.signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') { text += event.delta.text; emit(chat, 'chat:event', { type: 'delta', id, text: event.delta.text }); }
        if (event.type === 'message_delta' && event.delta.stop_reason === 'max_tokens') emit(chat, 'chat:event', { type: 'notice', id, text: '답변 길이 한도에 도달했어요. 이어서 설명해 달라고 해 주세요.' });
      }
      emit(chat, 'chat:event', { type: 'done', id, text });
      return { ok: true };
    } catch (error) {
      const message = controller.signal.aborted ? '답변을 중지했어요.' : ({ 401: 'API 키가 올바르지 않아요. 설정에서 확인해 주세요.', 403: '이 API 키의 사용 권한을 확인해 주세요.', 404: '이 모델을 사용할 수 없어요. 설정의 모델 ID를 확인해 주세요.', 429: '요청 한도 또는 API 잔액을 확인한 후 다시 시도해 주세요.', 529: 'Claude가 잠시 바빠요. 조금 뒤 다시 시도해 주세요.' }[error.status] || 'Claude에 연결하지 못했어요. 인터넷 연결과 API 사용 상태를 확인해 주세요.');
      emit(chat, 'chat:event', { type: 'error', id, text, message }); return { error: message };
    } finally { clearTimeout(timeout); activeRequest = null; petState({ thinking: false }); }
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
  handle('voice:preview', 'chat', input => speak(SAMPLE_TEXT, input || {}));
  on('voice:playback','chat',(id,state) => {
    if (id !== cloudSpeech?.id || !['playing','ended','error'].includes(state)) return;
    if (state === 'playing') {
      const request=cloudSpeech; clearTimeout(request.timer);
      request.timer=setTimeout(()=>{if(cloudSpeech===request)silence();},15*60*1000);
      petState({speaking:true}); emit(chat,'voice:event',{type:'speech-state',state:'playing'});
    } else silence();
  });
  handle('link:open', 'chat', name => { const url = { console: 'https://platform.claude.com/settings/keys', elevenlabs:'https://elevenlabs.io/app/settings/api-keys', voices:'https://elevenlabs.io/app/voice-library', speech: 'ms-settings:speech', releases: 'https://github.com/kijung4290/parkjuim-desktop/releases/latest' }[name]; if (url) return shell.openExternal(url); });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (pet) { pet.show(); showChat(); } });
  app.whenReady().then(async () => {
    protocol.handle('park', request => {
      const url = new URL(request.url), relative = decodeURIComponent(url.pathname);
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
    store = await createStore(app.getPath('userData'), safeStorage); settings = currentSettings();
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
      isBusy:()=>!!(activeRequest || voiceProcess || speechProcess || cloudSpeech)
    });
    registerIpc();
    await Promise.all([pet.loadURL('park://app/pet.html'), chat.loadURL('park://app/chat.html')]);
    resetPosition(); pet.showInactive();
    const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png'));
    tray = new Tray(icon); tray.setToolTip('박주임 미니미 · 클릭해서 대화하기'); tray.on('click', () => showChat()); tray.on('right-click', contextMenu);
    wanderTimer = setInterval(wander, 1000 / 60);
    updates.start();
    screen.on('display-metrics-changed', resetPosition); screen.on('display-removed', resetPosition);
    app.on('browser-window-blur', () => { if (dragging || pressed) releasePetPress(); });
    if (process.argv.includes('--dev')) chat.webContents.openDevTools({ mode: 'detach' });
    if (smoke) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1200));
        // Exercise movement and pauses through the real native window and IPC.
        const start = pet.getBounds();
        hovered=false;walker.setGoal(start,{x:start.x-100,y:start.y},Date.now());
        fs.mkdirSync(smokeRoot,{recursive:true});
        await new Promise(resolve=>setTimeout(resolve,550));
        const walkState=await pet.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>resolve(window.__petTestState())))');
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
        const missingKey = await chat.webContents.executeJavaScript('window.park.send("smoke-no-key", [{role:"user",content:"test"}])');
        if (!missingKey.error?.includes('API 키')) throw new Error('Missing API key guard failed');
        const secureKey = 'sk-ant-smoke-test-key-123456789';
        const secured = await store.save({apiKey:secureKey});
        if (!secured.hasKey || secured.apiKey || fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'),'utf8').includes(secureKey)) throw new Error('OS key encryption failed');
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
        const result={...state,chatTest,nativeClick:true,repeatClick:true,dragDoesNotChat:true,nativeHitRecovery:true,essentialGait:true,reducedMotion:walkState.reduced,roaming:true,hoverPause:true,chatPause:true,encryptedKey:true,missingKeyGuard:true,speechHelper:true,voicePlayback,capabilities,model:keyState.model,pet:pet.getBounds(),chat:chat.getBounds()};
        fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
        console.log('SMOKE PASS', JSON.stringify(result));
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    }
  }).catch(error => { console.error(error); app.exit(1); });
}
app.on('before-quit', () => { isQuitting = true; updates?.dispose(); clearInterval(wanderTimer); activeRequest?.controller.abort(); voiceStop(); silence(); });
app.on('window-all-closed', () => app.quit());
