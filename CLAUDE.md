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
