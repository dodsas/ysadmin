# ysadmin

코드에 변경이 서버의 재시작이 필요한 사항이면 항상 로컬에 서버를 재시작한다.

## 정적 파일 위치

- `public/` 하위 (`index.html`, `app.js`, `styles.css`) — Express `express.static` 으로 서빙됨
- 정적 파일 변경은 **서버 재시작 불필요**, 브라우저 새로고침만으로 반영됨
- 서버 재시작이 필요한 코드: `server.js`, `lib/*.js`, `package.json`, 환경변수

## 로그 위치

- 운영(컨테이너 안): `/app/logs/ysadmin.log` — JSON 라인 포맷
- 운영(호스트 바인드 마운트): `/home/dodsas/work/ysadmin/logs/ysadmin.log`
- 5MB 단위 자동 rotation, 최대 5개 보관 (`LOG_MAX_BYTES`, `LOG_KEEP` 환경변수로 조정)
- 로컬 개발: `./logs/ysadmin.log` (cwd 기준)
- `console.log` 도 그대로 유지되므로 `podman logs ysadmin` 으로도 조회 가능

## SSH 끄기 기능

- 컨테이너 안에 `openssh-client` 포함
- 호스트의 `/home/dodsas/work/ysadmin/secrets/ssh_key` (passphrase 없는 개인키) 를 `/app/secrets/ssh_key:ro` 로 마운트
- `data/computers.json` 의 각 항목 `shutdown` 필드에 sshUser/sshPort/command 저장
- macOS/Linux 기본 명령: `sudo shutdown -h now` (sudoers `NOPASSWD` 필요)
- Windows 기본 명령: `shutdown /s /t 0 /f` (관리자 계정 + OpenSSH 서버)
- SSH 키 미배치 시에도 컨테이너는 정상 시작 — 끄기 호출 시에만 에러
