// Read Windows' effective state, including changes made in Task Manager.
function createStartupController({ app, mode, name = 'kr.parkjuim.desktop', args = [] }) {
  const supported = mode === 'installed';
  const options = { path: app.getPath('exe'), args };
  function get() {
    if (!supported) return { startAtLogin: false, startAtLoginSupported: false, startAtLoginBlocked: false };
    const state = app.getLoginItemSettings(options);
    return {
      startAtLogin: !!state.openAtLogin && !!state.executableWillLaunchAtLogin,
      startAtLoginSupported: true,
      startAtLoginBlocked: !!state.openAtLogin && !state.executableWillLaunchAtLogin
    };
  }
  function set(enabled) {
    if (!supported) {
      if (enabled) throw new Error('Windows 자동 실행은 설치형에서 사용할 수 있어요. 최신 설치 파일을 설치해 주세요.');
      return get();
    }
    app.setLoginItemSettings({ ...options, name, openAtLogin: enabled, enabled });
    const state = get();
    if (state.startAtLogin !== enabled) throw new Error('Windows 자동 실행 설정을 적용하지 못했어요. Windows 설정의 앱 → 시작 프로그램을 확인해 주세요.');
    return state;
  }
  return { get, set };
}
module.exports = { createStartupController };
