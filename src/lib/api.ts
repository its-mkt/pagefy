// 생성 API 호출. 배포(its.itket.com/pagefy)는 Supabase 함수, 개발(yarn dev)은 로컬 서버(/api)
import type { GodoGoods, HealthInfo, PlanRequest, SectionRequest, StreamEvent } from '../../shared/types';
import type { AdminSettingsRequest, AdminStats, BudgetInfo } from '../../shared/ops';
import { SUPABASE_ANON_KEY, SUPABASE_URL, currentToken } from './supabase';

/** true 면 Supabase 함수 + 로그인 필요. 개발 중에도 VITE_PAGEFY_CLOUD=1 이면 함수를 쓴다 */
export const CLOUD = import.meta.env.PROD || import.meta.env.VITE_PAGEFY_CLOUD === '1';
const BASE = CLOUD ? `${SUPABASE_URL}/functions/v1/pagefy` : `${import.meta.env.BASE_URL}api`;

async function headers(json = false): Promise<Record<string, string>> {
  const h: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  if (CLOUD) {
    h.apikey = SUPABASE_ANON_KEY;
    const token = await currentToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  return h;
}

async function errorOf(r: Response) {
  return r.json().then((j: { error?: string }) => j.error || `서버 응답 ${r.status}`).catch(() => `서버 응답 ${r.status}`);
}

export async function fetchHealth(): Promise<HealthInfo> {
  const r = await fetch(`${BASE}/health`, { headers: await headers() });
  if (!r.ok) throw new Error(await errorOf(r));
  return r.json();
}

/** 요청을 보내고 서버가 보내는 SSE 이벤트를 하나씩 onEvent 로 넘긴다 */
async function stream(path: 'plan' | 'section', body: PlanRequest | SectionRequest, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
  const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: await headers(true), body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) throw new Error(await errorOf(r));
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  const emit = (chunk: string) => {
    const line = chunk.split('\n').find((l) => l.startsWith('data: '));
    if (line) onEvent(JSON.parse(line.slice(6)) as StreamEvent);
  };
  // 노트북 절전·와이파이 전환 등으로 연결이 조용히 멈추면 끝없이 기다린다 → 120초 동안 아무것도 안 오면 멈춘 것으로 본다
  // (생각하는 동안에도 thinking·status 이벤트가 계속 오므로 정상 생성은 걸리지 않는다)
  const IDLE_MS = 120_000;
  const readOrStall = () => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const stall = new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error('서버 연결이 2분 동안 멈춰 있어 중단했습니다 (절전·네트워크 전환 등). 다시 시도하세요.')), IDLE_MS);
    });
    return Promise.race([reader.read(), stall]).finally(() => clearTimeout(t));
  };
  try {
    for (;;) {
      const { value, done } = await readOrStall();
      if (done) break;
      buf += value.replace(/\r\n/g, '\n');
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        emit(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    }
    if (buf.trim()) emit(buf); // 끝에 빈 줄 없이 끝난 마지막 이벤트
  } finally {
    // 읽다가 오류가 나도 연결을 닫는다 (안 닫으면 서버가 아무도 안 받는 응답을 계속 만든다)
    reader.cancel().catch(() => {});
  }
}

export interface StreamResult {
  text: string;
  usage?: Extract<StreamEvent, { type: 'done' }>['usage'];
  model?: string;
  stopReason?: string | null;
}

/** 스트림을 끝까지 받아 글 전체를 돌려준다 (status·thinking 은 콜백으로) */
export async function collect(
  path: 'plan' | 'section',
  body: PlanRequest | SectionRequest,
  cb: { status?: (m: string) => void; thinking?: (t: string) => void; text?: (all: string) => void },
  signal: AbortSignal,
): Promise<StreamResult> {
  const out: StreamResult = { text: '' };
  let failed: string | null = null;
  /** 실패해도 이미 쓴 비용은 오류에 붙여 화면이 작업 비용에 더하게 한다 */
  const fail = (msg: string) => Object.assign(new Error(msg), { usage: out.usage, model: out.model });
  let finished = false;
  await stream(path, body, (e) => {
    if (e.type === 'status') cb.status?.(e.message);
    else if (e.type === 'thinking') cb.thinking?.(e.text);
    else if (e.type === 'text') {
      out.text += e.text;
      cb.text?.(out.text);
    } else if (e.type === 'done') {
      finished = true;
      Object.assign(out, { usage: e.usage, model: e.model, stopReason: e.stopReason });
    } else if (e.type === 'error') {
      failed = e.message;
      if (e.usage) Object.assign(out, { usage: e.usage, model: e.model });
    }
  }, signal);
  if (failed) throw fail(failed);
  // 잘린 응답을 완료로 받아들이지 않는다 (닫히지 않은 HTML·CSS 가 저장되면 뒤 섹션까지 깨짐)
  if (!finished) throw fail('서버 연결이 응답 도중 끊겼습니다 (함수 실행 시간 제한 등). 다시 시도하세요.');
  if (out.stopReason === 'max_tokens') throw fail('응답이 출력 길이 한도에 걸려 잘렸습니다. 다시 시도하세요. 계속되면 관리자에게 알려 주세요.');
  if (out.stopReason && out.stopReason !== 'end_turn' && out.stopReason !== 'stop_sequence') throw fail(`응답이 정상적으로 끝나지 않았습니다 (${out.stopReason}). 다시 시도하세요.`);
  return out;
}

