import * as THREE from '/vendor/three.module.js';
import { createCharacter } from './character.js';
const bridge = window.park;
const canvas=document.querySelector('#character'), fallback=document.querySelector('#fallback');
let hit=false, drag=null, suppressClick=false, character, renderer, scene, camera, last=0;
let state={moving:false,direction:1,chatting:false,thinking:false,speaking:false};
const pointer=new THREE.Vector2();
function setHit(value) { hit=value;document.body.classList.toggle('hover',value);canvas.style.cursor=value?'grab':'default'; }
function updateState(input) { state={...state,...input};character?.setState(state);if(typeof input.hovered==='boolean')setHit(input.hovered);if(input.cursor)character?.look(input.cursor.x,input.cursor.y);if(Number.isFinite(input.offsetX))canvas.style.transform=`translate3d(${input.offsetX}px,${input.offsetY}px,0)`;document.body.classList.toggle('chatting',state.chatting);document.body.classList.toggle('thinking',state.thinking);document.querySelector('#thinking').hidden=!state.thinking; }
function boot() {
  renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setClearColor(0x000000,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(32,1,.1,30);camera.position.set(0,2.5,7.3);camera.lookAt(0,1.65,0);
  scene.add(new THREE.HemisphereLight('#fff8ed','#889b79',2.3));
  const key=new THREE.DirectionalLight('#fff2d9',4.2);key.position.set(-3,6,5);key.castShadow=true;key.shadow.mapSize.set(512,512);key.shadow.camera.left=-2;key.shadow.camera.right=2;key.shadow.camera.top=4;key.shadow.camera.bottom=-1;key.shadow.normalBias=.025;key.shadow.bias=-.0003;scene.add(key);
  const rim=new THREE.DirectionalLight('#e5e7ff',2.8);rim.position.set(3,4,-3);scene.add(rim);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.ShadowMaterial({opacity:.16}));ground.rotation.x=-Math.PI/2;ground.position.y=.13;ground.receiveShadow=true;scene.add(ground);
  character=createCharacter(scene);
  const resize=()=>{const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};resize();addEventListener('resize',resize);
  function frame(t){if(t-last<15)return;const dt=Math.min((t-last)/1000,.05);last=t;character.update(t/1000,dt);renderer.render(scene,camera);}
  renderer.setAnimationLoop(frame);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fallback.hidden=false;canvas.hidden=true;document.body.dataset.error='WebGL context lost';});
  document.body.dataset.ready='true';
}
try {boot();}catch(error){fallback.hidden=false;canvas.hidden=true;document.body.dataset.error=error.message;document.body.dataset.ready='fallback';console.error(error);}
document.addEventListener('mousemove',event=>{
  pointer.set(event.clientX/innerWidth*2-1,-(event.clientY/innerHeight)*2+1);character?.look(pointer.x,-pointer.y);
  bridge?.pointerMoved();
  if(drag){if(Math.hypot(event.screenX-drag.x,event.screenY-drag.y)>5&&!drag.started){drag.started=true;bridge?.drag('start');canvas.style.cursor='grabbing';}return;}
});
document.addEventListener('pointerdown',event=>{if(event.button!==0)return;suppressClick=false;drag={x:event.screenX,y:event.screenY,started:false};bridge?.drag('press');event.target.setPointerCapture?.(event.pointerId);});
document.addEventListener('pointerup',()=>{if(!drag)return;suppressClick=drag.started;drag=null;bridge?.drag('end');canvas.style.cursor='grab';});
document.addEventListener('click',event=>{if(event.button!==0||suppressClick){suppressClick=false;return;}character?.wave();if(bridge)bridge.toggleChat();else location.href='chat.html';});
document.addEventListener('pointercancel',()=>{suppressClick=true;drag=null;bridge?.drag('end');});
addEventListener('blur',()=>{if(drag){drag=null;bridge?.drag('end');}});
document.addEventListener('contextmenu',event=>{event.preventDefault();bridge?.menu();});
canvas.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();bridge?.toggleChat();}});
bridge?.onPetState(updateState);
window.__petTestState=()=>({moving:state.moving,distance:state.walkDistance,yaw:character?.root.rotation.y,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches});
// Preview mode uses the same real character and can display walk/talk states.
if(!bridge){document.body.classList.add('preview');setHit(true);const mode=new URLSearchParams(location.search).get('state');if(mode==='walk')updateState({moving:true,direction:-1,previewWalk:true});if(mode==='talk')updateState({speaking:true});}
