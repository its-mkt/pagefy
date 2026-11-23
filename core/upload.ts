// 이미지 호스팅 업로드 규칙 (규칙 6절·6-1) — 로컬 서버·Supabase 함수 공용 (node: 모듈 금지)
// 검증본: ~/.claude/tools/psd2html/upload.js 와 같은 안전장치에 동시 업로드 대비를 더했다
//  - 정해진 폴더에만: <FTP_ROOT>/<채널>/<슬러그>/<rev>/<파일명>, 파일명은 6-1 규칙에 맞는 것만
//  - 폴더 잡기: rev 폴더를 처음 만든 작업만 그 폴더에 올린다. MKD 는 서버에서 한 번에 처리돼 둘이 동시에 만들어도 한쪽만 성공하고,
//    만든 쪽은 표시 파일 .pagefy-<token> 을 남긴다 → 표시가 없는(다른 작업·사람이 쓴) 폴더에는 올리지 않는다
//  - 덮어쓰지 않는다: 같은 이름 파일이 목록·SIZE 어느 쪽에라도 보이면 거절
//  - 올린 뒤 공개 주소를 실제로 열어 200 응답 + 용량 + 내용(SHA-256) 일치 확인 (9절)
//  - 화면 설정의 이미지 공개 주소 루트가 서버 설정(PUBLIC_BASE)과 같을 때만 (HTML 주소와 실제 올린 곳이 어긋나지 않게)
//  - 함수 150초 제한: 마감 시각이 가까우면 남은 파일은 다음 요청으로 넘긴다 (화면이 이어서 보냄)
import { type Dial, FtpClient } from './ftp.ts';

export interface FtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** 상세페이지 이미지 FTP 폴더 (예: /data/detail) */
  root: string;
  /** root 가 웹에서 보이는 주소 (예: https://itketweb.hgodo.com/data/detail) */
  publicBase: string;
}

export interface UploadTarget {
  channel: string;
  slug: string;
  rev: string;
  /** 화면 설정의 이미지 공개 주소 루트 */
  publicRoot: string;
  /** 이 작업의 표시 (같은 작업이 끊겼다 이어 올릴 때 자기 폴더임을 알아본다) — 영문 소문자·숫자 16~40자 */
  token: string;
}

export interface UploadFile {
  file: string;
  /** base64 (data: 접두사 없음) */
  data: string;
}

/** 한 장 최대 크기 (규칙 6절 목표 1MB) — 함수 요청 크기 제한 안에 들게 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 6-1 파일명: s<2자리>_bg<n> / img·ico·gif<n>-<내용> / txt<n>[-<내용>] */
export const UPLOAD_FILE_RE = /^s\d{2}_(bg\d+|(img|ico|gif)\d+-[a-z0-9]+(-[a-z0-9]+)*|txt\d+(-[a-z0-9]+(-[a-z0-9]+)*)?)\.(jpg|png|gif|webp)$/;

const trimSlash = (s: string) => s.replace(/\/+$/, '');
const markerOf = (t: UploadTarget) => `.pagefy-${t.token}`;
/** 올리는 중인 임시 파일 접두사 (숨김 파일이라 목록·충돌 판정에 안 잡힌다) */
const PART = '.part-';

/** 설정이 다 있으면 config, 아니면 null (화면에 업로드 버튼을 숨김) */
export function ftpConfigFrom(get: (k: string) => string | undefined): FtpConfig | null {
  const host = get('HOST');
  const user = get('USER');
  const pass = get('PASS');
  const root = get('ROOT');
  const publicBase = get('PUBLIC_BASE');
  if (!host || !user || !pass || !root || !publicBase) return null;
  return { host, port: Number(get('PORT') || 21), user, pass, root: trimSlash(root.startsWith('/') ? root : `/${root}`), publicBase: trimSlash(publicBase) };
}

/** 요청 값 확인. 문제가 있으면 문구, 없으면 null */
export function checkTarget(cfg: FtpConfig, t: UploadTarget): string | null {
  if (!t || typeof t !== 'object') return '요청 값이 없습니다.';
  if (!/^(itket|oncore|openmarket)$/.test(t.channel || '')) return '채널 값이 올바르지 않습니다.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug || '') || t.slug.length > 80) return '제품슬러그는 영문 소문자·숫자·하이픈만 됩니다.';
  if (!/^\d{8}(-\d{1,3})?$/.test(t.rev || '')) return 'rev 는 20261123 또는 20261123-2 형식이어야 합니다.';
  if (!/^[a-z0-9]{16,40}$/.test(t.token || '')) return '업로드 표시 값이 올바르지 않습니다.';
  if (trimSlash(t.publicRoot || '') !== cfg.publicBase)
    return `이미지 공개 주소 루트가 업로드 서버 주소와 다릅니다 (설정: ${String(t.publicRoot).slice(0, 80)} / 서버: ${cfg.publicBase}). 고급 설정의 주소를 서버 주소로 맞춘 뒤 다시 만드세요.`;
  return null;
}

