import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { logger } from './logger.js';

const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '/app/secrets/ssh_key';
const SSH_CONNECT_TIMEOUT_SEC = 5;
const SSH_OVERALL_TIMEOUT_MS = 15000;

async function keyAvailable() {
  try {
    await access(SSH_KEY_PATH, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function maskedArgs(args, env) {
  return args.map((a) => (a === env?.SSHPASS ? '****' : a));
}

export async function shutdownComputer(computer) {
  const cfg = computer.shutdown || {};
  if (!cfg.enabled) throw new Error('끄기 비활성화 — 설정에서 활성화 필요');
  const host = computer.ip || computer.lastSeenIp;
  if (!host) throw new Error('IP 미등록 또는 미감지 — 설정에서 IP 입력 필요');
  const sshUser = cfg.sshUser;
  const sshPort = cfg.sshPort || 22;
  const command = cfg.command;
  const sshPassword = cfg.sshPassword || '';
  if (!sshUser) throw new Error('SSH 사용자 미설정');
  if (!command) throw new Error('SSH 명령어 미설정');

  const usePassword = Boolean(sshPassword);
  const baseSshOptions = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC}`,
    '-o', 'LogLevel=ERROR',
    '-p', String(sshPort),
  ];

  let cmd;
  let args;
  let env = process.env;

  if (usePassword) {
    cmd = 'sshpass';
    args = [
      '-e', // 암호를 SSHPASS 환경변수에서 읽음 (ps 노출 회피)
      'ssh',
      ...baseSshOptions,
      '-o', 'PreferredAuthentications=password',
      '-o', 'PubkeyAuthentication=no',
      `${sshUser}@${host}`,
      command,
    ];
    env = { ...process.env, SSHPASS: sshPassword };
  } else {
    const hasKey = await keyAvailable();
    if (!hasKey) {
      throw new Error(
        `SSH 인증 정보 없음: 암호도 비어있고, 키 파일도 없음(${SSH_KEY_PATH}). ` +
        `설정에서 SSH 암호를 입력하거나, 호스트의 secrets/ssh_key 에 키 배치 필요.`,
      );
    }
    cmd = 'ssh';
    args = [
      '-i', SSH_KEY_PATH,
      ...baseSshOptions,
      '-o', 'BatchMode=yes',
      `${sshUser}@${host}`,
      command,
    ];
  }

  logger.info('shutdown', `SSH 끄기 시도`, {
    label: computer.label,
    target: `${sshUser}@${host}:${sshPort}`,
    auth: usePassword ? 'password' : 'key',
    command,
    spawnCmd: cmd,
    spawnArgs: maskedArgs(args, env),
  });

  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      logger.warn('shutdown', `타임아웃 — 강제 종료`, { timeoutMs: SSH_OVERALL_TIMEOUT_MS });
      child.kill('SIGKILL');
    }, SSH_OVERALL_TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      logger.error('shutdown', `spawn 자체 실패`, { error: err.message, cmd });
      reject(new Error(`SSH 실행 실패: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - started;
      const stdoutPreview = stdout.slice(0, 500);
      const stderrPreview = stderr.slice(0, 500);

      // sshpass exit codes:
      //   0: success
      //   1: invalid command line
      //   2: conflicting arguments
      //   3: general runtime error
      //   4: unrecognized response
      //   5: invalid/incorrect password
      //   6: host public key is unknown (StrictHostKeyChecking)
      //   non-zero from ssh itself: ssh's exit code passed through
      // ssh exit codes:
      //   0: success
      //   255: SSH error (예: 연결 끊김 — 윈도우 shutdown 명령 후 SSH 세션이 즉시 끊기는 정상 케이스)
      //   기타: 원격 명령의 exit code

      if (code === 0 || code === 255) {
        logger.info('shutdown', `끄기 명령 전송 성공`, {
          code,
          elapsedMs,
          stdout: stdoutPreview,
          stderr: stderrPreview,
          note: code === 255 ? 'SSH 세션 끊김 (정상 — 원격이 즉시 종료)' : 'OK',
        });
        resolve({ ok: true, code, elapsedMs, stdout: stdoutPreview, stderr: stderrPreview });
      } else {
        const hint = guessFailureCause(code, stderrPreview, usePassword);
        logger.error('shutdown', `끄기 명령 실패`, {
          code,
          elapsedMs,
          stderr: stderrPreview,
          stdout: stdoutPreview,
          hint,
        });
        reject(new Error(`SSH 실패 (exit ${code}): ${hint || stderrPreview || stdoutPreview || 'no output'}`));
      }
    });
  });
}

function guessFailureCause(code, stderr, usePassword) {
  const s = (stderr || '').toLowerCase();
  if (usePassword && code === 5) return 'sshpass: 암호 오류';
  if (s.includes('permission denied')) {
    return usePassword
      ? '암호 거부됨 — 사용자명/암호 확인, Windows 면 OpenSSH 서버 설치+활성화 확인'
      : '키 거부됨 — 공개키가 대상의 authorized_keys 에 등록됐는지 확인';
  }
  if (s.includes('connection refused')) return 'SSH 포트 막힘 — 대상의 sshd 가 실행 중인지, 방화벽 확인';
  if (s.includes('connection timed out') || s.includes('no route to host')) {
    return 'LAN 미도달 — IP/네트워크 확인 (대상 켜져있는지)';
  }
  if (s.includes('host key verification failed')) return '호스트 키 검증 실패 (UserKnownHostsFile 오류)';
  if (s.includes('no matching') || s.includes('algorithm negotiation')) return 'SSH 알고리즘 호환 문제';
  if (code === 127) return 'sshpass 미설치? (Dockerfile 확인 필요)';
  return null;
}
