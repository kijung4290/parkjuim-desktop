const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, safeStorage, shell, protocol, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { DEFAULTS, SYSTEM_PROMPT, clampPosition, chatBounds, validateMessages } = require('./core.cjs');
const { createStore } = require('./store.cjs');
const { createUpdateController, getUpdateMode } = require('./updater.cjs');
const smoke = process.argv.includes('--smoke-test');
const smokeRoot = app.isPackaged ? path.join(path.dirname(app.getPath('exe')), '.preview') : path.join(__dirname, '../.preview');
if (smoke) app.setPath('userData', path.join(smokeRoot, 'smoke-data'));
protocol.registerSchemesAsPrivileged([{ scheme: 'park', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setAppUserModelId('kr.parkjuim.desktop');
let pet, chat, tray, store, activeRequest, voiceProcess, speechProcess, settings, dragging, wanderTimer;
let hovered = false, target = null, restUntil = Date.now() + 5000, lastTick = Date.now(), moving = false, direction = 1;
let isQuitting = false;
let updates;
const petSize = () => ({ width: Math.round(194 * settings.scale), height: Math.round(250 * settings.scale) });
function emit(win, channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function broadcast(channel, data) { emit(pet, channel, data); emit(chat, channel, data); }
function petState(extra = {}) { emit(pet, 'pet:state', { moving, direction, chatting: !!chat?.isVisible(), ...extra }); }
function trusted(event, kind) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const expected = kind === 'pet' ? pet : kind === 'chat' ? chat : null;
  if ((!expected && win !== pet && win !== chat) || (expected && win !== expected) || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith('park://app/')) throw new Error('허용되지 않은 요청입니다.');
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
  target = null; moving = false; pet.setIgnoreMouseEvents(false); placeChat(); chat.show(); chat.focus();
  emit(chat, 'view:open', view); petState();
}
function hideChat() { voiceStop(); silence(); chat.hide(); restUntil = Date.now() + 4000; petState(); }
function contextMenu() {
  Menu.buildFromTemplate([
    { label: '박주임과 대화하기', click: () => showChat() },
    { label: '산책하기', type: 'checkbox', checked: settings.roam, click: item => updateSettings({ roam: item.checked }) },
    { label: '항상 위에 표시', type: 'checkbox', checked: settings.alwaysOnTop, click: item => updateSettings({ alwaysOnTop: item.checked }) },
    { type: 'separator' }, { label: '설정', click: () => showChat('settings') },
    { label: '화면 오른쪽으로 돌아오기', click: resetPosition },
    { type: 'separator' },
    { label: updates?.get().status === 'downloaded' ? '업데이트 준비됨 · 설정에서 설치' : '업데이트 확인', click: () => { showChat('settings'); updates?.check(); } },
    { type: 'separator' }, { label: '종료', click: () => app.quit() }
  ]).popup();
}
function resetPosition() {
  const a = screen.getPrimaryDisplay().workArea, size = petSize(); target = null;
  pet.setBounds({ ...size, x: a.x + a.width - size.width - 28, y: a.y + a.height - size.height - 16 });
  placeChat();
}
async function updateSettings(input) {
  settings = await store.save(input);
  pet.setAlwaysOnTop(settings.alwaysOnTop, 'floating'); chat.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  pet.setSize(petSize().width, petSize().height); target = null;
  const bounds = pet.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
  pet.setPosition(...Object.values(clampPosition(bounds, area, bounds))); placeChat();
  app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe') });
  if (!settings.speak) silence();
  broadcast('settings:changed', settings); return settings;
}
function wander() {
  const now = Date.now(), dt = Math.min((now - lastTick) / 1000, 0.1); lastTick = now;
  if (!pet || pet.isDestroyed()) return;
  if (dragging) {
    const cursor = screen.getCursorScreenPoint(), size = pet.getBounds();
    const a = screen.getDisplayNearestPoint(cursor).workArea;
    const p = clampPosition({ x: cursor.x - dragging.x, y: cursor.y - dragging.y }, a, size);
    pet.setPosition(p.x, p.y); return;
  }
  if (!settings.roam || hovered || chat.isVisible() || now < restUntil) {
    if (moving) { moving = false; petState(); } return;
  }
  const b = pet.getBounds(), a = screen.getDisplayMatching(b).workArea;
  if (!target) {
    target = clampPosition({ x: a.x + Math.random() * (a.width - b.width), y: a.y + a.height * (0.45 + Math.random() * 0.55) }, a, b);
  }
  const dx = target.x - b.x, dy = target.y - b.y, distance = Math.hypot(dx, dy);
  if (distance < 3) { target = null; restUntil = now + 5000 + Math.random() * 10000; moving = false; petState(); return; }
  const nextDirection = dx < 0 ? -1 : 1;
  if (!moving || nextDirection !== direction) { moving = true; direction = nextDirection; petState(); }
  const step = Math.min(distance, settings.speed * dt);
  // Fractional movement is accumulated, so low speed also works at high refresh rates.
  target.fx = (target.fx ?? b.x) + dx / distance * step; target.fy = (target.fy ?? b.y) + dy / distance * step;
  const p = clampPosition({ x: target.fx, y: target.fy }, a, b); pet.setPosition(p.x, p.y);
}
function voiceStop() { if (voiceProcess) { voiceProcess.kill(); voiceProcess = null; } emit(chat, 'voice:event', { type: 'stopped' }); }
function silence() { if (speechProcess) { speechProcess.kill(); speechProcess = null; } petState({ speaking: false }); }
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
  handle('settings:get', null, () => settings);
  handle('settings:save', 'chat', input => updateSettings(input));
  handle('pet:chat', 'pet', () => chat.isVisible() ? hideChat() : showChat());
  handle('chat:hide', 'chat', hideChat);
  handle('pet:menu', 'pet', contextMenu);
  on('pet:hover', 'pet', value => { hovered = value === true; if (hovered) { target = null; moving = false; petState(); } });
  on('pet:hit', 'pet', value => { if (!dragging) pet.setIgnoreMouseEvents(value !== true, { forward: true }); });
  on('pet:drag', 'pet', phase => {
    if (phase === 'start') { const p = screen.getCursorScreenPoint(), b = pet.getBounds(); dragging = { x: p.x - b.x, y: p.y - b.y }; moving = false; target = null; pet.setIgnoreMouseEvents(false); petState(); }
    else { dragging = null; restUntil = Date.now() + 4000; if (chat.isVisible()) placeChat(); }
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
  handle('voice:silence', 'chat', silence);
  handle('voice:speak', 'chat', text => {
    silence(); if (!settings.speak || typeof text !== 'string' || !text.trim()) return;
    speechProcess = speechTask('speak', text.slice(0, 8000)); const proc = speechProcess;
    petState({ speaking: true });
    proc.on('error', () => { petState({ speaking: false }); emit(chat, 'voice:event', { type: 'error', message: '답변 읽기를 시작하지 못했어요.' }); });
    proc.stdout.setEncoding('utf8'); proc.stdout.on('data', chunk => { try { const event = JSON.parse(chunk.trim()); if (event.type === 'error') emit(chat, 'voice:event', event); } catch {} });
    proc.on('close', () => { if (speechProcess === proc) { speechProcess = null; petState({ speaking: false }); } });
  });
  handle('link:open', 'chat', name => { const url = { console: 'https://platform.claude.com/settings/keys', speech: 'ms-settings:speech', releases: 'https://github.com/kijung4290/parkjuim-desktop/releases/latest' }[name]; if (url) return shell.openExternal(url); });
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
    store = await createStore(app.getPath('userData'), safeStorage); settings = store.get();
    pet = secureWindow({ ...petSize(), transparent: true, skipTaskbar: true, hasShadow: false, title: '박주임 미니미' });
    chat = secureWindow({ width: 380, height: 490, transparent: true, hasShadow: false, skipTaskbar: true, title: '박주임과 대화' });
    pet.setAlwaysOnTop(settings.alwaysOnTop, 'floating'); chat.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
    pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    chat.on('close', event => { if (!isQuitting) { event.preventDefault(); hideChat(); } });
    pet.on('closed', () => { if (!isQuitting) app.quit(); });
    chat.on('hide', () => { emit(chat, 'view:open', 'hidden'); petState(); });
    const mode = smoke ? 'development' : getUpdateMode({ packaged:app.isPackaged, platform:process.platform, portable:!!process.env.PORTABLE_EXECUTABLE_FILE, executable:app.getPath('exe') });
    updates = createUpdateController({
      updater: mode === 'installed' ? require('electron-updater').autoUpdater : null,
      mode, version:app.getVersion(), notify:state=>broadcast('update:state',state),
      isBusy:()=>!!(activeRequest || voiceProcess || speechProcess)
    });
    registerIpc();
    await Promise.all([pet.loadURL('park://app/pet.html'), chat.loadURL('park://app/chat.html')]);
    resetPosition(); pet.showInactive();
    const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png'));
    tray = new Tray(icon); tray.setToolTip('박주임 미니미 · 클릭해서 대화하기'); tray.on('click', () => showChat()); tray.on('right-click', contextMenu);
    wanderTimer = setInterval(wander, 1000 / 30);
    updates.start();
    screen.on('display-metrics-changed', resetPosition); screen.on('display-removed', resetPosition);
    app.on('browser-window-blur', () => { if (dragging) { dragging = null; hovered = false; restUntil = Date.now() + 2000; } });
    if (process.argv.includes('--dev')) chat.webContents.openDevTools({ mode: 'detach' });
    if (smoke) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1200));
        // Exercise movement and pauses through the real native window and IPC.
        const start = pet.getBounds();
        hovered = false; restUntil = 0; target = { x: start.x - 100, y: start.y };
        await new Promise(resolve => setTimeout(resolve, 1100));
        const walked = pet.getBounds().x;
        if (walked >= start.x - 5) throw new Error('Roaming did not move the pet');
        await pet.webContents.executeJavaScript('window.park.hover(true)');
        await new Promise(resolve => setTimeout(resolve, 150));
        const stopped = pet.getBounds().x;
        await new Promise(resolve => setTimeout(resolve, 250));
        if (pet.getBounds().x !== stopped) throw new Error('Pet failed to pause on hover');
        await pet.webContents.executeJavaScript('window.park.hover(false)');
        resetPosition();
        showChat();
        const state = await pet.webContents.executeJavaScript('({ ready: document.body.dataset.ready, error: document.body.dataset.error, canvas: !!document.querySelector("canvas") })');
        if (state.ready !== 'true') throw new Error(`3D renderer failed: ${JSON.stringify(state)}`);
        const dir = smokeRoot; fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pet.png'), (await pet.webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(dir, 'chat.png'), (await chat.webContents.capturePage()).toPNG());
        const chatTest = await chat.webContents.executeJavaScript('window.__smokeTest()');
        const keyState = await chat.webContents.executeJavaScript('window.park.settings()');
        if (chatTest !== true || !keyState.model) throw new Error('Chat bridge check failed');
        const missingKey = await chat.webContents.executeJavaScript('window.park.send("smoke-no-key", [{role:"user",content:"test"}])');
        if (!missingKey.error?.includes('API 키')) throw new Error('Missing API key guard failed');
        const secureKey = 'sk-ant-smoke-test-key-123456789';
        const secured = await store.save({apiKey:secureKey});
        if (!secured.hasKey || secured.apiKey || fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'),'utf8').includes(secureKey)) throw new Error('OS key encryption failed');
        await store.save({clearKey:true});
        const paused = pet.getBounds().x;
        restUntil=0;
        await new Promise(resolve => setTimeout(resolve, 250));
        if (pet.getBounds().x !== paused) throw new Error('Pet failed to pause during chat');
        const capabilities = await new Promise((resolve,reject)=>{
          const proc=speechTask('probe'); let output='';
          const timeout=setTimeout(()=>{proc.kill();reject(new Error('Packaged speech helper timed out'));},20000);
          proc.stdout.setEncoding('utf8');proc.stdout.on('data',data=>{output+=data;});
          proc.on('error',error=>{clearTimeout(timeout);reject(error);});
          proc.on('close',code=>{clearTimeout(timeout);try{const parsed=JSON.parse(output.trim());if(code!==0||parsed.type!=='capabilities')throw new Error(output);resolve(parsed);}catch(error){reject(error);}});
        });
        const result={...state,chatTest,roaming:true,hoverPause:true,chatPause:true,encryptedKey:true,missingKeyGuard:true,speechHelper:true,capabilities,model:keyState.model,pet:pet.getBounds(),chat:chat.getBounds()};
        fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
        console.log('SMOKE PASS', JSON.stringify(result));
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    }
  }).catch(error => { console.error(error); app.exit(1); });
}
app.on('before-quit', () => { isQuitting = true; updates?.dispose(); clearInterval(wanderTimer); activeRequest?.controller.abort(); voiceStop(); silence(); });
app.on('window-all-closed', () => app.quit());
