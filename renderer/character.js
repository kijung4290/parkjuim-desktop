import * as THREE from '/vendor/three.module.js';
import { legPose, STRIDE_PIXELS } from './gait.mjs';
import {sanitizeAppearance} from './appearance.mjs';

// A real mesh character: soft clay materials, dimensional curls, independent joints.
export function createCharacter(scene,initialAppearance={}) {
  const root = new THREE.Group(); scene.add(root);
  const material = (color, roughness = .8) => new THREE.MeshStandardMaterial({ color, roughness });
  const skin = material('#f2bf9d', .7), hair = material('#292b27', .78), sweater = material('#74764c'), collar = material('#686b43'), trousers = material('#41473e'), shoes = material('#e9e5d9'), sole = material('#c7c4b6'), ink = material('#272b24', .5), blush = material('#e99989'), white = material('#fffaf0');
  const sphereGeometry = new THREE.SphereGeometry(1, 28, 20);
  function oval(parent, mat, position, scale) { const mesh = new THREE.Mesh(sphereGeometry, mat); mesh.position.set(...position); mesh.scale.set(...scale); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; }
  function tube(parent, points, radius, mat) { const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))); const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, radius, 7, false), mat); mesh.castShadow = true; parent.add(mesh); return mesh; }
  const torso = new THREE.Group(); torso.position.y = 1.23; root.add(torso);
  oval(torso, sweater, [0, .1, 0], [.49, .62, .29]);
  // Ribbed hem and cuffs make the turtleneck read as a little knitted garment.
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(.405, .39, .13, 32), collar); hem.position.set(0, -.35, 0); hem.scale.z = .65; torso.add(hem);
  for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; oval(torso, sweater, [Math.cos(a)*.402, -.35, Math.sin(a)*.265], [.015,.063,.012]); }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(.215,.24,.33,28), collar); neck.position.set(0,.63,0); neck.castShadow = true; torso.add(neck);
  const neckRim = new THREE.Mesh(new THREE.TorusGeometry(.215,.035,8,36), sweater); neckRim.rotation.x = Math.PI/2; neckRim.position.set(0,.79,0); torso.add(neckRim);
  for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; oval(torso, sweater, [Math.cos(a)*.22,.64,Math.sin(a)*.22], [.009,.125,.009]); }
  const head = new THREE.Group(); head.position.set(0,2.38,0); root.add(head);
  oval(head, skin, [0,0,0], [.65,.67,.5]);
  const humanEars=new THREE.Group();head.add(humanEars);
  oval(humanEars, skin, [-.63,-.04,-.005], [.115,.18,.105]); oval(humanEars, skin, [.63,-.04,-.005], [.115,.18,.105]);
  oval(humanEars, blush, [-.663,-.035,.076], [.038,.09,.028]); oval(humanEars, blush, [.663,-.035,.076], [.038,.09,.028]);
  // The back cap and deliberately irregular locks preserve Park's curly fringe.
  const hairstyles={curly:new THREE.Group(),short:new THREE.Group(),bob:new THREE.Group()};for(const group of Object.values(hairstyles))head.add(group);
  oval(hairstyles.curly, hair, [0,.25,-.16], [.69,.55,.45]);
  const locks = [[-.57,.30,.22,.20,.27,.23],[-.42,.52,.28,.25,.24,.24],[-.19,.60,.28,.26,.23,.26],[.08,.60,.26,.25,.24,.26],[.34,.53,.27,.26,.25,.26],[.55,.32,.20,.22,.28,.23],[-.57,.04,.12,.11,.27,.15],[.58,.04,.12,.11,.25,.15],[-.37,.34,.38,.17,.24,.16],[-.12,.38,.41,.17,.22,.17],[.15,.36,.41,.17,.22,.17],[.40,.30,.37,.18,.21,.18]];
  locks.forEach(([x,y,z,sx,sy,sz],i)=>{ const lock = oval(hairstyles.curly,hair,[x,y,z],[sx,sy,sz]); lock.rotation.z = (i%3-1)*.22; });
  oval(hairstyles.short,hair,[0,.29,-.12],[.66,.47,.44]);
  for(let i=0;i<5;i++){const lock=oval(hairstyles.short,hair,[-.43+i*.2,.39,.31],[.17,.20,.18]);lock.rotation.z=-.3;}
  oval(hairstyles.bob,hair,[0,.21,-.18],[.71,.57,.46]);
  for(const side of [-1,1])oval(hairstyles.bob,hair,[side*.57,-.06,.03],[.19,.48,.29]);
  for(let i=0;i<5;i++)oval(hairstyles.bob,hair,[-.40+i*.20,.38,.36],[.15,.21,.13]);
  const cat=new THREE.Group(),rabbit=new THREE.Group(),muzzle=new THREE.Group(),spectacles=new THREE.Group();head.add(cat,rabbit,muzzle,spectacles);
  const triangle=new THREE.Shape();triangle.moveTo(-.19,0);triangle.lineTo(0,.40);triangle.lineTo(.19,0);triangle.closePath();
  const earGeometry=new THREE.ExtrudeGeometry(triangle,{depth:.10,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.035,bevelThickness:.035});
  for(const side of [-1,1]){
    const ear=new THREE.Mesh(earGeometry,skin);ear.position.set(side*.45,.46,-.07);ear.rotation.z=-side*.17;ear.castShadow=true;cat.add(ear);
    const inner=new THREE.Mesh(earGeometry,blush);inner.scale.set(.55,.6,.25);inner.position.set(side*.45,.50,.052);inner.rotation.z=-side*.17;cat.add(inner);
    const longEar=oval(rabbit,skin,[side*.28,.88,-.04],[.15,.43,.13]);longEar.rotation.z=-side*.12;
    const lining=oval(rabbit,blush,[side*.28,.90,.073],[.075,.32,.027]);lining.rotation.z=-side*.12;
    oval(muzzle,white,[side*.10,-.23,.46],[.14,.11,.085]);
    for(let i=0;i<3;i++)tube(cat,[[side*.3,-.20+i*.07,.47],[side*.63,-.23+i*.10,.42]],.007,ink);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.145,.014,8,32),ink);rim.position.set(side*.225,.015,.515);rim.scale.y=.85;spectacles.add(rim);
    tube(spectacles,[[side*.37,.03,.50],[side*.58,.04,.25]],.013,ink);
  }
  tube(spectacles,[[-.08,.015,.525],[0,.04,.54],[.08,.015,.525]],.012,ink);
  const catTail=new THREE.Group(),rabbitTail=new THREE.Group();root.add(catTail,rabbitTail);
  tube(catTail,[[.25,1.04,-.21],[.66,1.02,-.39],[.72,1.43,-.43],[.57,1.51,-.38]],.085,skin);
  oval(rabbitTail,skin,[0,.98,-.38],[.2,.2,.2]);
  const eyes = new THREE.Group(); head.add(eyes);
  const eyeMaterial=material('#272b24',.5);
  const eyeL = oval(eyes,eyeMaterial,[-.225,.015,.476],[.042,.064,.027]);
  const eyeR = oval(eyes,eyeMaterial,[.225,.015,.476],[.042,.064,.027]);
  oval(eyeL, white, [-.22,.34,.74], [.16,.13,.20]); oval(eyeR, white, [-.22,.34,.74], [.16,.13,.20]);
  tube(head,[[-.32,.175,.462],[-.24,.193,.49],[-.15,.181,.49]],.018,hair);
  tube(head,[[.15,.181,.49],[.24,.193,.49],[.32,.175,.462]],.018,hair);
  const nose=oval(head,skin,[.007,-.11,.498],[.058,.088,.073]);
  oval(head,blush,[-.39,-.15,.409],[.092,.042,.013]); oval(head,blush,[.39,-.15,.409],[.092,.042,.013]);
  const smile = tube(head,[[-.17,-.275,.445],[-.09,-.316,.475],[.02,-.325,.482],[.13,-.294,.46]],.012,ink);
  const mouth = oval(head,ink,[0,-.31,.478],[.075,.024,.012]); mouth.visible = false;
  const arms = [];
  for (const side of [-1,1]) {
    const joint = new THREE.Group(); joint.position.set(side*.43,1.60,0); root.add(joint); arms.push(joint);
    const sleeve = oval(joint,sweater,[side*.07,-.28,0],[.16,.37,.17]); sleeve.rotation.z = side*.11;
    oval(joint,collar,[side*.1,-.55,.015],[.124,.08,.135]);
    oval(joint,skin,[side*.1,-.65,.025],[.105,.13,.10]);
    oval(joint,skin,[side*.012,-.62,.075],[.052,.073,.047]);
  }
  const legs = [], knees = [], feet = [];
  for (const side of [-1,1]) {
    const joint = new THREE.Group(); joint.position.set(side*.2,.94,0); root.add(joint); legs.push(joint);
    oval(joint,trousers,[0,-.16,0],[.17,.22,.185]);
    const knee=new THREE.Group();knee.position.y=-.34;joint.add(knee);knees.push(knee);
    oval(knee,trousers,[0,-.14,0],[.155,.205,.175]);
    const foot=new THREE.Group();foot.position.set(0,-.32,0);knee.add(foot);feet.push(foot);
    oval(foot,shoes,[0,0,.07],[.19,.14,.29]);
    oval(foot,sole,[0,-.075,.08],[.19,.05,.28]);
    for(let i=0;i<3;i++) tube(foot,[[-.07,.095,.16+i*.035],[.07,.095,.16+i*.035]],.009,white);
  }
  let state = { moving:false,direction:1,chatting:false,thinking:false,speaking:false,walkDistance:0,scale:1 }, pointer={x:0,y:0},nextBlink=2.3,blinkStart=-10,waveUntil=0,walkBlend=0,gaitDistance=0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let appearance;
  function setAppearance(input){
    appearance=sanitizeAppearance(input,appearance);const animal=appearance.characterType!=='human';
    skin.color.set(animal?appearance.hairColor:appearance.skinColor);hair.color.set(appearance.hairColor);sweater.color.set(appearance.outfitColor);collar.color.set(appearance.outfitColor).multiplyScalar(.88);trousers.color.set(appearance.pantsColor);
    eyeMaterial.color.set(animal&&(skin.color.r+skin.color.g+skin.color.b)<.35?'#e7cc85':'#272b24');
    humanEars.visible=!animal;for(const [id,group]of Object.entries(hairstyles))group.visible=!animal&&id===appearance.hairStyle;
    cat.visible=catTail.visible=appearance.characterType==='cat';rabbit.visible=rabbitTail.visible=appearance.characterType==='rabbit';muzzle.visible=animal;spectacles.visible=appearance.glasses;
    head.scale.setScalar(animal?.90:1);head.position.y=animal?2.30:2.38;nose.material=animal?blush:skin;nose.scale.set(...(animal?[.058,.043,.05]:[.058,.088,.073]));
    nose.position.z=animal?.56:.498;smile.position.z=animal?.10:0;mouth.position.z=animal?.58:.478;
  }
  setAppearance(initialAppearance);
  return {
    root,
    setAppearance,
    inspectAppearance:()=>({...appearance}),
    setState(input) { if (input.chatting && !state.chatting) waveUntil = performance.now()/1000+1.1; state={...state,...input}; },
    look(x,y) { pointer={x,y}; },
    wave() { waveUntil=performance.now()/1000+1.4; },
    update(t,dt) {
      // Locomotion is essential in a desktop pet. Reduced-motion preference
      // suppresses decoration, not the steps that explain the window's travel.
      const lerp=1-Math.exp(-dt*7), walking=state.moving;
      walkBlend=THREE.MathUtils.lerp(walkBlend,walking?1:0,1-Math.exp(-dt*6));
      gaitDistance=THREE.MathUtils.lerp(gaitDistance,state.walkDistance,1-Math.exp(-dt*22));
      const phase=state.previewWalk?t*4.3:gaitDistance/(STRIDE_PIXELS*state.scale)*Math.PI*2;
      const yaw=walking ? state.direction*1.1 : pointer.x*.08;
      root.rotation.y=THREE.MathUtils.lerp(root.rotation.y,yaw,lerp);
      root.position.y = walkBlend*(-.02+(reduced?0:Math.cos(phase*2)*.003));
      root.rotation.z=reduced?0:Math.sin(phase)*.012*walkBlend;
      torso.scale.y=1+(reduced?0:Math.sin(t*1.8)*.004*(1-walkBlend));
      head.rotation.z=THREE.MathUtils.lerp(head.rotation.z,state.thinking ? Math.sin(t*1.5)*.045 : -pointer.x*.035,lerp);
      head.rotation.y=THREE.MathUtils.lerp(head.rotation.y,walking?-state.direction*.18:pointer.x*.07,lerp);
      head.rotation.x=THREE.MathUtils.lerp(head.rotation.x,pointer.y*.07,lerp);
      for(let i=0;i<2;i++) {
        const step=phase+i*Math.PI,pose=legPose(step);
        legs[i].rotation.x=pose.hip*walkBlend;
        knees[i].rotation.x=pose.knee*walkBlend;
        feet[i].rotation.x=pose.ankle*walkBlend;
        arms[i].rotation.x=THREE.MathUtils.lerp(arms[i].rotation.x,-Math.sin(step)*.13*walkBlend,lerp);
      }
      arms[1].rotation.z=THREE.MathUtils.lerp(arms[1].rotation.z,!reduced && t<waveUntil ? 2.0+Math.sin(t*16)*.23 : .04,lerp);
      arms[0].rotation.z=-.04;
      if(t>nextBlink){blinkStart=t;nextBlink=t+2.8+Math.random()*3.4;}
      const blink= Math.max(.05,1-Math.sin(Math.max(0,Math.min(1,(t-blinkStart)/.15))*Math.PI));
      eyeL.scale.y=.064*blink; eyeR.scale.y=.064*blink;
      mouth.visible=state.speaking; smile.visible=!state.speaking;
      if(state.speaking) mouth.scale.y=.025+Math.abs(Math.sin(t*13))*.045;
    }
  };
}
