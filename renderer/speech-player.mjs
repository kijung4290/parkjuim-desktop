export function createSpeechPlayer(bridge, notify, { makeAudio = url => new Audio(url), urls = URL } = {}) {
  let sequence = 0, current = null;
  let started = 0, ended = 0, duration = 0;
  function stopLocal() {
    sequence++;
    if (!current) return;
    const item = current; current = null;
    item.audio.onended = item.audio.onerror = item.audio.onplaying = null;
    item.audio.pause(); item.audio.removeAttribute('src'); item.audio.load();
    urls.revokeObjectURL(item.url);
  }
  bridge?.onVoice(event => { if (event.type === 'silence') stopLocal(); });
  async function stop() { stopLocal(); await bridge?.stopSpeaking(); }
  async function play(method, input) {
    if (!bridge) { notify('음성 미리듣기는 Windows 앱에서 사용할 수 있어요.'); return {cancelled:true}; }
    stopLocal();
    const token = sequence;
    await bridge.stopSpeaking();
    if (token !== sequence) return {cancelled:true};
    let result;
    try { result = await method(input); }
    catch { if(token===sequence)notify('음성 요청을 처리하지 못했어요. 다시 시도해 주세요.'); return {error:'음성 요청을 처리하지 못했어요.'}; }
    if (token !== sequence || result?.cancelled) return {cancelled:true};
    if (result?.error) { notify(result.error); return result; }
    if (!result?.audio) return result;
    const url = urls.createObjectURL(new Blob([result.audio],{type:'audio/mpeg'}));
    const audio = makeAudio(url), id = result.id;
    current = {audio,url,id};
    const finish = state => {
      if (current?.id !== id) return;
      bridge.playback(id,state); stopLocal();
    };
    audio.onplaying = () => { if(current?.id===id){started++;duration=audio.duration;bridge.playback(id,'playing');} };
    audio.onended = () => { ended++;finish('ended'); };
    audio.onerror = () => { if(current?.id===id){notify('음성을 재생하지 못했어요. 소리 출력 장치를 확인해 주세요.');finish('error');} };
    try { await audio.play(); } catch {
      if (current?.id === id) { notify('음성을 재생하지 못했어요. 다시 듣기를 눌러 주세요.'); finish('error'); }
    }
    return {ok:true};
  }
  return { speak:text=>play(bridge?.speak,text), preview:input=>play(bridge?.previewVoice,input), stop, stopLocal, inspect:()=>({active:!!current,started,ended,duration}) };
}
