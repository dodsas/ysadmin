# ysadmin

코드에 변경이 서버의 재시작이 필요한 사항이면 항상 로컬에 서버를 재시작한다.

## 정적 파일 위치

- `public/` 하위 (`index.html`, `app.js`, `styles.css`) — Express `express.static` 으로 서빙됨
- 정적 파일 변경은 **서버 재시작 불필요**, 브라우저 새로고침만으로 반영됨
- 서버 재시작이 필요한 코드: `server.js`, `lib/*.js`, `package.json`, 환경변수
