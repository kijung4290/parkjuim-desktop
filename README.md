# 박주임 미니미

바탕화면을 느긋하게 산책하는 **3D 데스크톱 마스코트 / AI 데스크톱 컴패니언**입니다. 이런 종류의 프로그램을 **데스크톱 펫(Desktop Pet)** 또는 **시메지(Shimeji) 스타일 마스코트**라고도 부릅니다.

기존 박주임의 검은 곱슬머리, 분홍 볼, 카키색 터틀넥을 바탕으로 Three.js의 실제 3D 메시로 제작했습니다. 미리 렌더링한 그림이 아니라 빛과 그림자, 눈깜빡임, 시선, 숨쉬기, 걷는 팔·다리, 말할 때의 입 움직임이 있는 캐릭터입니다. 외부 3D 모델이나 이미지 생성 서비스가 필요하지 않습니다.

## 실행

Windows 10/11 x64 기준입니다. [최신 버전 다운로드](https://github.com/kijung4290/parkjuim-desktop/releases/latest)에서 `Parkjuim-Setup` 설치형을 권장합니다. 설치형은 이후 버전을 자동으로 내려받고 적용합니다. 개발용 실행은 다음과 같습니다.

```powershell
cd parkjuim-desktop
npm install
npm start
```

캐릭터는 처음에 바탕화면 오른쪽 아래에 나타납니다. 잠깐 쉰 다음 현재 모니터의 아래쪽 절반을 자유롭게 산책합니다. 작업 표시줄을 침범하지 않으며, 모니터가 제거되면 기본 화면으로 돌아옵니다.

걷기는 실제 이동 거리에 맞춰 발걸음을 계산하고, 무릎·발목 관절과 지면에 닿는 구간을 구분합니다. 짧게 걷고 쉬며 출발과 정지는 천천히 이어집니다. 클릭 가능 영역은 Electron 메인 프로세스가 화면의 마우스 위치로 판정하여, 투명 창의 이벤트 전달에만 의존하지 않습니다.

Windows의 ‘동작 줄이기’가 켜져 있어도 이동을 표현하는 기본 발걸음은 유지합니다. 장식적인 흔들림과 손 인사만 줄입니다.

- **클릭**: 작은 대화창 열기/닫기
- **끌어다 놓기**: 원하는 곳으로 이동, 다른 모니터로 옮기기
- **마우스 올리기**: 산책 잠시 멈추기
- **우클릭 / 트레이 우클릭**: 산책·항상 위에 표시·설정·위치 초기화·종료
- **대화창 X / Esc**: 대화창 접기, 캐릭터는 계속 머무르기
- **Enter**: 전송 / **Shift+Enter**: 줄바꿈

## Claude 연결

캐릭터를 클릭하고 설정에서 개인 Claude API 키(`sk-ant-…`)를 입력해 저장합니다. 키는 Electron `safeStorage`를 통해 Windows 계정으로 암호화하여 `%APPDATA%/parkjuim-desktop/settings.json`에 저장합니다. 렌더러에 저장된 키를 돌려주지 않으며, Claude 호출은 Electron 메인 프로세스에서만 수행합니다. 키 삭제도 설정에서 할 수 있습니다.

기본 모델은 `claude-sonnet-5-5`이며 설정에서 계정에 제공되는 모델 ID로 바꿀 수 있습니다. API 키가 없거나 잔액·모델 권한이 없으면 실제 대화가 불가능합니다. Claude 구독과 API 사용료는 별도입니다. 키를 빌드에 포함하지 않으므로 배포받은 사람도 자신의 API 키를 입력합니다. 개발자의 공용 키로 서비스하려면 별도 서버와 사용자별 인증·사용량 제한이 필요합니다.

입력한 대화와 최근 최대 12회 왕복 대화가 Anthropic으로 전송됩니다. 대화는 메모리에만 보관하고 앱을 완전히 종료하면 지워집니다. 새 대화 버튼으로 현재 문맥을 지울 수 있습니다. 스트리밍 표시·중지·오류 안내·복사·답변 다시 듣기를 지원합니다. 화면·파일을 읽거나 제어하는 기능은 없습니다.

## 음성

추가 음성 API 비용 없이 Windows `System.Speech`를 사용합니다.

- **말로 입력**: 마이크 버튼을 누르면 한국어를 인식해 입력창에 적습니다. 내용을 확인하고 전송합니다. 상시 녹음이나 호출어 감지는 하지 않습니다.
- **답변 읽기**: Windows에 설치된 한국어 TTS 음성으로 읽습니다. 대화창에서 끄거나 중간에 멈출 수 있습니다.
- Windows 언어/음성 팩이 있어도 **System.Speech와 호환되는 한국어 인식기·TTS 음성이 없는 PC가 있습니다.** 이때 앱이 지원 상태를 안내합니다. 한국어 음성 인식기가 없으면 마이크 버튼이 **Windows 음성 입력(Win+H)** 으로 연결합니다. 열리지 않으면 입력창에서 Win+H를 직접 눌러 주세요. Windows 음성 입력의 인터넷 연결·개인정보 처리는 Windows 설정에 따릅니다.
- 마이크 오류가 나면 Windows의 마이크 개인정보 권한과 기본 녹음 장치를 확인하세요. 실제 녹음/스피커 동작은 대상 PC에서 확인해야 합니다.

## 빌드와 점검

```powershell
npm run check
npm test
npm run smoke
npm run dist
```

`npm run smoke`는 실제 Electron에서 3D 렌더링, 격리된 IPC와 설정 화면을 확인하고 `.preview/pet.png`, `.preview/chat.png`를 만듭니다. 테스트용 별도 사용자 폴더를 사용해 실제 API 키를 읽거나 바꾸지 않습니다. 실제 Claude 호출에는 사용자의 API 키가 필요합니다.

`npm run dist`는 `release`에 Windows 설치형과 무설치형, 업데이트 정보 `latest.yml`을 생성합니다. 현재 빌드는 **코드 서명되지 않았습니다.** 공개 배포 때 신뢰할 수 있는 게시자 표시를 원하면 코드 서명 인증서를 설정해 빌드해야 합니다.

Windows에서 압축 해제한 ASAR 파일이 잠기는 환경을 고려해, 매번 `release/build-날짜`에 새로 빌드하고 완성된 EXE를 `release`로 복사합니다. `release/latest-build.json`에 최신 빌드 폴더를 기록합니다.

`npm run dist -- --fast`는 압축을 줄여 빠르게 빌드합니다. 파일 크기는 커지지만 앱 기능은 동일합니다. 음성 스크립트는 Electron이 ASAR 안에서 읽은 뒤 PowerShell에 전달하므로 배포판에서도 별도 스크립트를 설치할 필요가 없습니다.

`npm run preview` 후 http://127.0.0.1:4178 에서 브라우저 미리보기를 볼 수 있습니다. 브라우저의 대화 응답은 명확히 표시된 화면 확인용 예시이며 실제 Claude 호출은 하지 않습니다.

## 자동 업데이트와 다음 버전 배포

설치형은 시작 15초 뒤와 4시간마다 공개 GitHub Releases를 확인합니다. 새 버전은 백그라운드에서 다운로드하고 SHA-512를 검증합니다. 내려받은 업데이트는 앱을 종료할 때 적용하며, 설정의 **지금 업데이트**로 즉시 설치하고 다시 시작할 수도 있습니다. 대화 전송·녹음·답변 읽기 중에는 즉시 재시작을 막습니다. 설정과 캐릭터 우클릭 메뉴에서 수동 확인도 가능합니다.

기존 **1.0.0에는 업데이트 코드가 없으므로 1.1.0 이상의 설치형을 한 번 설치**해야 합니다. 무설치판과 `win-unpacked` 실행은 자동 교체하지 않습니다. 자동 업데이트를 사용하려면 설치형으로 전환해 주세요. 기존 앱 ID와 설정 저장 위치를 유지하므로 같은 Windows 계정의 API 키와 설정을 계속 사용합니다.

다음 버전은 `RELEASE_NOTES.md`를 변경 내용에 맞게 수정한 뒤 배포합니다.

```powershell
npm version patch
git push origin main --follow-tags
```

`npm version patch`는 버전 커밋과 `v1.1.1` 같은 태그를 함께 만듭니다. GitHub Actions가 Windows에서 `npm ci` → 검사·테스트 → 설치 파일 빌드 → GitHub Release 공개를 수행합니다. GitHub의 기본 `GITHUB_TOKEN`을 사용하므로 개인 토큰을 소스나 설치 파일에 넣지 않습니다. **소스만 푸시하면 테스트만 실행**되며, 새 버전 태그를 푸시해야 업데이트가 배포됩니다.

자동 업데이트에 필요한 세 파일은 동일 빌드의 `Parkjuim-Setup-버전.exe`, 해당 `.blockmap`, `latest.yml`입니다. 워크플로가 초안 Release에 파일을 모두 올린 다음 공개하므로 일부 파일만 올라간 상태를 앱이 읽지 않습니다. `scripts/verify-release.cjs`는 배포판과 소스가 일치하고 업데이트 파일 해시가 올바른지 검사합니다.

[electron-updater 공식 문서](https://www.electron.build/docs/publish/)에 따라 GitHub provider와 NSIS 설치형을 사용합니다. 업데이트 파일 접근에는 사용자의 Claude 키나 GitHub 토큰이 필요하지 않습니다.

## 파일 구성

| 위치 | 역할 |
|---|---|
| `electron/main.cjs` | 투명 창, 산책 이동, 트레이, Claude 스트리밍, IPC 권한 검사 |
| `electron/preload.cjs` | 필요한 기능만 노출하는 격리된 브리지 |
| `electron/store.cjs` | 설정과 암호화된 API 키 저장 |
| `electron/updater.cjs` | 자동 확인·다운로드·설치 상태 관리 |
| `electron/speech.ps1` | Windows 한국어 인식 / 답변 읽기 |
| `renderer/character.js` | 박주임 3D 모델과 애니메이션 |
| `renderer/pet.js` | 렌더링, 캐릭터만 클릭 가능하게 판정, 드래그 |
| `renderer/chat.*` | 작은 대화창과 설정 |
| `.github/workflows/release.yml` | 새 버전 태그로 Windows 빌드·Release 자동 배포 |

렌더러는 sandbox·contextIsolation을 켜고 Node.js 접근을 차단합니다. 외부 페이지 탐색과 새 창을 막고, 로컬 커스텀 프로토콜과 CSP를 사용합니다. 응답은 HTML로 실행하지 않고 텍스트로 출력합니다.
