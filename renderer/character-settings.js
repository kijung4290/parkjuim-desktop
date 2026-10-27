import * as THREE from '/vendor/three.module.js';
import {createCompanion} from './companion.js';
import {APPEARANCE_DEFAULTS,CHARACTER_PRESETS,sanitizeAppearance} from './appearance.mjs';
const $=selector=>document.querySelector(selector);
const controls={characterName:'character-name',characterType:'character-type',hairStyle:'character-hair',skinColor:'character-skin',hairColor:'character-fur',outfitColor:'character-outfit',pantsColor:'character-pants',glasses:'character-glasses',customModelId:'custom-character',modelRotation:'character-rotation'};
export function createCharacterSettings(bridge){
  let saved={...APPEARANCE_DEFAULTS},draft={...saved},renderer,character,scene,camera,visible=false,last=0,failed=false;
  let models=[],modelBusy=false,deleteArmed=false;
  function read(){const values={};for(const [field,id]of Object.entries(controls))values[field]=field==='glasses'?$('#'+id).checked:field==='modelRotation'?Number($('#'+id).value):$('#'+id).value;return values;}
  function animate(t){if(t-last<33)return;const dt=Math.min((t-last)/1000,.05);last=t;character.update(t/1000,dt);const bounds=character.portraitBounds();if(bounds){camera.position.set(0,bounds.centerY+.2,Math.max(bounds.height,bounds.width)*2.1);camera.lookAt(0,bounds.centerY,0);}else{camera.position.set(0,2.55,7);camera.lookAt(0,1.75,0);}renderer.render(scene,camera);}
  function modelFeedback(message){const state=character?.inspectAppearance();const model=models.find(item=>item.id===draft.customModelId);$('#character-model-feedback').textContent=message||(draft.characterType!=='custom'?'GLB 파일은 이 PC에 복사해 보관해요. 최대 20MB, 텍스처 포함·압축 해제 상태로 선택해 주세요.':!draft.customModelId?'내 GLB 캐릭터 추가를 눌러 파일을 선택해 주세요.':state?.customPhase==='error'?state.customError:state?.customReady?`${model?.name||'내 캐릭터'} · 실제 3D 모델${model?.animations.length?' · 동작: '+model.animations.slice(0,4).join(', '):' · 동작 클립 없음, 위치 이동과 시선 회전을 사용해요.'}`:'3D 모델을 불러오고 있어요…');}
  function listModels(){const select=$('#custom-character');select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='추가한 GLB를 선택해 주세요';select.append(empty);for(const item of models){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;select.append(option);}if(draft.customModelId&&!models.some(item=>item.id===draft.customModelId)){const option=document.createElement('option');option.value=draft.customModelId;option.textContent='저장된 캐릭터';select.append(option);}select.value=draft.customModelId;}
  async function refreshModels(){if(!bridge)return;const result=await bridge.customModels();if(result?.error)throw new Error(result.error);models=result.items;listModels();show();}
  async function modelTask(action){if(modelBusy)return;modelBusy=true;$('#character-import').disabled=true;$('#character-delete').disabled=true;try{await action();}catch(error){modelFeedback(error.message);}finally{modelBusy=false;$('#character-import').disabled=false;$('#character-delete').disabled=false;}}
  function boot(){
    if(renderer||failed)return;
    try{
      renderer=new THREE.WebGLRenderer({canvas:$('#character-preview'),alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(240,220,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
      scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(32,240/220,.1,30);camera.position.set(0,2.55,7.0);camera.lookAt(0,1.75,0);
      scene.add(new THREE.HemisphereLight('#fff8ed','#889b79',2.3));const key=new THREE.DirectionalLight('#fff2d9',4.2);key.position.set(-3,6,5);scene.add(key);const rim=new THREE.DirectionalLight('#e5e7ff',2.8);rim.position.set(3,4,-3);scene.add(rim);
      character=createCompanion(scene,{onChange:()=>modelFeedback(),onError:message=>modelFeedback(message)});character.setAppearance(draft);$('#character-preview-fallback').hidden=true;
    }catch{failed=true;$('#character-preview').hidden=true;$('#character-preview-fallback').hidden=false;}
  }
  function show(){
    const human=draft.characterType==='human',custom=draft.characterType==='custom';$('#character-hair').disabled=!human;$('#character-skin').disabled=!human;$('#character-color-label').textContent=human?'머리 색':'털 색';
    for(const id of ['character-fur','character-outfit','character-pants','character-glasses'])$('#'+id).disabled=custom;
    $('#custom-character-field').hidden=!custom;$('#character-rotation-field').hidden=!custom;$('#character-delete').hidden=!custom||!draft.customModelId;$('#character-delete').textContent=deleteArmed?'삭제 확인':'보관함에서 삭제';$('#character-rotation-value').textContent=`${draft.modelRotation}°`;
    character?.setAppearance(draft);$('#character-preview-name').textContent=draft.characterName;
    modelFeedback();
  }
  function fill(){listModels();for(const [field,id]of Object.entries(controls)){if(field==='glasses')$('#'+id).checked=draft[field];else $('#'+id).value=draft[field];}show();}
  for(const [field,id]of Object.entries(controls))$('#'+id).addEventListener('input',()=>{
    deleteArmed=false;
    const value=read();
    if(field==='characterType'){
      const preset=CHARACTER_PRESETS[value.characterType];if(preset){draft={...draft,...preset,characterName:draft.characterName,hairStyle:draft.hairStyle,glasses:value.glasses};fill();}
      else if(value.characterType==='custom'){draft={...draft,characterType:'custom',customModelId:value.customModelId||models.at(-1)?.id||''};fill();}
    }else{
      try{draft=sanitizeAppearance(value,draft);show();}catch{ /* Validate names on save, while color preview remains responsive. */ }
    }
  });
  $('#character-reset').addEventListener('click',()=>{draft={...APPEARANCE_DEFAULTS};fill();});
  $('#character-import').addEventListener('click',()=>modelTask(async()=>{if(!bridge)throw new Error('GLB 파일 추가는 실제 앱에서 사용할 수 있어요.');const result=await bridge.importModel();if(result?.error)throw new Error(result.error);if(result.canceled)return;await refreshModels();draft={...draft,characterType:'custom',customModelId:result.model.id,modelRotation:0};deleteArmed=false;fill();}));
  $('#character-delete').addEventListener('click',()=>{if(!deleteArmed){deleteArmed=true;show();return;}modelTask(async()=>{const name=draft.characterName,result=await bridge.deleteModel(draft.customModelId);if(result?.error)throw new Error(result.error);deleteArmed=false;draft={...saved,characterName:name,characterType:'human',customModelId:''};await refreshModels();fill();});});
  function setVisible(value){visible=value;if(visible)boot();renderer?.setAnimationLoop(visible&&!document.hidden?animate:null);}
  document.addEventListener('visibilitychange',()=>renderer?.setAnimationLoop(visible&&!document.hidden?animate:null));
  function sync(next){
    saved=sanitizeAppearance(next,saved);const name=saved.characterName;
    $('#character-label').textContent=name;$('#character-label').title=name;document.title=`${name}와 대화`;
    $('#message').placeholder=`${name}, 있잖아요…`;$('#message').setAttribute('aria-label',`${name}에게 할 말`);$('#messages').setAttribute('aria-label',`${name}와 나눈 대화`);
    document.querySelectorAll('.message.assistant .speaker').forEach(label=>label.textContent=name);
    document.querySelectorAll('.identity img,.welcome-illustration img').forEach(img=>{img.alt=`${name} 캐릭터`;});
    if(next.portraitDataUrl)portrait(next.portraitDataUrl);
  }
  function portrait(data){if(typeof data==='string'&&data.startsWith('data:image/png;base64,'))document.querySelectorAll('.identity img,.welcome-illustration img').forEach(img=>{img.src=data;img.classList.add('custom-portrait');});}
  return {sync,portrait,open(){draft={...saved};deleteArmed=false;fill();setVisible(true);character?.setAppearance(draft);refreshModels().catch(error=>modelFeedback(error.message));},close:()=>setVisible(false),input:()=>{const result=sanitizeAppearance(read(),saved);if(result.characterType==='custom'&&(!result.customModelId||!character?.inspectAppearance().customReady))throw new Error('추가할 GLB를 선택하고 미리보기가 완료된 뒤 저장해 주세요.');return result;},inspect:()=>({visible,ready:!!character,appearance:character?.inspectAppearance()})};
}
