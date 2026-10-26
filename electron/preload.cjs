const { contextBridge, ipcRenderer } = require('electron');
const on = (channel, callback) => { const listener = (_event, data) => callback(data); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); };
contextBridge.exposeInMainWorld('park', Object.freeze({
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: input => ipcRenderer.invoke('settings:save', input),
  send: (id, messages) => ipcRenderer.invoke('chat:send', id, messages),
  cancel: () => ipcRenderer.invoke('chat:cancel'),
  toggleChat: () => ipcRenderer.invoke('pet:chat'),
  closeChat: () => ipcRenderer.invoke('chat:hide'),
  menu: () => ipcRenderer.invoke('pet:menu'),
  hover: value => ipcRenderer.send('pet:hover', value),
  drag: phase => ipcRenderer.send('pet:drag', phase),
  hit: value => ipcRenderer.send('pet:hit', value),
  voiceStart: () => ipcRenderer.invoke('voice:start'),
  voiceStop: () => ipcRenderer.invoke('voice:stop'),
  dictate: () => ipcRenderer.invoke('voice:dictate'),
  speak: text => ipcRenderer.invoke('voice:speak', text),
  stopSpeaking: () => ipcRenderer.invoke('voice:silence'),
  openLink: name => ipcRenderer.invoke('link:open', name),
  updateState: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: callback => on('update:state', callback),
  onPetState: callback => on('pet:state', callback),
  onSettings: callback => on('settings:changed', callback),
  onChat: callback => on('chat:event', callback),
  onVoice: callback => on('voice:event', callback),
  onView: callback => on('view:open', callback)
}));
