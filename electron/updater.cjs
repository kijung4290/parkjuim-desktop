const fs = require('node:fs');
const path = require('node:path');

function getUpdateMode({ packaged, platform, portable, executable, exists = fs.existsSync }) {
  if (!packaged) return 'development';
  if (platform !== 'win32') return 'unsupported';
  if (portable) return 'portable';
  return exists(path.join(path.dirname(executable), 'Uninstall 박주임 미니미.exe')) ? 'installed' : 'unpacked';
}

function createUpdateController({ updater, mode, version, notify = () => {}, isBusy = () => false, onInstall = () => {}, timers = globalThis }) {
  let state = { status: mode === 'installed' ? 'idle' : 'disabled', mode, version, nextVersion: '', percent: 0, checkedAt: null };
  let checking = null, startupTimer, interval;
  const listeners = [];
  const set = input => { state = { ...state, ...input }; notify({ ...state }); };
  const listen = (event, fn) => { updater.on(event, fn); listeners.push([event, fn]); };
  if (mode === 'installed') {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    listen('checking-for-update', () => set({ status: 'checking' }));
    listen('update-available', info => set({ status: 'downloading', nextVersion: String(info.version).slice(0, 80), percent: 0 }));
    listen('download-progress', info => set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(info.percent || 0))) }));
    listen('update-not-available', () => set({ status: 'current', checkedAt: new Date().toISOString(), nextVersion: '', percent: 0 }));
    listen('update-downloaded', info => set({ status: 'downloaded', nextVersion: String(info.version).slice(0, 80), percent: 100, checkedAt: new Date().toISOString() }));
    listen('error', () => set({ status: 'error', percent: 0, message: '업데이트를 확인하거나 내려받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.' }));
  }
  const controller = {
    get: () => ({ ...state }),
    check() {
      if (mode !== 'installed' || ['downloaded', 'downloading', 'installing'].includes(state.status)) return Promise.resolve(this.get());
      if (checking) return checking;
      set({ status: 'checking', message: '' });
      checking = Promise.resolve().then(() => updater.checkForUpdates()).catch(() => {
        set({ status: 'error', percent: 0, message: '업데이트를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.' });
      }).finally(() => { checking = null; });
      return checking.then(() => this.get());
    },
    install() {
      if (mode !== 'installed' || state.status !== 'downloaded') throw new Error('설치할 업데이트가 아직 준비되지 않았어요.');
      if (isBusy()) throw new Error('대화나 음성 재생을 마친 뒤 업데이트해 주세요.');
      onInstall();
      set({ status: 'installing' });
      try { updater.quitAndInstall(true, true); } catch (error) { set({ status: 'downloaded' }); throw error; }
      return { ok: true };
    },
    start() {
      if (mode !== 'installed' || startupTimer || interval) return;
      startupTimer = timers.setTimeout(() => { startupTimer = null; this.check(); }, 15000);
      interval = timers.setInterval(() => this.check(), 4 * 60 * 60 * 1000);
      startupTimer?.unref?.(); interval?.unref?.();
    },
    dispose() {
      if (startupTimer) timers.clearTimeout(startupTimer);
      if (interval) timers.clearInterval(interval);
      for (const [event, fn] of listeners) updater.removeListener(event, fn);
    }
  };
  return controller;
}
module.exports = { createUpdateController, getUpdateMode };
