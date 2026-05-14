import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { logger } from './logger.js';

const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '/app/secrets/ssh_key';
const SSH_CONNECT_TIMEOUT_SEC = 5;
const SSH_OVERALL_TIMEOUT_MS = 15000;

async function ensureKey() {
  try {
    await access(SSH_KEY_PATH, constants.R_OK);
  } catch {
    throw new Error(`SSH 키 파일 없음 또는 읽기 불가: ${SSH_KEY_PATH}`);
  }
}

export async function shutdownComputer(computer) {
  const cfg = computer.shutdown || {};
  if (!cfg.enabled) throw new Error('끄기 비활성화 — 설정에서 활성화 필요');
  if (!computer.ip && !computer.lastSeenIp) {
    throw new Error('IP 미등록 — 끄기 전 IP 설정 필요');
  }
  const host = computer.ip || computer.lastSeenIp;
  const sshUser = cfg.sshUser;
  const sshPort = cfg.sshPort || 22;
  const command = cfg.command;
  if (!sshUser) throw new Error('SSH 사용자 미설정');
  if (!command) throw new Error('SSH 명령어 미설정');

  await ensureKey();

  const args = [
    '-i', SSH_KEY_PATH,
    '-p', String(sshPort),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'UserKnownHostsFile=/dev/null',
    `-o`, `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC}`,
    '-o', 'BatchMode=yes',
    '-o', 'LogLevel=ERROR',
    `${sshUser}@${host}`,
    command,
  ];

  logger.info('shutdown', `SSH 끄기 명령 시작`, {
    label: computer.label,
    host,
    user: sshUser,
    port: sshPort,
    command,
  });

  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, SSH_OVERALL_TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      logger.error('shutdown', `spawn 실패`, { error: err.message });
      reject(new Error(`SSH 실행 실패: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      // exit 0: 정상. exit 255: SSH 세션이 끊겼지만 명령은 보냄 (Windows shutdown 등 즉시 종료 케이스).
      if (code === 0 || code === 255) {
        logger.info('shutdown', `끄기 명령 전송 완료`, {
          code,
          stdout: stdout.slice(0, 200),
          stderr: stderr.slice(0, 200),
        });
        resolve({ ok: true, code, stdout, stderr });
      } else {
        logger.error('shutdown', `끄기 명령 실패`, {
          code,
          stderr: stderr.slice(0, 500),
        });
        reject(new Error(`SSH exit ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`));
      }
    });
  });
}
