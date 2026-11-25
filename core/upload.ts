// 이미지 호스팅 업로드 규칙 (규칙 6절·6-1) — 로컬 서버·Supabase 함수 공용 (node: 모듈 금지)
// 검증본: ~/.claude/tools/psd2html/upload.js 와 같은 안전장치를 바탕으로 한다
//  - 정해진 폴더에만: <FTP_ROOT>/<채널>/<슬러그>/<파일명>, 오픈마켓은 <FTP_ROOT>/openmarket/<플랫폼>/<슬러그>/<파일명>
//    (규칙 6-1: 2026-11-24 날짜(rev) 폴더 없음 · 2026-11-25 오픈마켓 플랫폼 폴더 — shared/types.ts imageFolder), 파일명은 6-1 규칙에 맞는 것만
//  - 덮어쓰기는 화면이 확인받은 파일만: 같은 이름 파일이 있는데 overwrite 목록에 없으면 거절 (확인 사이에 다른 사람이 올린 것을 덮지 않게)
//  - 덮어쓸 때는 옛 파일을 같은 폴더의 숨김 백업 .bak-<YYYYMMDD-HHmmss>-<파일명> 으로 옮겨 두고 새 파일을 올린다 (되돌리기에 씀)
//  - 올린 뒤 공개 주소를 실제로 열어 200 응답 + 용량 + 내용(SHA-256) 일치 확인 (9절)
//  - 화면 설정의 이미지 공개 주소 루트가 서버 설정(PUBLIC_BASE)과 같을 때만 (HTML 주소와 실제 올린 곳이 어긋나지 않게)
//  - 함수 150초 제한: 마감 시각이 가까우면 남은 파일은 다음 요청으로 넘긴다 (화면이 이어서 보냄)
import { type Dial, FtpClient } from './ftp.ts';
import { imageFolder } from '../shared/types.ts';
import { MARKETS } from '../shared/markets.ts';

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
  /** 오픈마켓 플랫폼 (channel 이 openmarket 일 때 폴더 한 단계 — 반드시 있어야 함) */
  market?: string;
  /** 화면 설정의 이미지 공개 주소 루트 */
  publicRoot: string;
}

export interface UploadFile {
  file: string;
  /** base64 (data: 접두사 없음) */
  data: string;
}

/** 올린 파일 하나 — backup 이 있으면 같은 이름 파일을 덮어쓴 것 (옛 파일은 그 숨김 이름으로 보관) */
export interface UploadedItem {
  file: string;
  backup?: string;
}

/** 한 장 최대 크기 (규칙 6절 목표 1MB) — 함수 요청 크기 제한 안에 들게 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 6-1 파일명: s<2자리>_bg<n> / img·ico·gif<n>-<내용> / txt<n>[-<내용>] */
export const UPLOAD_FILE_RE = /^s\d{2}_(bg\d+|(img|ico|gif)\d+-[a-z0-9]+(-[a-z0-9]+)*|txt\d+(-[a-z0-9]+(-[a-z0-9]+)*)?)\.(jpg|png|gif|webp)$/;

const trimSlash = (s: string) => s.replace(/\/+$/, '');
/** 올리는 중인 임시 파일 접두사 (숨김 파일이라 목록·충돌 판정에 안 잡힌다) */
const PART = '.part-';
/** 덮어쓴 옛 파일 보관 이름: .bak-<YYYYMMDD-HHmmss>-<파일명> */
const BACKUP_RE = /^\.bak-\d{8}-\d{6}-(.+)$/;

