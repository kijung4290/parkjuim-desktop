const $ = selector => document.querySelector(selector);
export function createVoiceSettings({ bridge, player, onSettings }) {
  let settings = {}, voices = [], nextPageToken = '', loading = false, request = 0, previewing = false;
  const feedback = text => { $('#voice-feedback').textContent = text; };
  function sync(next) {
    settings = {...settings,...next};
    $('#eleven-key-status').textContent = settings.hasElevenLabsKey ? settings.elevenLabsKeySource === 'environment' ? '로컬 연결됨' : '연결됨' : '연결 전';
    $('#eleven-key-status').classList.toggle('connected',!!settings.hasElevenLabsKey);
    $('#eleven-key').placeholder = settings.hasElevenLabsKey ? '연결된 키가 있어요 · 변경하려면 입력' : 'ElevenLabs API 키';
    $('#delete-eleven-key').hidden = settings.elevenLabsKeySource !== 'saved';
  }
  function render(selected = $('#voice-choice').value || settings.elevenLabsVoiceId) {
    const select = $('#voice-choice'); select.replaceChildren(new Option('목소리를 선택해 주세요',''));
    if (selected && !voices.some(voice=>voice.id===selected)) {
      const option = new Option(settings.elevenLabsVoiceName || '저장한 목소리',selected); option.dataset.name=settings.elevenLabsVoiceName || '저장한 목소리'; select.add(option);
    }
    for (const voice of voices) {
      const gender=({male:'남성',female:'여성',neutral:'중성'})[voice.gender] || '';
      const option = new Option(`${voice.korean ? '한국어 · ' : ''}${voice.name}${gender ? ` · ${gender}` : ''}`,voice.id);
      option.dataset.name=voice.name; select.add(option);
    }
    select.value = selected || '';
    $('#more-voices').hidden = !nextPageToken;
    description();
  }
  function description() { $('#voice-description').textContent = voices.find(voice=>voice.id===$('#voice-choice').value)?.description || '선택한 목소리로 한국어 미리듣기를 해 보세요.'; }
  async function load(more = false) {
    if (!bridge) { feedback('앱에서 ElevenLabs를 연결하면 목소리를 불러올 수 있어요.'); return; }
    if (!settings.hasElevenLabsKey) { feedback('API 키를 입력하고 연결하기를 눌러 주세요.'); return; }
    if (loading) return;
    const generation = ++request; loading=true;
    $('#load-voices').disabled=$('#more-voices').disabled=true;
    feedback('목소리를 불러오고 있어요…');
    try {
      const result=await bridge.voices({search:$('#voice-search').value,nextPageToken:more?nextPageToken:''});
      if(generation!==request)return;
      if(result?.error)throw new Error(result.error);
      const all=more?[...voices,...result.voices]:result.voices;
      voices=[...new Map(all.map(voice=>[voice.id,voice])).values()];
      nextPageToken=result.nextPageToken;render();
      feedback(voices.length?`${voices.length}개 목소리 · 한국어 표시가 있는 목소리를 먼저 살펴보세요.`:'검색 결과가 없어요. 검색어를 지우거나 내 목소리에 음성을 추가해 주세요.');
    }catch(error){feedback(error.message);}finally{loading=false;$('#load-voices').disabled=$('#more-voices').disabled=false;}
  }
  function input() {
    return {speechProvider:$('#speech-provider').value,elevenLabsVoiceId:$('#voice-choice').value,elevenLabsVoiceName:$('#voice-choice').selectedOptions[0]?.dataset.name || '',elevenLabsModel:$('#voice-model').value,voiceStability:Number($('#voice-stability').value)};
  }
  function clearSensitive() { $('#eleven-key').value=''; }
  function open() {
    clearSensitive();sync(settings);$('#speech-provider').value=settings.speechProvider || 'windows';$('#voice-model').value=settings.elevenLabsModel || 'eleven_v4';$('#voice-stability').value=settings.voiceStability ?? .4;
    render(settings.elevenLabsVoiceId);feedback('목소리·모델을 바꾸면 아래 설정 저장을 눌러 주세요.');
    if(settings.hasElevenLabsKey&&!voices.length)load();
  }
  $('#connect-eleven').addEventListener('click',async()=>{
    const button=$('#connect-eleven');button.disabled=true;
    try {
      if(!bridge)throw new Error('API 연결은 Windows 앱에서 할 수 있어요.');
      if(!$('#eleven-key').value.trim()&&!settings.hasElevenLabsKey)throw new Error('ElevenLabs API 키를 입력해 주세요.');
      const result=await bridge.saveSettings({elevenLabsApiKey:$('#eleven-key').value,speechProvider:'elevenlabs'});
      if(result?.error)throw new Error(result.error);
      clearSensitive();onSettings(result);$('#speech-provider').value='elevenlabs';await load();
    }catch(error){feedback(error.message);}finally{button.disabled=false;}
  });
  $('#delete-eleven-key').addEventListener('click',async()=>{
    const result=await bridge?.saveSettings({clearElevenLabsKey:true,speechProvider:'windows'});
    if(result?.error){feedback(result.error);return;}
    clearSensitive();onSettings(result || {hasElevenLabsKey:false,elevenLabsKeySource:'',speechProvider:'windows'});$('#speech-provider').value='windows';voices=[];nextPageToken='';render();feedback('저장된 키를 삭제했어요. Windows 음성으로 읽어요.');
  });
  $('#load-voices').addEventListener('click',()=>load());
  $('#more-voices').addEventListener('click',()=>load(true));
  $('#voice-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();load();}});
  $('#voice-choice').addEventListener('change',description);
  $('#preview-voice').addEventListener('click',async()=>{
    const config=input();if(!config.elevenLabsVoiceId){feedback('먼저 목소리를 선택해 주세요.');return;}
    const button=$('#preview-voice');button.disabled=true;feedback('한국어 음성을 만들고 있어요…');
    try{const result=await player.preview(config);previewing=!!result?.ok;feedback(result?.error?result.error:result?.cancelled?'미리듣기를 중지했어요.':'미리듣기 중이에요. 마음에 들면 설정을 저장해 주세요.');}catch{feedback('미리듣기를 시작하지 못했어요. 다시 시도해 주세요.');}finally{button.disabled=false;}
  });
  $('#stop-preview').addEventListener('click',()=>{previewing=false;player.stop();feedback('미리듣기를 중지했어요.');});
  bridge?.onVoice(event=>{if(event.type==='speech-state'&&event.state==='idle'&&previewing){previewing=false;feedback('미리듣기를 마쳤어요. 마음에 들면 설정을 저장해 주세요.');}});
  $('#get-eleven-key').addEventListener('click',()=>bridge?.openLink('elevenlabs'));
  $('#voice-library').addEventListener('click',()=>bridge?.openLink('voices'));
  return {sync,open,input,clearSensitive};
}
