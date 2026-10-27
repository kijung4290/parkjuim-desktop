export const CHARACTER_TYPES=Object.freeze(['human','cat','rabbit','custom']);
export const HAIR_STYLES=Object.freeze(['curly','short','bob']);
export const APPEARANCE_DEFAULTS=Object.freeze({characterName:'박주임',characterType:'human',hairStyle:'curly',skinColor:'#f2bf9d',hairColor:'#292b27',outfitColor:'#74764c',pantsColor:'#41473e',glasses:false,customModelId:'',modelRotation:0});
export const CHARACTER_PRESETS=Object.freeze({human:{...APPEARANCE_DEFAULTS},cat:{...APPEARANCE_DEFAULTS,characterType:'cat',hairColor:'#c99462',outfitColor:'#7a9b88',pantsColor:'#56635a'},rabbit:{...APPEARANCE_DEFAULTS,characterType:'rabbit',hairColor:'#e5dfd5',outfitColor:'#b397ac',pantsColor:'#665f73'}});
export function sanitizeAppearance(input={},previous=APPEARANCE_DEFAULTS){
  const result={};for(const field of Object.keys(APPEARANCE_DEFAULTS))result[field]=previous[field]??APPEARANCE_DEFAULTS[field];
  if(input.characterName!==undefined){
    if(typeof input.characterName!=='string')throw new Error('캐릭터 이름을 입력해 주세요.');
    const name=input.characterName.normalize('NFC').trim();
    if(!name||Array.from(name).length>20||/[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(name))throw new Error('캐릭터 이름은 줄바꿈과 < > 없이 1~20자로 입력해 주세요.');
    result.characterName=name;
  }
  for(const [field,allowed]of [['characterType',CHARACTER_TYPES],['hairStyle',HAIR_STYLES]])if(input[field]!==undefined){if(!allowed.includes(input[field]))throw new Error('캐릭터 종류와 머리 모양을 확인해 주세요.');result[field]=input[field];}
  for(const field of ['skinColor','hairColor','outfitColor','pantsColor'])if(input[field]!==undefined){if(typeof input[field]!=='string'||!/^#[\da-f]{6}$/i.test(input[field]))throw new Error('캐릭터 색상은 올바른 색상표에서 선택해 주세요.');result[field]=input[field].toLowerCase();}
  if(input.glasses!==undefined){if(typeof input.glasses!=='boolean')throw new Error('안경 설정을 확인해 주세요.');result.glasses=input.glasses;}
  if(input.customModelId!==undefined){if(typeof input.customModelId!=='string'||input.customModelId!==''&&!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.customModelId))throw new Error('추가한 캐릭터를 선택해 주세요.');result.customModelId=input.customModelId;}
  if(input.modelRotation!==undefined){if(!Number.isFinite(input.modelRotation)||input.modelRotation<0||input.modelRotation>360)throw new Error('모델 방향은 0~360도로 설정해 주세요.');result.modelRotation=input.modelRotation;}
  return result;
}
