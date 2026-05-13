# ysadmin 배포 설정 체크리스트

처음 1회 진행하는 셋업 절차. 위에서부터 순서대로 진행.

- 대상 사용자: `dodsas`
- 원격 작업 경로: `/home/dodsas/work/ysadmin`
- 트리거: `main` 브랜치 push 시 자동 배포

---

## ☐ 1단계 — 원격 Git 저장소 준비 및 푸시 (로컬)

```bash
cd /Users/nam-yuseon/IdeaProjects/ysadmin

# 사내 GitLab/GitHub 등에서 빈 저장소 생성 후
git remote add origin <repo-url>

git add .
git commit -m "init: ysadmin keep-alive monitor + 배포 자산"
git branch -M main
git push -u origin main
```

검증: 원격 저장소 웹 UI에서 파일 목록 확인.

---

## ☐ 2단계 — Podman 호스트 준비 (`dodsas`로 SSH 접속해서)

```bash
# rootless 컨테이너가 세션 종료 후에도 살아있도록
sudo loginctl enable-linger dodsas

# 작업 디렉토리 생성
mkdir -p /home/dodsas/work/ysadmin

# Podman 동작 확인
podman --version              # 4.9.4-rhel
podman info | head -20        # rootless 확인

# 3000 포트 방화벽 (firewalld 환경)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

검증: `podman ps` 가 에러 없이 빈 목록 출력.

---

## ☐ 3단계 — Jenkins → dodsas SSH 키 설정

**Jenkins 서버**에서:
```bash
sudo -iu jenkins
ssh-keygen -t ed25519 -f ~/.ssh/ysadmin_deploy -N ''
cat ~/.ssh/ysadmin_deploy.pub        # 출력값 복사
```

**Podman 호스트 (dodsas)** 에서:
```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<위에서 복사한 공개키>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# SELinux 환경이면
restorecon -Rv ~/.ssh
```

**Jenkins 서버**에서 연결 테스트:
```bash
sudo -u jenkins ssh -i ~/.ssh/ysadmin_deploy dodsas@<podman-host> "podman --version"
# → "podman version 4.9.4-rhel" 출력되면 성공
```

---

## ☐ 4단계 — Jenkins Credentials 등록 (웹 UI)

**Manage Jenkins → Credentials → System → Global → Add Credentials**

| 필드 | 값 |
|---|---|
| Kind | SSH Username with private key |
| ID | `ysadmin-deploy-ssh` (정확히 이대로) |
| Username | `dodsas` |
| Private Key | Enter directly → `~/.ssh/ysadmin_deploy` 파일 내용 |

ID가 정확히 `ysadmin-deploy-ssh` 여야 `Jenkinsfile`이 찾을 수 있음.

---

## ☐ 5단계 — Jenkins Pipeline 잡 생성

**New Item → Pipeline** (이름 예: `ysadmin-deploy`)

- Pipeline → Definition: **Pipeline script from SCM**
- SCM: **Git**
- Repository URL: 1단계의 git URL
- 필요 시 git 자격증명 추가
- Branch Specifier: `*/main`
- Script Path: `Jenkinsfile`
- Build Triggers:
  - ☑ `GitHub hook trigger for GITScm polling` (GitHub 환경)
  - 또는 ☑ `Poll SCM`: `H/2 * * * *` (사내 git / webhook 불가 환경)

저장.

---

## ☐ 6단계 — Git Webhook 등록 (가능한 환경이면)

**GitHub**: 저장소 → Settings → Webhooks → Add webhook
- Payload URL: `http://<jenkins-host>:8080/github-webhook/`
- Content type: `application/json`
- Events: `Just the push event`

**GitLab**: 저장소 → Settings → Webhooks
- URL: `http://<jenkins-host>:8080/project/ysadmin-deploy`
- Trigger: `Push events`

사내망에서 webhook 불가하면 이 단계 건너뛰고 5단계의 Poll SCM만으로 운영. 최대 2분 지연.