const folderOf = (cfg: FtpConfig, t: UploadTarget) => `${cfg.root}/${t.channel}/${t.slug}/${t.rev}`;
export const publicUrlOf = (cfg: FtpConfig, t: UploadTarget, file: string) => `${cfg.publicBase}/${t.channel}/${t.slug}/${t.rev}/${file}`;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 확장자와 실제 내용이 맞는지 (JPG·PNG·GIF·WebP 머리 바이트) */
function magicOk(file: string, b: Uint8Array) {
  const ext = file.slice(file.lastIndexOf('.') + 1);
  if (ext === 'jpg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === 'png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === 'gif') return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
  if (ext === 'webp') return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45;
  return false;
}

async function sha256Hex(b: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function session<T>(cfg: FtpConfig, dial: Dial, work: (c: FtpClient) => Promise<T>): Promise<T> {
  const c = new FtpClient(dial, cfg.host, cfg.port);
  try {
    await c.login(cfg.user, cfg.pass);
    return await work(c);
  } finally {
    await c.quit();
  }
}

/**
 * 이 rev 폴더가 서버에 있는지, 이 작업의 폴더(표시 파일 있음)인지, 어떤 파일이 얼마 크기로 있는지.
 * owned=false 인데 exists=true 면 다른 작업·사람의 폴더 → 화면이 새 rev 를 안내한다
 */
export async function checkFolder(cfg: FtpConfig, dial: Dial, t: UploadTarget) {
  const dir = folderOf(cfg, t);
  const base = publicUrlOf(cfg, t, '').replace(/\/$/, '');
  return session(cfg, dial, async (c) => {
    if (!(await c.isDir(dir))) return { exists: false, owned: false, files: [] as { file: string; size: number }[], base };
    const owned = (await c.size(`${dir}/${markerOf(t)}`)) != null;
    const names = (await c.list(dir)).filter((n) => !n.startsWith('.'));
    const files: { file: string; size: number }[] = [];
    for (const n of names.slice(0, 300)) files.push({ file: n, size: (await c.size(`${dir}/${n}`)) ?? -1 });
    return { exists: true, owned, files, base };
  });
}

/**
 * 파일 여러 개 올리기.
 * - rev 폴더를 이 요청이 새로 만들면 표시 파일을 남기고, 이미 있던 폴더면 이 작업의 표시가 있을 때만 올린다
 * - 같은 이름 파일이 있으면 그 파일은 올리지 않고 refused 로 돌려준다 (덮어쓰기 금지)
 * - deadline(ms 시각)이 가까우면 남은 파일은 left 로 돌려준다 (화면이 다음 요청으로 보냄)
 */
export async function putFiles(cfg: FtpConfig, dial: Dial, t: UploadTarget, files: UploadFile[], deadline = Infinity) {
  if (!Array.isArray(files) || !files.length) throw new Error('올릴 파일이 없습니다.');
  if (files.length > 60) throw new Error('한 번에 너무 많은 파일입니다.');
  const items = files.map((f) => {
    if (!UPLOAD_FILE_RE.test(f?.file || '')) throw new Error(`파일명 규칙(6-1) 위반: ${String(f?.file).slice(0, 60)}`);
    if (typeof f.data !== 'string' || !f.data || f.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) throw new Error(`${f.file}: 파일이 비었거나 너무 큽니다 (최대 ${MAX_FILE_BYTES / 1024 / 1024}MB)`);
    const bytes = b64ToBytes(f.data);
    if (!magicOk(f.file, bytes)) throw new Error(`${f.file}: 확장자와 실제 이미지 형식이 다릅니다.`);
    return { file: f.file, bytes };
  });
  const dir = folderOf(cfg, t);
  return session(cfg, dial, async (c) => {
    await c.mkdirs(dir.slice(0, dir.lastIndexOf('/')));
    const created = await c.mkdir(dir);
    const marker = `${dir}/${markerOf(t)}`;
    if (created) await c.put(marker, new Uint8Array(0));
    else if ((await c.size(marker)) == null) throw new Error(`서버의 ${t.rev} 폴더는 다른 작업이 쓰는 폴더라 올리지 않았습니다. 새 번호 rev 로 다시 만드세요.`);
    // 지난번에 끊겨 남은 임시 파일(.part-*)은 이 작업 폴더에서만 지운다 (정식 이름 파일은 건드리지 않음)
    for (const n of await c.list(dir, true)) if (n.startsWith(PART)) await c.remove(`${dir}/${n}`).catch(() => {});
    const listed = new Set(await c.list(dir));
    const done: { file: string; url: string; size: number }[] = [];
    const refused: { file: string; error: string }[] = [];
    const left: string[] = [];
    for (const it of items) {
      if (Date.now() > deadline - 20_000) {
        left.push(it.file);
        continue;
      }
      const path = `${dir}/${it.file}`;
      if (listed.has(it.file) || (await c.size(path)) != null) {
        refused.push({ file: it.file, error: '서버에 같은 이름 파일이 이미 있어 덮어쓰지 않았습니다.' });
        continue;
      }
      // 임시 이름으로 다 올린 뒤 정식 이름으로 바꾼다 — 끊겨도 반쯤 올라간 파일이 정식 이름으로 남아 이어 올리기를 막지 않게
      const tmp = `${dir}/${PART}${it.file}`;
      await c.put(tmp, it.bytes);
      await c.rename(tmp, path);
      listed.add(it.file);
      done.push({ file: it.file, url: publicUrlOf(cfg, t, it.file), size: it.bytes.length });
    }
    return { done, refused, left };
  });
}

/**
 * 잘못 올린 것 되돌리기 — 이 작업이 올린 rev 폴더를 통째로 지운다.
 * 판매 중인 페이지 그림을 지우지 않게 아래가 모두 맞을 때만:
 *  - 폴더에 이 작업의 표시 파일(.pagefy-<token>)이 있다 (이 작업이 처음 만든 폴더)
 *  - 폴더 안 파일이 모두 화면이 보낸 목록(이 결과의 이미지)에 있다 — 하나라도 다른 파일·숨김 파일이 있으면 아무것도 지우지 않는다
 * 마감이 가까우면 남은 파일은 left 로 돌려준다 (화면이 다시 요청). 다 지우면 표시 파일과 폴더도 지운다
 */
export async function removeUpload(cfg: FtpConfig, dial: Dial, t: UploadTarget, files: string[], deadline = Infinity) {
  if (!Array.isArray(files) || !files.length || files.length > 300) throw new Error('지울 파일 목록이 올바르지 않습니다.');
  for (const f of files) if (!UPLOAD_FILE_RE.test(f || '')) throw new Error(`파일명 규칙(6-1) 위반: ${String(f).slice(0, 60)}`);
  const mine = new Set(files);
  const dir = folderOf(cfg, t);
  const marker = markerOf(t);
  return session(cfg, dial, async (c) => {
    if (!(await c.isDir(dir))) return { removed: [] as string[], left: [] as string[], folderRemoved: true };
    if ((await c.size(`${dir}/${marker}`)) == null) throw new Error(`서버의 ${t.rev} 폴더는 이 작업이 올린 폴더가 아니라 지우지 않았습니다.`);
    // 서버가 점 파일도 보여 주면 이 작업의 표시 파일이 "다른 파일"로 잡혀 되돌리기가 늘 거절된다 → 자기 표시는 뺀다
    const visible = (await c.list(dir)).filter((n) => n !== marker);
    const hiddenAll = (await c.list(dir, true)).filter((n) => n.startsWith('.') && n !== marker);
    const parts = hiddenAll.filter((n) => n.startsWith(PART)); // 이 작업이 남긴 임시 파일 — 함께 지운다
    const hidden = hiddenAll.filter((n) => !n.startsWith(PART));
    const other = [...visible.filter((n) => !mine.has(n)), ...hidden];
    if (other.length) throw new Error(`폴더에 이 결과가 아닌 파일이 있어 아무것도 지우지 않았습니다 (${other.slice(0, 3).join(', ')}${other.length > 3 ? ' …' : ''}).`);
    const removed: string[] = [];
    const left: string[] = [];
    for (const n of visible) {
      if (Date.now() > deadline - 20_000) {
        left.push(n);
        continue;
      }
      await c.remove(`${dir}/${n}`);
      removed.push(n);
    }
    if (left.length) return { removed, left, folderRemoved: false };
    for (const n of parts) await c.remove(`${dir}/${n}`).catch(() => {});
    await c.remove(`${dir}/${marker}`);
    await c.rmdir(dir);
    return { removed, left, folderRemoved: true };
  });
}

/** 공개 주소를 실제로 열어 확인 (200 + 용량 + SHA-256). 동시에 4개씩, 마감이 가까우면 남은 것은 checked=false */
export async function verifyFiles(cfg: FtpConfig, t: UploadTarget, files: { file: string; size: number; sha256?: string }[], deadline = Infinity) {
  const list = (Array.isArray(files) ? files : []).filter((f) => UPLOAD_FILE_RE.test(f?.file || '')).slice(0, 60);
  const results: { file: string; url: string; status: number; size: number; ok: boolean; checked: boolean }[] = [];
  const one = async (f: (typeof list)[number]) => {
    const url = publicUrlOf(cfg, t, f.file);
    if (Date.now() > deadline - 15_000) return results.push({ file: f.file, url, status: 0, size: 0, ok: false, checked: false });
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const buf = r.ok ? await r.arrayBuffer() : new ArrayBuffer(0);
      const sameHash = !f.sha256 || (await sha256Hex(buf)) === f.sha256;
      results.push({ file: f.file, url, status: r.status, size: buf.byteLength, ok: r.status === 200 && buf.byteLength === f.size && sameHash, checked: true });
    } catch {
      results.push({ file: f.file, url, status: 0, size: 0, ok: false, checked: true });
    }
  };
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(one));
  return results;
}