// ───── 이미지 호스팅 업로드 (서버가 FTP 로 올린다, core/upload.ts) ─────

/** 이미지는 <공개 주소 루트>/<채널>/<슬러그>/<파일명>, 오픈마켓은 …/openmarket/<플랫폼>/<슬러그>/<파일명> 에 올린다 (규칙 6-1, shared/types.ts imageFolder) */
export interface UploadTarget {
  channel: string;
  slug: string;
  /** 오픈마켓 플랫폼 — channel 이 openmarket 이면 꼭 보낸다 (서버가 없으면 거절) */
  market?: string;
  publicRoot: string;
}

/** 올린 파일 하나 — backup 이 있으면 같은 이름 파일을 덮어쓴 것 (서버에 옛 파일을 그 숨김 이름으로 보관) */
export interface UploadedItem {
  file: string;
  backup?: string;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: await headers(true), body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error(await errorOf(r));
  return r.json();
}

/** 서버에 제품 폴더가 있는지, 있으면 어떤 파일이 있는지 */
export const uploadCheck = (target: UploadTarget, signal?: AbortSignal) =>
  postJson<{ exists: boolean; files: { file: string; size: number }[]; base: string }>('upload/check', { target }, signal);

/**
 * 파일 몇 장씩 올리기 (data = base64). 같은 이름이 서버에 있으면 overwrite 에 있을 때만 덮어쓰고(done[].backup = 옛 파일 보관 이름),
 * 없으면 refused 로 돌아온다
 */
export const uploadFiles = (target: UploadTarget, files: { file: string; data: string }[], overwrite: string[], signal?: AbortSignal) =>
  postJson<{ done: (UploadedItem & { url: string; size: number })[]; refused: { file: string; error: string }[]; left?: string[] }>('upload/files', { target, files, overwrite }, signal);

/** 공개 주소를 열어 200·용량 확인 */
export const uploadVerify = (target: UploadTarget, files: { file: string; size: number; sha256?: string }[], signal?: AbortSignal) =>
  postJson<{ results: { file: string; url: string; status: number; size: number; ok: boolean; checked: boolean }[] }>('upload/verify', { target, files }, signal);

/** 잘못 올린 것 되돌리기 — 이번에 올린 파일(items): 덮어쓴 것은 백업으로 되돌리고 새로 올린 것은 지운다. left 가 있으면 다시 부른다 */
export const uploadRemove = (target: UploadTarget, items: UploadedItem[], signal?: AbortSignal) =>
  postJson<{ restored: string[]; removed: string[]; failed: { file: string; error: string }[]; left: UploadedItem[]; folderRemoved: boolean }>('upload/remove', { target, items }, signal);

/** 변환 내역 「이미지 서버에서 지우기」 — 고른 파일과 그 숨김 백업을 지운다. 서버에 이미 없으면 missing. left 가 있으면 다시 부른다 */
export const uploadDelete = (target: UploadTarget, files: string[], signal?: AbortSignal) =>
  postJson<{ removed: string[]; missing: string[]; failed: { file: string; error: string }[]; backupFailed?: string[]; left: string[]; backups: number; folderRemoved: boolean }>('upload/delete', { target, files }, signal);

/** 고도몰 상품 조회 (상세설명·수정일, 읽기 전용) — 등록 확인용 */
export const fetchGodoGoods = (goodsNo: string, signal?: AbortSignal) => postJson<GodoGoods>('godo/goods', { goodsNo }, signal);

// ───── 운영: 관리 화면 (core/ops.ts · server/opsLocal.ts) ─────

/** 관리 화면 숫자 (광고 인사이트 역할 admin 만) — month: YYYY-MM, 없으면 이번 달 */
export async function fetchAdminStats(month?: string): Promise<AdminStats> {
  const r = await fetch(`${BASE}/admin/stats${month ? `?month=${month}` : ''}`, { headers: await headers() });
  if (!r.ok) throw new Error(await errorOf(r));
  return r.json();
}

/** 월 상한 바꾸기·이번 달 상한 풀기 */
export const saveAdminSettings = (b: AdminSettingsRequest) => postJson<{ budget: BudgetInfo }>('admin/settings', b);
