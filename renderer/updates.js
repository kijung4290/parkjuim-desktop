export function initializeUpdates(bridge, notify) {
  const $ = selector => document.querySelector(selector);
  function render(state) {
    $('#app-version').textContent = `v${state.version}`;
    const messages = {
      idle: '자동 업데이트가 켜져 있어요.', checking: '새 버전을 확인하고 있어요.',
      current: '최신 버전이에요.', downloading: `v${state.nextVersion} 내려받는 중 · ${state.percent}%`,
      downloaded: `v${state.nextVersion} 준비 완료. 앱을 종료하면 자동으로 적용돼요.`,
      installing: '업데이트를 적용하고 다시 시작할게요.', error: state.message,
      disabled: state.mode === 'portable' ? '무설치판은 최신 설치형으로 전환하면 자동 업데이트를 받을 수 있어요.' : '개발·미설치 실행에서는 자동 설치하지 않아요. 설치형을 이용해 주세요.'
    };
    $('#update-status').textContent = messages[state.status] || '';
    $('#check-update').disabled = state.mode !== 'installed' || ['checking','downloading','downloaded','installing'].includes(state.status);
    $('#install-update').hidden = state.status !== 'downloaded';
    $('#update-banner').hidden = state.status !== 'downloaded';
    $('#update-banner-text').textContent = `새 버전 v${state.nextVersion}이 준비됐어요.`;
  }
  const install = async () => { const result = await bridge?.installUpdate(); if(result?.error)notify(result.error); };
  $('#update-now').addEventListener('click', install);
  $('#install-update').addEventListener('click', install);
  $('#open-releases').addEventListener('click', () => bridge?.openLink('releases'));
  $('#check-update').addEventListener('click', async () => { const result=await bridge?.checkUpdate(); if(result?.error)notify(result.error);else if(result)render(result); });
  if(bridge) { bridge.onUpdate(render); bridge.updateState().then(result => { if(result?.error)notify(result.error);else render(result); }); }
  else render({status:'disabled',mode:'development',version:'1.1.0'});
}