---

## ☐ 7단계 — 첫 배포 실행 (수동)

Jenkins → 잡 → **Build with Parameters**

| 파라미터 | 입력값 |
|---|---|
| DEPLOY_HOST | Podman 호스트의 실제 IP 또는 호스트명 ★ |
| DEPLOY_USER | `dodsas` |
| REMOTE_DIR | `/home/dodsas/work/ysadmin` |
| HOST_PORT | `3000` |
| PING_INTERVAL_MS | `600000` |
| DEPLOY_BRANCH | `main` |

★ DEPLOY_HOST만 환경에 맞게 입력. 나머지는 기본값 그대로.

Build 실행 → Console Output에서 각 stage 통과 확인:
1. Checkout
2. Package
3. Transfer
4. Deploy
5. Smoke Test

---

## ☐ 8단계 — 배포 검증

**Podman 호스트 (dodsas)** 에서:
```bash
podman ps --filter name=ysadmin
# STATUS: Up X seconds (healthy)

curl -s http://127.0.0.1:3000/api/health
# {"ok":true,"ts":"..."}
```

**브라우저**:
```
http://<podman-host>:3000
```
- 탭 UI 표시 확인
- 테스트 URL 등록 → 녹색 표시 확인

---

## ☐ 9단계 — 자동 배포 검증

```bash
# 로컬에서 사소한 변경 후
git commit -am "test: trigger auto deploy"
git push origin main
```

Jenkins에서 자동 빌드 시작되면 webhook/polling 정상. 빌드 종료 후 브라우저 재접속.

---

## ☐ 10단계 — (선택, 권장) 호스트 재부팅 대응 — Quadlet 등록

배포가 안정화된 후 1회만 진행.

**Podman 호스트 (dodsas)** 에서:
```bash
mkdir -p ~/.config/containers/systemd
cp /home/dodsas/work/ysadmin/deploy/ysadmin.container ~/.config/containers/systemd/

systemctl --user daemon-reload
systemctl --user start ysadmin.service
systemctl --user enable ysadmin.service

systemctl --user status ysadmin.service
```

⚠ Quadlet 적용 후에는 `deploy.sh`의 `podman run`과 컨테이너 이름이 충돌. 적용 시점에 `deploy.sh`를 `systemctl --user restart ysadmin.service` 호출 방식으로 변경 필요.

---

## 트러블슈팅 — 자주 막히는 지점

| 증상 | 원인 / 조치 |
|---|---|
| 3단계 SSH 연결 실패 (Permission denied) | SELinux가 authorized_keys 차단 → `restorecon -Rv ~/.ssh` |
| Deploy stage에서 podman 명령 실패 | linger 미적용 → 2단계 `loginctl enable-linger dodsas` 재확인 |
| 컨테이너는 떴는데 외부 접속 불가 | firewalld / 클라우드 보안그룹 / 사내 방화벽 확인 |
| `podman build`에서 npm 네트워크 오류 | 사내 npm 미러 설정 → Dockerfile에 `RUN npm config set registry https://<사내미러>/` 추가 |
| Jenkins가 webhook은 받는데 빌드 안 시작 | 5단계 Build Triggers 체크 빠뜨림 / GitHub plugin 미설치 |
| Smoke Test에서 502/Connection refused | 컨테이너 부팅 시간 부족 → `deploy.sh`의 헬스체크 대기 30초로는 부족할 가능성 (이미지 첫 빌드 시) |

---

## 운영 명령어 빠른 참조

```bash
podman ps --filter name=ysadmin                 # 상태
podman logs -f ysadmin                          # 로그
podman exec -it ysadmin sh                      # 컨테이너 진입
podman volume inspect ysadmin-data              # 데이터 볼륨 경로
podman volume export ysadmin-data > backup.tar  # 백업

# 롤백
git revert <bad-commit>
git push origin main
```
