// Opt-in network check: use the real updater against the published feed with a
// synthetic older version. It verifies downloads but never installs or quits.
const fs=require('node:fs');const path=require('node:path');
const {app}=require('electron');
if(!app)throw new Error('Run through Electron: npm run verify:feed -- --download');
const directory=path.resolve(__dirname,'../.preview/update-feed-check');fs.mkdirSync(directory,{recursive:true});
app.setPath('userData',directory);
async function main(){
 const config=path.join(directory,'app-update.yml');fs.writeFileSync(config,'provider: github\nowner: kijung4290\nrepo: parkjuim-desktop\nupdaterCacheDirName: parkjuim-feed-test\n');
 const {NsisUpdater}=require('electron-updater');
 const updater=new NsisUpdater();
 // Only the test's version is synthetic; HTTP, manifests and SHA-512 validation
 // all use the production updater and Electron networking implementation.
 updater.currentVersion=new updater.currentVersion.constructor('1.0.0');
 updater.updateConfigPath=config;updater.forceDevUpdateConfig=true;
 updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.disableWebInstaller=true;updater.disableDifferentialDownload=true;
 updater.on('error',error=>console.error('Updater error:',error.message));
 const result=await updater.checkForUpdates();
 if(!result?.isUpdateAvailable)throw new Error('Published newer version was not detected');
 console.log(`LIVE FEED PASS: 1.0.0 -> ${result.updateInfo.version}`);
 if(process.argv.includes('--download')){
  const paths=await updater.downloadUpdate();
  if(!paths.length||!paths.every(file=>fs.statSync(file).size>10000000))throw new Error('Installer download was incomplete');
  console.log('LIVE DOWNLOAD PASS: actual installer downloaded and SHA-512 validated. No install performed.');
 }
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({version:result.updateInfo.version,feed:true,download:process.argv.includes('--download'),installed:false},null,2));
}
app.whenReady().then(main).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
