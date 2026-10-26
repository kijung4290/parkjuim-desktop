const fs=require('node:fs/promises');
const path=require('node:path');
const{build,Platform,Arch}=require('electron-builder');
// Windows can hold extracted ASAR files open. A fresh staging directory makes
// repeat builds reliable while the user-facing EXE paths remain stable.
async function main(){
  const root=path.resolve(__dirname,'..');
  const release=path.join(root,'release');
  const staging=path.join(release,`build-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  await fs.mkdir(release,{recursive:true});
  const artifacts=await build({projectDir:root,publish:'never',targets:Platform.WINDOWS.createTarget(['nsis','portable'],Arch.x64),config:{directories:{output:staging},compression:process.argv.includes('--fast')?'store':'normal'}});
  for(const artifact of artifacts){if(/\.exe(?:\.blockmap)?$/.test(artifact)){const output=path.join(release,path.basename(artifact));await fs.copyFile(artifact,output);console.log(`Release artifact: ${output}`);}}
  // The feed and installer must come from this exact build: the manifest holds
  // the installer's SHA-512 hash. Never generate a manifest from a different EXE.
  await fs.copyFile(path.join(staging,'latest.yml'),path.join(release,'latest.yml'));
  await fs.writeFile(path.join(release,'latest-build.json'),JSON.stringify({directory:path.relative(release,staging),version:require('../package.json').version},null,2));
  console.log('Windows setup and portable builds complete.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
