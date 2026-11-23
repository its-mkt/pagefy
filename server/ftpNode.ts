// core/ftp.ts 용 Node 소켓 + 이미지 호스팅 접속 정보 (로컬 서버 전용)
// 접속 정보: 환경변수 PAGEFY_FTP_HOST·USER·PASS·ROOT·PUBLIC_BASE(·PORT) → 없으면 각자 PC 의
// ~/.claude/secrets/nhn-image-ftp.env (FTP_HOST·FTP_USER·FTP_PASS·FTP_ROOT·PUBLIC_BASE, 규칙 6절) 를 읽는다. 값은 출력하지 않는다.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Dial, Sock } from '../core/ftp.ts';
import { type FtpConfig, ftpConfigFrom } from '../core/upload.ts';

export const nodeDial: Dial = (host, port) =>
  new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const chunks: Uint8Array[] = [];
    const waiters: ((c: Uint8Array | null) => void)[] = [];
    let ended = false;
    let failed: Error | null = null;
    s.on('data', (c: Buffer) => {
      const u = new Uint8Array(c);
      const w = waiters.shift();
      if (w) w(u);
      else chunks.push(u);
    });
    const finish = () => {
      ended = true;
      while (waiters.length) waiters.shift()!(null);
    };
    s.on('end', finish);
    s.on('close', finish);
    s.once('error', (e) => {
      failed = e;
      finish();
      reject(e);
    });
    s.once('connect', () => {
      const sock: Sock = {
        write: (b) => new Promise((res, rej) => s.write(b, (e) => (e ? rej(e) : res()))),
        read: () => {
          if (chunks.length) return Promise.resolve(chunks.shift()!);
          if (ended) return failed ? Promise.reject(failed) : Promise.resolve(null);
          return new Promise((res) => waiters.push(res));
        },
        close: () =>
          new Promise((res) => {
            if (s.destroyed) return res();
            s.end(() => res());
            setTimeout(() => {
              s.destroy();
              res();
            }, 5000).unref();
          }),
      };
      resolve(sock);
    });
  });

function readSecretsFile(): Record<string, string> {
  const file = path.join(os.homedir(), '.claude', 'secrets', 'nhn-image-ftp.env');
  const out: Record<string, string> = {};
  try {
    for (const ln of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      // KEY=값 · KEY="값" · KEY='값'. 주석은 앞에 공백이 있는 " #" 부터만 (비밀번호 안의 # 를 자르지 않게)
      const m = /^\s*([A-Z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(.*?))(?:\s+#.*)?\s*$/.exec(ln);
      if (m) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
    }
  } catch {
    // 파일이 없으면 업로드 기능을 끈다
  }
  return out;
}

/** 로컬 서버의 업로드 설정 (없으면 null → 화면에 업로드 버튼 없음) */
export function localFtpConfig(): FtpConfig | null {
  const file = readSecretsFile();
  return ftpConfigFrom((k) => process.env[`PAGEFY_FTP_${k}`] || (k === 'PUBLIC_BASE' ? process.env.PAGEFY_PUBLIC_BASE || file.PUBLIC_BASE : file[`FTP_${k}`]));
}