/** 지금 시각(KST) YYYYMMDD-HHmmss */
function stampKst() {
  const d = new Date(Date.now() + 9 * 3600_000).toISOString();
  return `${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}`;
}

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
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug || '') || t.slug.length > 80) return '서버 폴더 이름(제품슬러그)은 영문 소문자·숫자·하이픈만 됩니다.';
  // 오픈마켓은 플랫폼 폴더가 꼭 있어야 한다 — 없거나 모르는 값을 기본 플랫폼으로 바꿔 올리면 다른 플랫폼 파일을 덮을 수 있다
  if (t.channel === 'openmarket' && !(typeof t.market === 'string' && Object.hasOwn(MARKETS, t.market))) return '오픈마켓 플랫폼 값이 없거나 올바르지 않습니다.';
  if (trimSlash(t.publicRoot || '') !== cfg.publicBase)
    return `이미지 공개 주소 루트가 업로드 서버 주소와 다릅니다 (설정: ${String(t.publicRoot).slice(0, 80)} / 서버: ${cfg.publicBase}). 고급 설정의 주소를 서버 주소로 맞춘 뒤 다시 만드세요.`;
  return null;
}

/** 제품 폴더 (루트 아래 경로는 화면의 이미지 주소와 같은 규칙 — shared/types.ts imageFolder) */
const pathOf = (t: UploadTarget) => imageFolder({ channel: t.channel as 'itket' | 'oncore' | 'openmarket', slug: t.slug, market: t.market });
const folderOf = (cfg: FtpConfig, t: UploadTarget) => `${cfg.root}/${pathOf(t)}`;
export const publicUrlOf = (cfg: FtpConfig, t: UploadTarget, file: string) => `${cfg.publicBase}/${pathOf(t)}/${file}`;

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

/** 제품 폴더가 서버에 있는지, 어떤 파일이 얼마 크기로 있는지 (숨김 백업·임시 파일은 빼고) */
export async function checkFolder(cfg: FtpConfig, dial: Dial, t: UploadTarget) {
  const dir = folderOf(cfg, t);
  const base = publicUrlOf(cfg, t, '').replace(/\/$/, '');
  return session(cfg, dial, async (c) => {
    if (!(await c.isDir(dir))) return { exists: false, files: [] as { file: string; size: number }[], base };
    const names = (await c.list(dir)).filter((n) => !n.startsWith('.'));
    const files: { file: string; size: number }[] = [];
    for (const n of names.slice(0, 300)) files.push({ file: n, size: (await c.size(`${dir}/${n}`)) ?? -1 });
    return { exists: true, files, base };
  });
}

/**
 * 파일 여러 개 올리기.
 * - 같은 이름 파일이 있으면 overwrite 목록(화면이 담당자에게 확인받은 것)에 있을 때만 덮어쓰고, 없으면 refused 로 돌려준다
 * - 덮어쓸 때는 옛 파일을 .bak-<시각>-<파일명> 으로 옮겨 두고(done[].backup) 새 파일을 그 이름으로 올린다
 * - deadline(ms 시각)이 가까우면 남은 파일은 left 로 돌려준다 (화면이 다음 요청으로 보냄)
 */
