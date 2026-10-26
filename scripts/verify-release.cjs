const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const crypto=require('node:crypto');const yaml=require('js-yaml');
async function main(){
 const asar=await import('@electron/asar');
 const root=path.resolve(__dirname,'..'),release=path.join(root,'release');
 const latest=JSON.parse(fs.readFileSync(path.join(release,'latest-build.json'),'utf8'));
 const archive=path.join(release,latest.directory,'win-unpacked/resources/app.asar');
 for(const directory of ['electron','renderer'])for(const name of fs.readdirSync(path.join(root,directory))){
  if(!/\.(cjs|mjs|js|html|css|ps1|png)$/.test(name))continue;
  const file=`${directory}/${name}`;
  assert.ok(asar.extractFile(archive,file).equals(fs.readFileSync(path.join(root,file))),`Packaged file differs from source: ${file}`);
 }
 for(const name of [`Parkjuim-Setup-${latest.version}.exe`,`Parkjuim-Portable-${latest.version}.exe`]){
  const file=path.join(release,name);const descriptor=fs.openSync(file,'r');const magic=Buffer.alloc(2);fs.readSync(descriptor,magic,0,2,0);fs.closeSync(descriptor);
  assert.equal(magic.toString(),'MZ');assert.ok(fs.statSync(file).size>10000000);
 }
 const feed=yaml.load(fs.readFileSync(path.join(release,'latest.yml'),'utf8'));
 assert.equal(feed.version,latest.version);
 const setup=`Parkjuim-Setup-${latest.version}.exe`;
 const info=feed.files.find(item=>decodeURIComponent(item.url)===setup);
 assert.ok(info,'Update manifest must reference the setup EXE');
 const hash=crypto.createHash('sha512');for await(const chunk of fs.createReadStream(path.join(release,setup)))hash.update(chunk);
 assert.equal(hash.digest('base64'),info.sha512,'Update manifest checksum must match the released installer');
 const config=yaml.load(fs.readFileSync(path.join(release,latest.directory,'win-unpacked/resources/app-update.yml'),'utf8'));
 assert.equal(config.provider,'github');assert.equal(config.owner,'kijung4290');assert.equal(config.repo,'parkjuim-desktop');assert.ok(!config.token);
 console.log('UPDATE FEED PASS: installer SHA-512 and GitHub feed configuration verified.');
 console.log('RELEASE PASS: final packaged source matches all Electron and renderer files; setup and portable EXEs are valid.');
 console.log(`Packaged executable: ${path.join(release,latest.directory,'win-unpacked','박주임 미니미.exe')}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
