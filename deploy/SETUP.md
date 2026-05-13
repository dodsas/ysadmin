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

# podman-compose 설치 확인 (없으면 설치)
podman-compose --version || sudo dnf install -y podman-compose
# 또는 (dnf 패키지가 없는 경우): pip install --user podman-compose

# 6666 포트 방화벽 (firewalld 환경)
sudo firewall-cmd --permanent --add-port=6666/tcp
sudo firewall-cmd --reload
```

검증: `podman ps` 가 에러 없이 빈 목록 출력.

---

## ☐ 3단계 — Jenkins → dodsas SSH 키 설정

> 왜 로컬에서 만드는가: Jenkins가 컨테이너로 떠있어 `podman exec`로 들어가서 키를 만드는 게 번거롭고, 컨테이너 재생성 시 키 분실 위험도 있음. 키는 어디서 만들든 결과가 동일하므로 **로컬 Mac에서 생성 → Jenkins Credentials UI에 붙여넣기**가 가장 실용적.

### 3-1. 로컬 Mac에서 SSH 키 페어 생성

```bash
ssh-keygen -t ed25519 -f ~/.ssh/ysadmin_deploy -N '' -C "jenkins->dodsas ysadmin deploy"
```

산출물:
- 공개키: `~/.ssh/ysadmin_deploy.pub`
- 개인키: `~/.ssh/ysadmin_deploy`

### 3-2. 공개키를 dodsas의 `authorized_keys`에 등록

공개키 내용 확인:
```bash
cat ~/.ssh/ysadmin_deploy.pub
# ssh-ed25519 AAAA... jenkins->dodsas ysadmin deploy
```

이 한 줄을 dodsas의 `~/.ssh/authorized_keys`에 추가. 세 가지 방법 중 편한 것:

**(a) Cockpit Web Terminal 사용** (가장 간단)
1. `https://<podman-host>:9090` 접속 → dodsas 로그인
2. 좌측 메뉴 **Terminal** 클릭
3. 다음 실행:
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo "<위에서 복사한 공개키 한 줄>" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   # SELinux enforce 환경
   restorecon -Rv ~/.ssh 2>/dev/null || true
   ```

**(b) 기존 SSH 접속 가능하면 ssh-copy-id 사용**
```bash
# 로컬 Mac에서, dodsas에 패스워드 로그인이 가능하다면
ssh-copy-id -i ~/.ssh/ysadmin_deploy.pub dodsas@<podman-host>
```

**(c) Cockpit 파일 매니저 사용**
- Cockpit → **Files** → `/home/dodsas/.ssh/authorized_keys` 편집 → 공개키 한 줄 붙여넣고 저장

### 3-3. 개인키를 Jenkins Credentials에 등록

개인키 내용 확인 (Mac 로컬에서):
```bash
cat ~/.ssh/ysadmin_deploy
# -----BEGIN OPENSSH PRIVATE KEY-----
# ...
# -----END OPENSSH PRIVATE KEY-----
```

Jenkins UI → **Manage Jenkins → Credentials → System → Global → Add Credentials**:

| 필드 | 값 |
|---|---|
| Kind | SSH Username with private key |
| Scope | Global |
| ID | `ysadmin-deploy-ssh` (정확히 이대로) |
| Username | `dodsas` |
| Private Key | **Enter directly** 라디오 선택 → 위 개인키 전체 붙여넣기 (`-----BEGIN...END-----` 포함) |
| Passphrase | 비워둠 (3-1에서 `-N ''`로 만들었음) |

### 3-4. 로컬 Mac에서 연결 테스트 (선택)

Jenkins로 등록은 끝났지만, 키 자체가 동작하는지 한 번 확인하고 싶다면:
```bash
ssh -i ~/.ssh/ysadmin_deploy dodsas@<podman-host> "podman --version"
# → "podman version 4.9.4-rhel"
```

성공하면 Jenkins도 같은 키로 동일하게 동작합니다. 실패하면 3-2의 `authorized_keys` 등록을 다시 확인.

### 3-5. (보안 강화) 로컬 Mac의 개인키 정리

Jenkins Credentials에 등록되면 로컬 Mac의 개인키 파일은 더 이상 필요 없습니다. 보안상 삭제 권장:
```bash
shred -u ~/.ssh/ysadmin_deploy 2>/dev/null || rm -P ~/.ssh/ysadmin_deploy
rm ~/.ssh/ysadmin_deploy.pub
```

(주의: 분실 시 재발급 절차를 거쳐야 하므로, 운영 일정상 여유 있을 때 정리)

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

## ☐ 5단계 — Jenkins Pipeline Item 생성

**New Item → Pipeline** (이름 예: `ysadmin-deploy`)

- Pipeline → Definition: **Pipeline script from SCM**
- SCM: **Git**
- Repository URL: 1단계의 git URL
- 필요 시 git 자격증명 추가
- Branch Specifier: `*/main`
- Script Path: `Jenkinsfile`
- Build Triggers: **환경에 따라 둘 중 하나 선택**

  **(A) Webhook 가능 환경** (GitHub이 Jenkins URL에 HTTP 도달 가능)
  - ☑ `GitHub hook trigger for GITScm polling`
  - → 이 옵션은 **6단계와 한 쌍**입니다. 6단계 미실시 시 트리거 동작 안 함

  **(B) Webhook 불가 환경** (사내망 / 방화벽으로 외부에서 Jenkins 접근 차단)
  - ☑ `Poll SCM`: `H/2 * * * *` (2분 주기 폴링)
  - → 6단계 불필요. 1~2분 지연 발생

webhook 도달 가능 여부 빠른 판단:
- Jenkins URL이 GitHub.com → Jenkins 방향으로 열려있나? (공인 IP / 사내 GitHub Enterprise 등)
- 모르면 일단 (B)로 시작 → 나중에 webhook 가능해지면 옵션 추가/변경

저장.

---

## ☐ 6단계 — Git Webhook 등록 (5단계에서 A 선택한 경우 **필수**)

> 5단계 (B) Poll SCM만 선택했다면 이 단계는 건너뛰세요.

**GitHub**: 저장소 → Settings → Webhooks → Add webhook
- Payload URL: `http://<jenkins-host>:8080/github-webhook/`
- Content type: `application/json`
- Events: `Just the push event`

