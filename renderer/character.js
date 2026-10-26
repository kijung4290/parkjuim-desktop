import * as THREE from '/vendor/three.module.js';

// A real mesh character: soft clay materials, dimensional curls, independent joints.
export function createCharacter(scene) {
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
  oval(head, skin, [-.63,-.04,-.005], [.115,.18,.105]); oval(head, skin, [.63,-.04,-.005], [.115,.18,.105]);
  oval(head, blush, [-.663,-.035,.076], [.038,.09,.028]); oval(head, blush, [.663,-.035,.076], [.038,.09,.028]);
  // The back cap and deliberately irregular locks preserve Park's curly fringe.
  oval(head, hair, [0,.25,-.16], [.69,.55,.45]);
  const locks = [[-.57,.30,.22,.20,.27,.23],[-.42,.52,.28,.25,.24,.24],[-.19,.60,.28,.26,.23,.26],[.08,.60,.26,.25,.24,.26],[.34,.53,.27,.26,.25,.26],[.55,.32,.20,.22,.28,.23],[-.57,.04,.12,.11,.27,.15],[.58,.04,.12,.11,.25,.15],[-.37,.34,.38,.17,.24,.16],[-.12,.38,.41,.17,.22,.17],[.15,.36,.41,.17,.22,.17],[.40,.30,.37,.18,.21,.18]];
  locks.forEach(([x,y,z,sx,sy,sz],i)=>{ const lock = oval(head,hair,[x,y,z],[sx,sy,sz]); lock.rotation.z = (i%3-1)*.22; });
  const eyes = new THREE.Group(); head.add(eyes);
  const eyeL = oval(eyes,ink,[-.225,.015,.476],[.042,.064,.027]);
  const eyeR = oval(eyes,ink,[.225,.015,.476],[.042,.064,.027]);
  oval(eyeL, white, [-.22,.34,.74], [.16,.13,.20]); oval(eyeR, white, [-.22,.34,.74], [.16,.13,.20]);
  tube(head,[[-.32,.175,.462],[-.24,.193,.49],[-.15,.181,.49]],.018,hair);
  tube(head,[[.15,.181,.49],[.24,.193,.49],[.32,.175,.462]],.018,hair);
  oval(head,skin,[.007,-.11,.498],[.058,.088,.073]);
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
  const legs = [];
  for (const side of [-1,1]) {
    const joint = new THREE.Group(); joint.position.set(side*.2,.94,0); root.add(joint); legs.push(joint);
    oval(joint,trousers,[0,-.30,0],[.175,.40,.20]);
    oval(joint,shoes,[0,-.65,.07],[.19,.14,.29]);
    oval(joint,sole,[0,-.72,.08],[.19,.05,.28]);
    for(let i=0;i<3;i++) tube(joint,[[-.07,-.555,.16+i*.035],[.07,-.555,.16+i*.035]],.009,white);
  }
  let state = { moving: false, direction: 1, chatting: false, thinking: false, speaking: false }, pointer = {x:0,y:0}, nextBlink=2.3, blinkStart=-10, waveUntil=2;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    root,
    setState(input) { if (input.chatting && !state.chatting) waveUntil = performance.now()/1000+1.1; state={...state,...input}; },
    look(x,y) { pointer={x,y}; },
    wave() { waveUntil=performance.now()/1000+1.4; },
    update(t,dt) {
      const lerp=1-Math.exp(-dt*7), walking=state.moving && !reduced;
      const yaw=walking ? state.direction*.65 : pointer.x*.1;
      root.rotation.y=THREE.MathUtils.lerp(root.rotation.y,yaw,lerp);
      root.position.y = reduced ? 0 : (walking ? Math.abs(Math.sin(t*7))*.045 : Math.sin(t*2)*.014);
      torso.scale.y=1+(reduced ? 0 : Math.sin(t*2)*.008);
      head.rotation.z=THREE.MathUtils.lerp(head.rotation.z,state.thinking ? Math.sin(t*1.5)*.045 : -pointer.x*.035,lerp);
      head.rotation.y=THREE.MathUtils.lerp(head.rotation.y,pointer.x*.09,lerp);
      head.rotation.x=THREE.MathUtils.lerp(head.rotation.x,pointer.y*.07,lerp);
      for(let i=0;i<2;i++) {
        const phase=t*7+i*Math.PI;
        legs[i].rotation.x=THREE.MathUtils.lerp(legs[i].rotation.x,walking ? Math.sin(phase)*.38 : 0,lerp);
        arms[i].rotation.x=THREE.MathUtils.lerp(arms[i].rotation.x,walking ? -Math.sin(phase)*.28 : Math.sin(t*1.6+i)*.025,lerp);
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
