# ysadmin

코드에 변경이 서버의 재시작이 필요한 사항이면 항상 로컬에 서버를 재시작한다.

## 정적 파일 위치

- `public/` 하위 (`index.html`, `app.js`, `styles.css`) — Express `express.static` 으로 서빙됨
- 정적 파일 변경은 **서버 재시작 불필요**, 브라우저 새로고침만으로 반영됨
- 서버 재시작이 필요한 코드: `server.js`, `lib/*.js`, `package.json`, 환경변수

## iOS PWA

iOS 홈 화면에 추가해서 standalone 으로 쓰는 게 주된 사용 시나리오. WebKit 의
알려진 버그/제약(스크롤 컨테이너 + sticky detach, iframe ITP, history 오염,
safe-area 등) 과 채택한 대응책은 `docs/ios-pwa.md` 참고. PWA 에서만 재현되는
이슈는 그 문서 7번 디버깅 체크리스트부터 본다.

## 로그 위치

- 운영(컨테이너 안): `/app/logs/ysadmin.log` — JSON 라인 포맷
- 운영(호스트 바인드 마운트): `/home/dodsas/work/ysadmin/logs/ysadmin.log`
- 5MB 단위 자동 rotation, 최대 5개 보관 (`LOG_MAX_BYTES`, `LOG_KEEP` 환경변수로 조정)
- 로컬 개발: `./logs/ysadmin.log` (cwd 기준)
- `console.log` 도 그대로 유지되므로 `podman logs ysadmin` 으로도 조회 가능

## SSH 끄기 기능

- 컨테이너 안에 `openssh-client`, `sshpass` 포함
- 두 가지 인증 방식 지원:
  - **암호 기반** (내부망 권장): 설정 모달에서 SSH 암호 입력. `data/computers.json` 에 평문 저장됨
  - **키 기반**: 호스트의 `secrets/ssh_key` 를 `/app/secrets/ssh_key:ro` 로 마운트
- `data/computers.json` 의 각 항목 `shutdown` 필드: enabled / sshUser / sshPort / sshPassword / command
- macOS/Linux 기본 명령: `sudo shutdown -h now` (sudoers `NOPASSWD` 필요)
- Windows 기본 명령: `shutdown /s /t 0 /f` (OpenSSH 서버 + 관리자 권한 계정)
- 실패 시 로그(`logger.error('shutdown', ...)`)에 hint 포함:
  암호 오류 / 키 거부 / 연결 거부 / 타임아웃 등 자동 분류
