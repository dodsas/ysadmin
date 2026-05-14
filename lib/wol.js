import dgram from 'node:dgram';

const WOL_PORTS = [9, 7];
const DEFAULT_BROADCAST = process.env.WOL_BROADCAST || '255.255.255.255';

export function normalizeMac(input) {
  if (typeof input !== 'string') throw new Error('MAC은 문자열이어야 합니다.');
  const cleaned = input.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (cleaned.length !== 12) throw new Error('MAC 주소 형식이 올바르지 않습니다.');
  return cleaned.match(/.{2}/g).join('-');
}

function buildMagicPacket(mac) {
  const cleaned = mac.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length !== 12) throw new Error('잘못된 MAC: ' + mac);
  const macBytes = Buffer.from(cleaned, 'hex');
  const sync = Buffer.alloc(6, 0xff);
  const repeated = Buffer.concat(Array(16).fill(macBytes));
  return Buffer.concat([sync, repeated]);
}

export async function sendMagicPacket(mac, broadcastAddr = DEFAULT_BROADCAST) {
  const packet = buildMagicPacket(mac);
  const sock = dgram.createSocket('udp4');
  try {
    await new Promise((res, rej) => {
      sock.once('error', rej);
      sock.bind(0, () => {
        sock.setBroadcast(true);
        res();
      });
    });
    for (const port of WOL_PORTS) {
      await new Promise((res, rej) => {
        sock.send(packet, port, broadcastAddr, (err) => (err ? rej(err) : res()));
      });
    }
  } finally {
    sock.close();
  }
}
