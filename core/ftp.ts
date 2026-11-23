// 아주 작은 FTP 클라이언트 (로컬 서버 Node · Supabase 함수 Deno 공용 — node: 모듈 금지, 소켓은 밖에서 넣어 준다)
// 이미지 호스팅(고도 웹호스팅)이 암호화 없는 일반 FTP 만 받는다 (FTPS·SFTP 없음, 2026-11-23 확인) → 규칙 6절.
// 쓰는 명령만: USER/PASS, TYPE I, PASV, MKD, CWD, SIZE, NLST, STOR, QUIT (DELE·RMD 는 점검 정리용)
// 비밀번호는 오류 문구·로그에 절대 넣지 않는다.
// 오류가 한 번 나면 이 연결은 "고장"으로 보고 더 읽지 않는다 (시간 초과로 버린 읽기가 다음 응답을 가로채지 않게).

export interface Sock {
  write(b: Uint8Array): Promise<void>;
  /** 받은 바이트, 끝나면 null */
  read(): Promise<Uint8Array | null>;
  /** 보낼 것을 다 보내고 닫는다 */
  close(): Promise<void>;
}
export type Dial = (host: string, port: number) => Promise<Sock>;

interface Reply {
  code: number;
  text: string;
}

const enc = new TextEncoder();
const TIMEOUT = 30_000;

function withTimeout<T>(p: Promise<T>, what: string, ms = TIMEOUT): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`이미지 서버 응답 없음 (${what})`)), ms)))]).finally(() => clearTimeout(t));
}

/** 접속에 시간 제한. 늦게라도 연결되면 바로 닫는다 (버려진 소켓이 남지 않게) */
function dialWithin(dial: Dial, host: string, port: number, what: string): Promise<Sock> {
  let late = false;
  const p = dial(host, port);
  p.then((s) => {
    if (late) s.close().catch(() => {});
  }).catch(() => {});
  return withTimeout(p, what).catch((e) => {
    late = true;
    throw e;
  });
}

export class FtpClient {
  private ctrl: Sock | null = null;
  private buf = '';
  private broken = false;
  /** 연결마다 따로 (여러 바이트 글자가 읽기 사이에 잘려도 다른 연결의 응답에 섞이지 않게) */
  private dec = new TextDecoder();

  constructor(
    private dial: Dial,
    private host: string,
    private port = 21,
  ) {}

  private fail(e: unknown): never {
    this.broken = true;
    throw e;
  }

