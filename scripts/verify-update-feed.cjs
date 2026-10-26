// Opt-in network check: use the real updater against the published feed with a
// synthetic older version. It verifies downloads but never installs or quits.
const fs=require('node:fs');const path=require('node:path');
const {NsisUpdater}=require('electron-updater');
async function main(){
 const directory=path.resolve(__dirname,'../.preview/update-feed-check');fs.mkdirSync(directory,{recursive:true});
 const config=path.join(directory,'app-update.yml');fs.writeFileSync(config,'provider: github\nowner: kijung4290\nrepo: parkjuim-desktop\nupdaterCacheDirName: parkjuim-feed-test\n');
 const adapter={version:'1.0.0',name:'parkjuim-feed-test',isPackaged:true,appUpdateConfigPath:config,userDataPath:directory,baseCachePath:directory,whenReady:async()=>{},onQuit:()=>{},quit:()=>{throw new Error('Feed check must not quit or install');},relaunch:()=>{throw new Error('Feed check must not relaunch');}};
 const updater=new NsisUpdater(null,adapter);
 updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.disableWebInstaller=true;updater.disableDifferentialDownload=true;
 updater.on('error',error=>console.error('Updater error:',error.message));
 const result=await updater.checkForUpdates();
 if(!result?.isUpdateAvailable)throw new Error('Published newer version was not detected');
 console.log(`LIVE FEED PASS: ${adapter.version} -> ${result.updateInfo.version}`);
 if(process.argv.includes('--download')){
  const paths=await updater.downloadUpdate();
  if(!paths.length||!paths.every(file=>fs.statSync(file).size>10000000))throw new Error('Installer download was incomplete');
  console.log('LIVE DOWNLOAD PASS: actual installer downloaded and SHA-512 validated. No install performed.');
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
