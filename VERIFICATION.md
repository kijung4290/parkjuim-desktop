# 실행 검증 결과

2026-10-26 Windows x64에서 확인했습니다.

- 소스 구문 및 필수 에셋: 통과
- 단위 테스트 13개: 통과 (기존 기능 6개와 설치형 판별·동시 확인·다운로드 상태·대화 중 설치 방지·해시 오류 차단·비동기 다운로드 실패 처리·예약 확인 정리 7개)
- 실제 Electron 및 최종 패키징 EXE: 3D 렌더링, 산책 이동, 마우스 올리면 정지, 대화 중 정지, 설정 IPC 격리, Windows 비동기 키 암호화, 키 없는 요청 차단 모두 통과
- 패키징된 음성 헬퍼 실행: 통과. 이 PC의 한국어 TTS 지원 확인. 한국어 SAPI 인식기는 없어 Windows 음성 입력으로 연결하도록 구현
- 브라우저 UI 확인: 메시지 입력, 예시 스트리밍 표시, 설정 저장, 새 대화 통과
- 최종 ASAR에 들어간 Electron·렌더러 파일과 현재 소스의 바이트 비교: 일치
- 설치형 및 무설치형 Windows EXE 생성: 완료

최종 패키징 실행 결과 JSON과 화면 캡처는 `release/latest-build.json`에 기록된 폴더의 `win-unpacked/.preview/`에 있습니다.

## GitHub 자동 업데이트 검증

- 공개 저장소: https://github.com/kijung4290/parkjuim-desktop
- v1.1.1 태그로 GitHub Actions의 Windows 빌드·테스트·배포 파일과 소스 비교·업데이트 해시 검사·Release 공개가 모두 성공했습니다.
- 배포 실행 기록: https://github.com/kijung4290/parkjuim-desktop/actions/runs/40299001465
- `npm run verify:feed -- --download`로 실제 Electron 업데이트 엔진이 공개 피드의 v1.1.1을 발견하고 설치 파일을 내려받아 SHA-512를 검증했습니다. 이 검사는 비교할 이전 버전만 1.0.0으로 가정하며, 실제 네트워크·피드 파싱·다운로드·해시 검증 코드를 사용합니다.
- 검사 결과는 `.preview/update-feed-check/result.json`에 기록합니다. 현재 사용자 앱을 종료하거나 설치 파일을 실행하지 않았습니다. 실제 설치 교체·재시작은 이 검사에 포함되지 않습니다.

실제 Claude API 호출은 API 키가 제공되지 않아 검증하지 않았습니다. 마이크 녹음·Win+H의 실제 받아쓰기·스피커 출력은 대상 PC에서 확인해야 합니다. 코드 서명은 포함되어 있지 않습니다. v1.1.0부터 설치형의 자동 업데이트와 태그 기반 GitHub Release 워크플로를 지원합니다.