  /** 줄 하나 (CRLF 제외) */
  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf('\n');
      if (i >= 0) {
        const l = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        return l;
      }
      let chunk: Uint8Array | null;
      try {
        chunk = await withTimeout(this.ctrl!.read(), '응답 읽기');
      } catch (e) {
        this.fail(e);
      }
      if (!chunk) this.fail(new Error('이미지 서버가 연결을 끊었습니다.'));
      this.buf += this.dec.decode(chunk, { stream: true });
    }
  }

  /** 응답 하나 (여러 줄 응답 "123-…" ~ "123 …" 포함) */
  private async reply(): Promise<Reply> {
    const first = await this.line();
    const m = /^(\d{3})([ -])/.exec(first);
    if (!m) this.fail(new Error(`이미지 서버 응답을 이해하지 못했습니다 (${first.slice(0, 3)})`));
    let text = first.slice(4);
    if (m[2] === '-') {
      for (;;) {
        const l = await this.line();
        text += `\n${l}`;
        if (l.startsWith(`${m[1]} `)) break;
      }
    }
    return { code: Number(m[1]), text };
  }

  /** 명령 보내고 응답. ok 에 없는 코드면 오류 (오류 문구에는 명령 이름과 응답 코드만 — 경로·응답 본문은 넣지 않음) */
  private async cmd(line: string, ok: number[]): Promise<Reply> {
    if (this.broken) throw new Error('이미지 서버 연결이 끊겼습니다.');
    try {
      await this.ctrl!.write(enc.encode(`${line}\r\n`));
    } catch (e) {
      this.fail(e);
    }
    const r = await this.reply();
    if (!ok.includes(r.code)) throw new Error(`이미지 서버가 거절했습니다 (${line.split(' ')[0]} ${r.code})`);
    return r;
  }

  async login(user: string, pass: string) {
    this.ctrl = await dialWithin(this.dial, this.host, this.port, '접속');
    const hello = await this.reply();
    if (hello.code !== 220) this.fail(new Error(`이미지 서버 접속 실패 (${hello.code})`));
    const u = await this.cmd(`USER ${user}`, [230, 331]);
    if (u.code === 331) {
      try {
        await this.cmd(`PASS ${pass}`, [230]);
      } catch {
        this.fail(new Error('이미지 서버 로그인 실패 — 아이디·비밀번호(비밀값)를 확인하세요.'));
      }
    }
    await this.cmd('TYPE I', [200]);
  }

  /** 수동(passive) 데이터 연결. 서버가 알려 준 IP 대신 접속한 호스트 이름을 쓴다 (다른 곳으로 돌리기 방지) */
  private async data(): Promise<Sock> {
    const r = await this.cmd('PASV', [227]);
    const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(r.text);
    if (!m) this.fail(new Error('이미지 서버 수동 연결 응답을 읽지 못했습니다.'));
    try {
      return await dialWithin(this.dial, this.host, Number(m[5]) * 256 + Number(m[6]), '데이터 연결');
    } catch (e) {
      this.fail(e);
    }
  }

  /** 폴더가 있으면 true */
  async isDir(path: string): Promise<boolean> {
    const r = await this.cmd(`CWD ${path}`, [250, 550]);
    if (r.code === 250) await this.cmd('CWD /', [250]);
    return r.code === 250;
  }

  /** 파일 크기, 없으면 null */
  async size(path: string): Promise<number | null> {
    const r = await this.cmd(`SIZE ${path}`, [213, 550]);
    return r.code === 213 ? Number(r.text.trim()) : null;
  }

  /** 폴더 안 파일 이름들 (없거나 비었으면 빈 목록). all = 점(.)으로 시작하는 숨김 파일까지 (NLST -a) */
  async list(dir: string, all = false): Promise<string[]> {
    const d = await this.data();
    let raw = '';
    const listDec = new TextDecoder(); // 목록은 데이터 연결마다 새로
    try {
      const r = await this.cmd(`NLST ${all ? '-a ' : ''}${dir}`, [125, 150, 450, 550]);
      if (r.code === 450 || r.code === 550) return []; // 데이터 연결을 쓰지 않은 응답 — 읽지 않고 닫는다
      for (let c = await withTimeout(d.read(), '목록 읽기'); c; c = await withTimeout(d.read(), '목록 읽기')) raw += listDec.decode(c, { stream: true });
    } catch (e) {
      this.fail(e);
    } finally {
      await d.close().catch(() => {});
    }
    const done = await this.reply();
    if (![226, 250].includes(done.code)) this.fail(new Error(`목록 읽기 실패 (${done.code})`));
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim().split('/').pop() || '')
      .filter((s) => s && s !== '.' && s !== '..');
  }

  /** 폴더 하나 만들기 — 새로 만들었으면 true, 이미 있었으면 false (MKD 는 서버에서 한 번에 처리돼 동시에 불러도 한 곳만 true) */
  async mkdir(path: string): Promise<boolean> {
    const r = await this.cmd(`MKD ${path}`, [257, 550, 521]);
    return r.code === 257;
  }

  /** 폴더를 단계별로 만든다 (이미 있으면 그대로) */
  async mkdirs(path: string) {
    let cur = '';
    for (const part of path.split('/').filter(Boolean)) {
      cur += `/${part}`;
      await this.mkdir(cur);
    }
  }

  async put(path: string, bytes: Uint8Array) {
    const d = await this.data();
    try {
      await this.cmd(`STOR ${path}`, [125, 150]);
      for (let i = 0; i < bytes.length; i += 64 * 1024) await withTimeout(d.write(bytes.subarray(i, i + 64 * 1024)), '파일 보내기');
    } catch (e) {
      await d.close().catch(() => {});
      this.fail(e);
    }
    await d.close();
    const done = await this.reply();
    if (![226, 250].includes(done.code)) this.fail(new Error(`파일 올리기 실패 (${done.code})`));
  }

  /** 지우기 — 서비스에서는 core/upload.ts removeUpload(이 작업이 올린 폴더 되돌리기)에서만 쓴다 */
  async remove(path: string) {
    await this.cmd(`DELE ${path}`, [250]);
  }
  async rmdir(path: string) {
    await this.cmd(`RMD ${path}`, [250]);
  }

  /** 끝내기. 고장 난 연결이면 QUIT 을 보내지 않고 바로 닫는다 (응답을 30초 기다리지 않게) */
  async quit() {
    if (!this.broken && this.ctrl) {
      try {
        await withTimeout(this.cmd('QUIT', [221]), '종료', 5000);
      } catch {
        // 끊어도 됨
      }
    }
    await this.ctrl?.close().catch(() => {});
    this.ctrl = null;
  }
}
