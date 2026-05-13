# 배포 가이드

**Git push → Jenkins webhook → SSH → Podman 호스트** 자동 배포.

- 대상 사용자: `dodsas` (기존 계정)
- 원격 작업 디렉토리: `/home/dodsas/work/ysadmin`
- 트리거: `main` 브랜치 push (다른 브랜치는 건너뜀)

## 1. 사전 준비 (1회)

### 1-1. Podman 호스트 (`dodsas`로 로그인 상태에서)

```bash
# rootless 컨테이너가 로그아웃/세션 종료 후에도 유지되도록
sudo loginctl enable-linger dodsas

# Podman 동작 확인
podman --version    # 4.9.4-rhel

# 작업 디렉토리 미리 생성 (Jenkins가 만들기도 하지만 권한 명확화 차원)
mkdir -p /home/dodsas/work/ysadmin
```

### 1-2. SSH 키 등록

Jenkins → dodsas 단방향 SSH 키.

```bash
# Jenkins 서버 (jenkins 사용자)에서
ssh-keygen -t ed25519 -f ~/.ssh/ysadmin_deploy -N ''

# 공개키를 dodsas에 등록
ssh-copy-id -i ~/.ssh/ysadmin_deploy.pub dodsas@<podman-host>
```

Jenkins **Manage Jenkins → Credentials**에 Private Key (`~/.ssh/ysadmin_deploy`)를 등록:
- Kind: **SSH Username with private key**
- ID: **`ysadmin-deploy-ssh`**
- Username: **`dodsas`**

### 1-3. Jenkins Pipeline 잡 생성

- **New Item → Pipeline** 생성 (이름 예: `ysadmin-deploy`)
- **Pipeline → Definition: Pipeline script from SCM**
  - SCM: Git
  - Repository URL: 이 저장소 URL
  - Branch: `*/main` (또는 빈 값 = 전체)
  - Script Path: `Jenkinsfile`
- **Build Triggers**:
  - ☑ `GitHub hook trigger for GITScm polling` (GitHub 사용 시)
  - 또는 `Poll SCM` (자동, 2분 주기로 백업 동작)
- 첫 실행은 수동(**Build with Parameters**)으로 한 번 — 파라미터 기본값 검토
  - `DEPLOY_HOST`: Podman 호스트 명/IP
  - `DEPLOY_USER`: `dodsas` (기본)
  - `REMOTE_DIR`: `/home/dodsas/work/ysadmin` (기본)
  - `HOST_PORT`: `3000`
  - `DEPLOY_BRANCH`: `main`

### 1-4. Git 저장소 Webhook

**GitHub의 경우**: 저장소 **Settings → Webhooks → Add webhook**
- Payload URL: `http://<jenkins>:8080/github-webhook/`
- Content type: `application/json`
- Events: `Just the push event`

**GitLab의 경우**: 저장소 **Settings → Webhooks**
- URL: `http://<jenkins>:8080/project/ysadmin-deploy`
- Trigger: `Push events`
- (사내 Jenkins라면 GitLab Plugin 설치 필요)

**사내 자체 호스팅 / 방화벽으로 webhook 불가**: `Poll SCM`만 활성화. 최대 2분 지연 발생하지만 무인 자동 배포 자체는 동작.

## 2. 일상 운영

```bash
git push origin main    # ← 이것만으로 배포 완료
```

`main` 외 브랜치 push는 Jenkins가 빌드는 시작하더라도 `when` 가드로 배포 단계가 건너뛰어집니다. PR 머지 단계에서 자연스럽게 운영 반영.

수동 배포가 필요하면 Jenkins에서 **Build with Parameters** 실행.

## 3. 호스트 재부팅에도 살아남기 (선택, 권장)

`--restart=always`는 Podman 데몬 차원 재시작만 처리합니다. **호스트 OS 재부팅 후 자동 기동**이 필요하면 Quadlet으로 systemd에 등록.

```bash
# dodsas 사용자로
mkdir -p ~/.config/containers/systemd
cp /home/dodsas/work/ysadmin/deploy/ysadmin.container ~/.config/containers/systemd/

systemctl --user daemon-reload
systemctl --user start ysadmin.service
systemctl --user enable ysadmin.service     # linger와 함께 부팅 시 자동 기동
systemctl --user status ysadmin.service
```

⚠ 주의: Quadlet 사용 시 `deploy.sh`의 `podman run`과 Quadlet이 만든 컨테이너가 같은 이름(`ysadmin`)을 쓰려고 해 충돌합니다. 둘 중 하나만 운영하거나, Quadlet 채택 시 `deploy.sh`의 `podman run` 블록을 `systemctl --user restart ysadmin.service`로 교체해야 합니다.

지금은 우선 `--restart=always`로 운영하고, 운영 안정화 후 Quadlet 전환을 권장.

## 4. 운영 명령어

```bash
podman ps --filter name=ysadmin                 # 상태 확인
podman logs -f ysadmin                          # 로그 추적
podman exec -it ysadmin sh                      # 컨테이너 진입
podman volume inspect ysadmin-data              # 볼륨 경로
podman volume export ysadmin-data > backup.tar  # 데이터 백업
```

## 5. 롤백

```bash
git revert <bad-commit>
git push origin main    # 자동 재배포
```

이미지는 매 빌드마다 새로 만들어지므로 별도 태그/레지스트리 없으면 git 측에서 롤백. 빌드 번호별 태그 보관이 필요해지면 `Jenkinsfile`에 `podman tag localhost/ysadmin:latest localhost/ysadmin:${BUILD_NUMBER}` 한 줄 추가 + 보관 정책 정의.

## Webhook vs 수동 트리거 트레이드오프

- ✅ **장점**: 배포 절차가 git 흐름과 일치, 사람 실수 없음, 어떤 커밋이 배포되었는지 git 이력과 1:1 매칭
- ⚠ **주의**: `main`에 잘못된 코드가 머지되면 즉시 운영 반영됨 → PR/리뷰 가드 필수, 또는 `release` 브랜치를 별도 배포 대상으로 두는 것도 가능 (`DEPLOY_BRANCH` 파라미터 변경)
