import * as THREE from '/vendor/three.module.js';
import {GLTFLoader} from '/vendor/addons/loaders/GLTFLoader.js';
import {createCharacter} from './character.js';
import {sanitizeAppearance} from './appearance.mjs';
function disposeObject(root){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:object.material?[object.material]:[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
  for(const texture of textures){texture.source?.data?.close?.();texture.dispose();}for(const material of materials)material.dispose();for(const geometry of geometries)geometry.dispose();
}
export function createCompanion(scene,{onChange=()=>{},onError=()=>{}}={}){
  const builtin=createCharacter(scene),customRoot=new THREE.Group();scene.add(customRoot);customRoot.visible=false;
  let appearance=sanitizeAppearance(),state={},pointer={x:0,y:0},loaded=null,requestedId='',generation=0,controller,phase='builtin',error='',waveUntil=0,lastTime=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clear(){if(loaded){loaded.mixer.stopAllAction();loaded.mixer.uncacheRoot(loaded.scene);disposeObject(loaded.scene);customRoot.clear();loaded=null;}}
  async function load(id){
    controller?.abort();const token=++generation;controller=new AbortController();phase='loading';error='';clear();customRoot.visible=false;builtin.root.visible=true;
    let gltf;
    try{
      const response=await fetch(`park://app/models/${id}`,{signal:controller.signal});if(!response.ok)throw new Error('Model not found');
      const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(url.startsWith('blob:'))return url;throw new Error('External resources are not supported');});
      gltf=await new GLTFLoader(manager).parseAsync(await response.arrayBuffer(),'');
      if(token!==generation){disposeObject(gltf.scene);return;}
      const lights=[];gltf.scene.traverse(object=>{if(object.isLight||object.isCamera)lights.push(object);if(object.isMesh){object.castShadow=true;object.receiveShadow=true;object.frustumCulled=false;}});lights.forEach(object=>object.removeFromParent());
      const box=new THREE.Box3().setFromObject(gltf.scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      if(box.isEmpty()||!Number.isFinite(size.length())||size.y<.000001)throw new Error('Empty model');
      const scale=Math.min(3.1/size.y,1.75/Math.max(.001,size.x),1.4/Math.max(.001,size.z));
      gltf.scene.scale.setScalar(scale);gltf.scene.position.set(-center.x*scale,.15-box.min.y*scale,-center.z*scale);
      const orientation=new THREE.Group();orientation.rotation.y=appearance.modelRotation*Math.PI/180;orientation.add(gltf.scene);customRoot.add(orientation);
      loaded={scene:gltf.scene,orientation,mixer:new THREE.AnimationMixer(gltf.scene),clips:gltf.animations,current:null,bounds:{height:size.y*scale,width:Math.max(size.x,size.z)*scale*1.4,centerY:.15+size.y*scale/2}};
      phase='ready';customRoot.visible=true;builtin.root.visible=false;onChange();
    }catch(reason){if(token!==generation)return;if(gltf)disposeObject(gltf.scene);clear();phase='error';error='이 GLB를 불러오지 못했어요. 메시·PNG/JPG 텍스처를 포함하고 압축을 끈 GLB로 다시 내보내 주세요.';onError(error);onChange();}
  }
  function setAppearance(input){
    appearance=sanitizeAppearance(input,appearance);builtin.setAppearance({...appearance,characterType:appearance.characterType==='custom'?'human':appearance.characterType});
    if(appearance.characterType!=='custom'||!appearance.customModelId){generation++;controller?.abort();requestedId='';clear();phase='builtin';customRoot.visible=false;builtin.root.visible=true;return;}
    if(appearance.customModelId!==requestedId){requestedId=appearance.customModelId;load(requestedId);}else if(loaded)loaded.orientation.rotation.y=appearance.modelRotation*Math.PI/180;
  }
  function play(clip,once=false){
    if(!clip){if(loaded.current)loaded.current.paused=true;return;}
    if(loaded.current?.getClip()===clip){loaded.current.paused=false;return;}
    const next=loaded.mixer.clipAction(clip);next.reset().setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);next.clampWhenFinished=once;next.play();loaded.current?.fadeOut(.2);next.fadeIn(.2);loaded.current=next;
  }
  return {
    get root(){return phase==='ready'?customRoot:builtin.root;},
    setAppearance,
    setState(input){if(input.chatting&&!state.chatting)waveUntil=lastTime+2;state={...state,...input};builtin.setState(input);},
    look(x,y){pointer={x,y};builtin.look(x,y);},
    wave(){waveUntil=lastTime+2;builtin.wave();},
    inspectAppearance:()=>({...appearance,customReady:phase==='ready',customPhase:phase,customError:error,animations:loaded?.clips.map(clip=>clip.name)||[]}),
    portraitBounds:()=>phase==='ready'?loaded.bounds:null,
    update(t,dt){
      lastTime=t;
      if(phase!=='ready'){builtin.update(t,dt);return;}
      const clips=loaded.clips,find=pattern=>clips.find(clip=>pattern.test(clip.name));
      const wave=t<waveUntil?find(/wave|greet|hello|인사/i):null;
      const idle=find(/idle|breath|stand|rest|대기/i),walk=find(/walk|run|걷|산책/i),fallback=clips.find(clip=>! /walk|run|talk|speak|chat|wave|greet|hello|걷|말|인사/i.test(clip.name));
      const clip=wave||(state.speaking&&find(/talk|speak|chat|말/i))||(state.moving?walk||idle||fallback:idle||fallback);
      play(clip,!!wave);loaded.mixer.update(dt);
      customRoot.rotation.y=THREE.MathUtils.lerp(customRoot.rotation.y,state.moving?state.direction*1.1:pointer.x*.08,1-Math.exp(-dt*7));
      customRoot.rotation.z=reduced?0:Math.sin(t*2)*.006;customRoot.position.y=0;
    }
  };
}