**GitLab**: 저장소 → Settings → Webhooks
- URL: `http://<jenkins-host>:8080/project/ysadmin-deploy`
- Trigger: `Push events`

### 등록 후 동작 확인

GitHub 저장소 → Settings → Webhooks → 등록한 webhook 클릭 → **Recent Deliveries** 탭
- ✅ 초록 체크 + 200 응답 → webhook 정상
- ❌ 빨간 X (Connection refused / timeout) → Jenkins URL이 외부에서 접근 불가 → 5단계 (B)로 전환 권장

---

## ☐ 7단계 — 첫 배포 실행 (수동)

### 7-1. 5단계에서 만든 Item 화면으로 진입

1. Jenkins 첫 화면(**Dashboard**) 접속
2. 중앙 목록에서 **`ysadmin-deploy`** 클릭 (5단계에서 만든 Item 이름)

### 7-2. 파라미터 입력 화면으로 진입

좌측 사이드바에서 **`Build with Parameters`** 클릭
- 한글 UI라면: **`파라미터와 함께 빌드`** 또는 **`매개변수와 함께 빌드`**

> 메뉴에 `Build with Parameters`가 안 보이고 `Build Now`만 보이면, **`Build Now`를 한 번 클릭**하세요. Jenkinsfile의 parameters 블록이 등록되면서 다음부터 `Build with Parameters`로 바뀝니다. (첫 빌드는 파라미터 없이 기본값으로 실행됨)

### 7-3. 파라미터 입력

| 파라미터 | 입력값 |
|---|---|
| DEPLOY_HOST | Podman 호스트의 실제 IP 또는 호스트명 ★ |
| DEPLOY_USER | `dodsas` |
| REMOTE_DIR | `/home/dodsas/work/ysadmin` |
| HOST_PORT | `6666` |
| PING_INTERVAL_MS | `600000` |
| DEPLOY_BRANCH | `main` |

★ **DEPLOY_HOST만** 환경에 맞게 입력. 나머지는 기본값 그대로 두면 됩니다.

### 7-4. 빌드 실행 및 진행 상황 확인

하단 **`Build`** 버튼 클릭 → Item 화면 좌측 하단 **`Build History`** 에 새 빌드 번호(`#1`) 표시됨.

빌드 번호 클릭 → 좌측 **`Console Output`** 클릭 → 실시간 로그 확인.

### 7-5. 통과해야 할 5개 stage

Console Output에 다음 순서로 stage가 표시되며 모두 통과해야 합니다:

1. **Checkout** — 저장소에서 코드 가져오기
2. **Package** — `git archive`로 tar.gz 생성
3. **Transfer** — Podman 호스트로 SCP 전송 및 압축 해제
4. **Deploy** — `deploy.sh` 실행 (podman-compose build/up)
5. **Smoke Test** — 헬스체크 응답 확인

성공 시 마지막 줄:
```
✓ 배포 성공: http://<DEPLOY_HOST>:6666  (image: localhost/ysadmin:b1-<sha>)
```

---

## ☐ 8단계 — 배포 검증

**Podman 호스트 (dodsas)** 에서:
```bash
podman ps --filter name=ysadmin
# STATUS: Up X seconds (healthy)

curl -s http://127.0.0.1:6666/api/health
# {"ok":true,"ts":"..."}
```

**브라우저**:
```
http://<podman-host>:6666
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

## ☐ 10단계 — (선택, 권장) 호스트 재부팅 대응

compose의 `restart: always`는 **Podman 서비스 차원 재시작**만 처리하고 **호스트 OS 재부팅**까진 살아남지 못합니다. 재부팅 후 자동 기동이 필요하면 둘 중 선택:

### (a) 가장 간단 — 부팅 시 podman-compose up 자동 실행

dodsas 사용자 systemd unit으로 등록.

```bash
# Podman 호스트(dodsas)에서
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/ysadmin-compose.service <<'EOF'
[Unit]
Description=ysadmin (podman-compose)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/dodsas/work/ysadmin
ExecStart=/usr/bin/podman-compose up -d
ExecStop=/usr/bin/podman-compose down

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now ysadmin-compose.service
systemctl --user status ysadmin-compose.service
```

**2단계의 `enable-linger`가 적용되어 있어야 부팅 시 자동 시작됩니다.**

### (b) `podman generate systemd`로 컨테이너 단위 unit 생성

```bash
cd /home/dodsas/work/ysadmin
podman-compose up -d                            # 일단 한 번 기동
podman generate systemd --new --files --name ysadmin
mv container-ysadmin.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now container-ysadmin.service
```

⚠ 옵션 (b) 적용 시 systemd가 컨테이너 라이프사이클을 직접 관리하므로 향후 배포 시 `deploy.sh`가 손대는 컨테이너와 충돌 가능. 이 경우 옵션 (a) 권장.

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
