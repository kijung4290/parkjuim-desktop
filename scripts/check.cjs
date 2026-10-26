const fs=require('node:fs');const path=require('node:path');const{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');let failures=0;
for(const folder of ['electron','renderer','scripts','tests'])for(const name of fs.readdirSync(path.join(root,folder))){if(!/\.(cjs|js)$/.test(name))continue;const file=path.join(root,folder,name);const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){console.error(result.stderr);failures++;}}
for(const file of ['assets/icon.ico','assets/tray.png','renderer/reference.png','renderer/pet.html','renderer/chat.html'])if(!fs.existsSync(path.join(root,file))){console.error('Missing:',file);failures++;}
if(failures)process.exit(1);console.log('Syntax and required assets: PASS');
