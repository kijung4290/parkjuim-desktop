const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStartupController } = require('../electron/startup.cjs');

test('startup registers the stable installed EXE and removes registration when disabled', () => {
  let state = { openAtLogin:false, executableWillLaunchAtLogin:false };
  const calls = [];
  const app = {
    getPath: () => 'C:\\Users\\Owner\\AppData\\Local\\Programs\\parkjuim-desktop\\박주임 미니미.exe',
    getLoginItemSettings: options => { assert.deepEqual(options.args, []); return state; },
    setLoginItemSettings: options => { calls.push(options); state = { openAtLogin:options.openAtLogin, executableWillLaunchAtLogin:options.enabled }; }
  };
  const startup = createStartupController({app, mode:'installed'});
  assert.equal(startup.get().startAtLogin, false);
  assert.equal(startup.set(true).startAtLogin, true);
  assert.equal(calls[0].path, app.getPath());
  assert.equal(calls[0].name, 'kr.parkjuim.desktop');
  assert.deepEqual(calls[0].args, []);
  // Task Manager changes must be reflected without rewriting Windows settings.
  state.executableWillLaunchAtLogin = false;
  assert.equal(startup.get().startAtLogin, false);
  assert.equal(startup.get().startAtLoginBlocked, true);
  assert.equal(calls.length, 1);
  assert.equal(startup.set(true).startAtLogin, true);
  assert.equal(startup.set(false).startAtLogin, false);
  assert.equal(calls.at(-1).openAtLogin, false);
});

test('development, smoke and portable execution cannot register Electron or temporary paths', () => {
  const app = { getPath:()=> 'electron.exe', getLoginItemSettings:()=>assert.fail('OS read'), setLoginItemSettings:()=>assert.fail('OS write') };
  for (const mode of ['development','portable','unpacked','unsupported']) {
    const startup=createStartupController({app,mode});
    assert.equal(startup.get().startAtLoginSupported,false);
    assert.equal(startup.set(false).startAtLogin,false);
    assert.throws(()=>startup.set(true),/설치형/);
  }
});

test('failed Windows startup registration is reported instead of claiming success', () => {
  const app={getPath:()=> 'pet.exe',getLoginItemSettings:()=>({openAtLogin:false,executableWillLaunchAtLogin:false}),setLoginItemSettings:()=>{}};
  assert.throws(()=>createStartupController({app,mode:'installed'}).set(true),/적용하지 못/);
});