export async function putFiles(cfg: FtpConfig, dial: Dial, t: UploadTarget, files: UploadFile[], overwrite: string[] = [], deadline = Infinity) {
  if (!Array.isArray(files) || !files.length) throw new Error('올릴 파일이 없습니다.');
  if (files.length > 60) throw new Error('한 번에 너무 많은 파일입니다.');
  if (!Array.isArray(overwrite) || overwrite.length > 300 || overwrite.some((f) => !UPLOAD_FILE_RE.test(f || ''))) throw new Error('덮어쓸 파일 목록이 올바르지 않습니다.');
  const allowed = new Set(overwrite);
  const items = files.map((f) => {
    if (!UPLOAD_FILE_RE.test(f?.file || '')) throw new Error(`파일명 규칙(6-1) 위반: ${String(f?.file).slice(0, 60)}`);
    if (typeof f.data !== 'string' || !f.data || f.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) throw new Error(`${f.file}: 파일이 비었거나 너무 큽니다 (최대 ${MAX_FILE_BYTES / 1024 / 1024}MB)`);
    const bytes = b64ToBytes(f.data);
    if (!magicOk(f.file, bytes)) throw new Error(`${f.file}: 확장자와 실제 이미지 형식이 다릅니다.`);
    return { file: f.file, bytes };
  });
  const dir = folderOf(cfg, t);
  const stamp = stampKst();
  return session(cfg, dial, async (c) => {
    await c.mkdirs(dir);
    const listed = new Set(await c.list(dir));
    const done: (UploadedItem & { url: string; size: number })[] = [];
    const refused: { file: string; error: string }[] = [];
    const left: string[] = [];
    for (const it of items) {
      if (Date.now() > deadline - 20_000) {
        left.push(it.file);
        continue;
      }
      const path = `${dir}/${it.file}`;
      const exists = listed.has(it.file) || (await c.size(path)) != null;
      if (exists && !allowed.has(it.file)) {
        refused.push({ file: it.file, error: '서버에 같은 이름 파일이 있습니다. 덮어쓰기 확인 후 다시 올리세요.' });
        continue;
      }
      // 임시 이름으로 다 올린 뒤 정식 이름으로 바꾼다 — 끊겨도 반쯤 올라간 파일이 정식 이름으로 남지 않게
      const tmp = `${dir}/${PART}${it.file}`;
      await c.put(tmp, it.bytes);
      let backup: string | undefined;
      if (exists) {
        backup = `.bak-${stamp}-${it.file}`;
        await c.rename(path, `${dir}/${backup}`);
      }
      await c.rename(tmp, path);
      listed.add(it.file);
      done.push({ file: it.file, url: publicUrlOf(cfg, t, it.file), size: it.bytes.length, ...(backup ? { backup } : {}) });
    }
    return { done, refused, left };
  });
}

/**
 * 잘못 올린 것 되돌리기 — 이번에 올린 파일만 (화면이 기억한 목록).
 *  - 덮어쓴 파일(backup 있음): 지금 파일을 지우고 백업을 원래 이름으로 되돌린다 (백업이 없으면 그 파일은 건드리지 않고 failed)
 *  - 새로 올린 파일: 지운다
 * 마감이 가까우면 남은 것은 left 로 돌려준다 (화면이 다시 요청). 폴더가 비면 폴더도 지운다
 */
export async function undoUpload(cfg: FtpConfig, dial: Dial, t: UploadTarget, items: UploadedItem[], deadline = Infinity) {
  if (!Array.isArray(items) || !items.length || items.length > 300) throw new Error('되돌릴 파일 목록이 올바르지 않습니다.');
  for (const it of items) {
    if (!UPLOAD_FILE_RE.test(it?.file || '')) throw new Error(`파일명 규칙(6-1) 위반: ${String(it?.file).slice(0, 60)}`);
    if (it.backup != null && BACKUP_RE.exec(it.backup)?.[1] !== it.file) throw new Error(`백업 이름이 올바르지 않습니다: ${String(it.backup).slice(0, 80)}`);
  }
  const dir = folderOf(cfg, t);
  return session(cfg, dial, async (c) => {
    const restored: string[] = [];
    const removed: string[] = [];
    const failed: { file: string; error: string }[] = [];
    const left: UploadedItem[] = [];
    if (!(await c.isDir(dir))) return { restored, removed, failed, left, folderRemoved: true };
    for (const it of items) {
      if (Date.now() > deadline - 20_000) {
        left.push(it);
        continue;
      }
      const path = `${dir}/${it.file}`;
      if (it.backup) {
        if ((await c.size(`${dir}/${it.backup}`)) == null) {
          failed.push({ file: it.file, error: '백업 파일이 없어 되돌리지 못했습니다.' });
          continue;
        }
        if ((await c.size(path)) != null) await c.remove(path);
        await c.rename(`${dir}/${it.backup}`, path);
        restored.push(it.file);
      } else {
        if ((await c.size(path)) != null) await c.remove(path);
        removed.push(it.file);
      }
    }
    let folderRemoved = false;
    if (!left.length && !(await c.list(dir, true)).length) {
      await c.rmdir(dir).catch(() => {});
      folderRemoved = true;
    }
    return { restored, removed, failed, left, folderRemoved };
  });
}

