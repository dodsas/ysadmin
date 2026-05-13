pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    string(name: 'DEPLOY_HOST', defaultValue: 'podman-host.internal', description: '배포 대상 서버 (호스트명 또는 IP)')
    string(name: 'DEPLOY_USER', defaultValue: 'dodsas', description: 'SSH 사용자')
    string(name: 'REMOTE_DIR', defaultValue: '/home/dodsas/work/ysadmin', description: '원격 작업 디렉토리')
    string(name: 'HOST_PORT', defaultValue: '3000', description: '호스트 노출 포트')
    string(name: 'PING_INTERVAL_MS', defaultValue: '600000', description: '핑 주기 (ms)')
    string(name: 'DEPLOY_BRANCH', defaultValue: 'main', description: '자동 배포 대상 브랜치')
  }

  environment {
    APP_NAME = 'ysadmin'
    SSH_CRED = 'ysadmin-deploy-ssh'
  }

  triggers {
    githubPush()
    pollSCM('H/2 * * * *')
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.GIT_BRANCH_NAME = sh(returnStdout: true, script: "git rev-parse --abbrev-ref HEAD").trim()
          echo "체크아웃된 브랜치: ${env.GIT_BRANCH_NAME}"
        }
      }
    }

    stage('Package') {
      when {
        anyOf {
          expression { env.BRANCH_NAME == params.DEPLOY_BRANCH }
          expression { env.GIT_BRANCH_NAME == params.DEPLOY_BRANCH }
          expression { env.BRANCH_NAME == null && env.GIT_BRANCH_NAME == 'HEAD' }
        }
      }
      steps {
        sh '''
          set -e
          rm -f ${APP_NAME}.tar.gz
          tar --exclude='./node_modules' \
              --exclude='./data' \
              --exclude='./.git' \
              --exclude='./.idea' \
              -czf ${APP_NAME}.tar.gz .
          ls -lh ${APP_NAME}.tar.gz
        '''
      }
    }

    stage('Transfer') {
      when {
        anyOf {
          expression { env.BRANCH_NAME == params.DEPLOY_BRANCH }
          expression { env.GIT_BRANCH_NAME == params.DEPLOY_BRANCH }
          expression { env.BRANCH_NAME == null && env.GIT_BRANCH_NAME == 'HEAD' }
        }
      }
      steps {
        sshagent(credentials: [env.SSH_CRED]) {
          sh '''
            set -e
            ssh -o StrictHostKeyChecking=accept-new ${DEPLOY_USER}@${DEPLOY_HOST} "mkdir -p ${REMOTE_DIR}"
            scp -o StrictHostKeyChecking=accept-new ${APP_NAME}.tar.gz ${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}/
            ssh -o StrictHostKeyChecking=accept-new ${DEPLOY_USER}@${DEPLOY_HOST} "
              set -e
              cd ${REMOTE_DIR}
              tar -xzf ${APP_NAME}.tar.gz
              rm -f ${APP_NAME}.tar.gz
              chmod +x deploy/deploy.sh
            "
          '''
        }
      }
    }

    stage('Deploy') {
      when {
        anyOf {
          expression { env.BRANCH_NAME == params.DEPLOY_BRANCH }
          expression { env.GIT_BRANCH_NAME == params.DEPLOY_BRANCH }
          expression { env.BRANCH_NAME == null && env.GIT_BRANCH_NAME == 'HEAD' }
        }
      }
      steps {
        sshagent(credentials: [env.SSH_CRED]) {
          sh '''
            set -e
            ssh -o StrictHostKeyChecking=accept-new ${DEPLOY_USER}@${DEPLOY_HOST} "
              export APP_NAME=${APP_NAME}
              export APP_DIR=${REMOTE_DIR}
              export HOST_PORT=${HOST_PORT}
              export PING_INTERVAL_MS=${PING_INTERVAL_MS}
              bash ${REMOTE_DIR}/deploy/deploy.sh
            "
          '''
        }
      }
    }

    stage('Smoke Test') {
      when {
        anyOf {
          expression { env.BRANCH_NAME == params.DEPLOY_BRANCH }
          expression { env.GIT_BRANCH_NAME == params.DEPLOY_BRANCH }
          expression { env.BRANCH_NAME == null && env.GIT_BRANCH_NAME == 'HEAD' }
        }
      }
      steps {
        sshagent(credentials: [env.SSH_CRED]) {
          sh '''
            set -e
            ssh -o StrictHostKeyChecking=accept-new ${DEPLOY_USER}@${DEPLOY_HOST} "
              curl -fsS http://127.0.0.1:${HOST_PORT}/api/health
            "
          '''
        }
      }
    }
  }

  post {
    success {
      echo "✓ 배포 성공: http://${params.DEPLOY_HOST}:${params.HOST_PORT}"
    }
    failure {
      echo "✗ 배포 실패. 콘솔 로그 확인 필요"
    }
    always {
      sh 'rm -f ${APP_NAME}.tar.gz || true'
    }
  }
}
