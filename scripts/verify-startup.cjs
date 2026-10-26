// Verify the actual Electron/Windows API using a separate, temporary Run entry.
// The normal installed app's entry and user preferences are never modified.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createStartupController } = require('../electron/startup.cjs');
const name = 'kr.parkjuim.desktop.startup-verification';
app.setAppUserModelId(name);
app.whenReady().then(() => {
  const startup = createStartupController({ app, mode:'installed', name, args:[__filename] });
  let code = 0;
  try {
    if (!startup.set(true).startAtLogin) throw new Error('Registration failed');
    if (startup.set(false).startAtLogin) throw new Error('Removal failed');
    const directory = path.resolve(__dirname,'../.preview');
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'startup-check.json'),JSON.stringify({registered:true,removed:true,normalAppEntryUntouched:true},null,2));
    console.log('WINDOWS STARTUP PASS: temporary entry enabled and removed');
  } catch (error) { console.error(error); code = 1; }
  finally {
    try { startup.set(false); } catch (error) { console.error('Temporary startup cleanup failed:',error); code = 1; }
    app.exit(code);
  }
}).catch(error => { console.error(error); app.exit(1); });
