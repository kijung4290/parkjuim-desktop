const fs=require('node:fs');
const executable=require('electron');
if(!fs.existsSync(executable))throw new Error('Electron 실행 파일을 준비하지 못했습니다.');
console.log('Local Electron distribution ready.');