/** deleteIn 이 쓰는 FTP 동작만 (테스트에서 가짜로 바꿔 끼운다) */
export interface DeleteClient {
  isDir(path: string): Promise<boolean>;
  list(dir: string, all?: boolean): Promise<string[]>;
  size(path: string): Promise<number | null>;
  remove(path: string): Promise<unknown>;
  rmdir(path: string): Promise<unknown>;
}

/**
 * 제품 폴더에서 파일 지우기 (변환 내역 「이미지 서버에서 지우기」) — 화면이 고른 파일만.
 *  - 그 파일의 숨김 백업(.bak-<시각>-<파일명>)·끊긴 임시 파일(.part-<파일명>)도 함께 지운다 (되살릴 일이 없게 정리)
 *  - 서버에 이미 없으면 missing (실패 아님)
 *  - 마감이 가까우면 남은 것은 left (화면이 다시 요청). 폴더가 비면 폴더도 지운다
 *  - 본 파일과 백업은 따로 센다: 본 파일을 지운 뒤 백업만 못 지우면 그 파일은 removed + backupFailed (failed 아님)
 *  - folderRemoved 는 rmdir 이 실제로 성공했을 때만 true (폴더가 처음부터 없으면 false)
 */
export async function deleteIn(c: DeleteClient, dir: string, files: string[], deadline = Infinity) {
  const removed: string[] = [];
  const missing: string[] = [];
  const failed: { file: string; error: string }[] = [];
  const backupFailed: string[] = [];
  const left: string[] = [];
  let backups = 0;
  if (!(await c.isDir(dir))) return { removed, missing: [...files], failed, backupFailed, left, backups, folderRemoved: false };
  const all = await c.list(dir, true);
  // 있는지는 위에서 받은 폴더 목록으로 본다 (파일마다 SIZE 를 물으면 최대 300번 왕복이 더 들어 마감 시간을 먹는다 — putFiles 와 같은 방식)
  const present = new Set(all);
  for (const file of files) {
    if (Date.now() > deadline - 20_000) {
      left.push(file);
      continue;
    }
    try {
      const path = `${dir}/${file}`;
      if (present.has(file)) {
        await c.remove(path);
        removed.push(file);
      } else missing.push(file);
    } catch (e) {
      failed.push({ file, error: (e as Error).message || String(e) });
      continue; // 본 파일을 못 지웠으면 백업도 남겨 둔다 (되돌릴 길)
    }
    for (const n of all) {
      if (BACKUP_RE.exec(n)?.[1] === file || n === `${PART}${file}`) {
        try {
          await c.remove(`${dir}/${n}`);
          backups++;
        } catch {
          backupFailed.push(n);
        }
      }
    }
  }
  let folderRemoved = false;
  if (!left.length && !(await c.list(dir, true)).length) {
    folderRemoved = await c.rmdir(dir).then(
      () => true,
      () => false,
    );
  }
  return { removed, missing, failed, backupFailed, left, backups, folderRemoved };
}

export async function deleteFiles(cfg: FtpConfig, dial: Dial, t: UploadTarget, files: string[], deadline = Infinity) {
  if (!Array.isArray(files) || !files.length || files.length > 300) throw new Error('지울 파일 목록이 올바르지 않습니다.');
  for (const f of files) if (!UPLOAD_FILE_RE.test(f || '')) throw new Error(`파일명 규칙(6-1) 위반: ${String(f).slice(0, 60)}`);
  return session(cfg, dial, (c) => deleteIn(c, folderOf(cfg, t), [...new Set(files)], deadline));
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
