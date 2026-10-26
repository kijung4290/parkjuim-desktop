// Small original application icon, drawn locally without any external assets.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const directory=path.join(__dirname,'../assets');fs.mkdirSync(directory,{recursive:true});
const size=256,pixels=Buffer.alloc(size*size*4);
function oval(cx,cy,rx,ry,color){for(let y=Math.max(0,Math.floor(cy-ry));y<Math.min(size,cy+ry);y++)for(let x=Math.max(0,Math.floor(cx-rx));x<Math.min(size,cx+rx);x++){const r=((x-cx)/rx)**2+((y-cy)/ry)**2;if(r<=1){const n=(y*size+x)*4;for(let k=0;k<3;k++)pixels[n+k]=color[k];pixels[n+3]=255;}}}
oval(128,128,124,124,[235,239,222]);oval(128,221,80,69,[111,120,77]);oval(128,191,33,28,[98,108,66]);oval(128,123,67,76,[242,190,153]);oval(61,130,12,20,[242,190,153]);oval(195,130,12,20,[242,190,153]);oval(128,79,69,43,[43,47,39]);
for(const [x,y,rx,ry]of[[72,89,20,30],[94,67,27,26],[129,62,29,27],[163,69,28,27],[184,91,19,30],[105,92,18,24],[142,92,19,24]])oval(x,y,rx,ry,[43,47,39]);
oval(105,130,5,8,[39,45,35]);oval(151,130,5,8,[39,45,35]);oval(88,151,12,6,[228,148,132]);oval(169,151,12,6,[228,148,132]);
for(let x=109;x<=148;x++){const y=166-Math.pow((x-128)/19,2)*5;oval(x,y,2,2,[80,68,52]);}
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const rows=[];for(let y=0;y<size;y++)rows.push(Buffer.from([0]),pixels.subarray(y*size*4,(y+1)*size*4));
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(path.join(directory,'tray.png'),png);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=0;ico[7]=0;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);fs.writeFileSync(path.join(directory,'icon.ico'),Buffer.concat([ico,png]));
console.log('Application icons generated.');
