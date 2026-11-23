// 생성 API 호출. 배포(its.itket.com/pagefy)는 Supabase 함수, 개발(yarn dev)은 로컬 서버(/api)
import type { HealthInfo, PlanRequest, SectionRequest, StreamEvent } from '../../shared/types';
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
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)) as StreamEvent);
    }
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
    } else if (e.type === 'error') failed = e.message;
  }, signal);
  if (failed) throw new Error(failed);
  // 잘린 응답을 완료로 받아들이지 않는다 (닫히지 않은 HTML·CSS 가 저장되면 뒤 섹션까지 깨짐)
  if (!finished) throw new Error('서버 연결이 응답 도중 끊겼습니다 (함수 실행 시간 제한 등). 다시 시도하세요.');
  if (out.stopReason === 'max_tokens') throw new Error('응답이 출력 길이 한도에 걸려 잘렸습니다. 섹션을 더 작게 나누도록 수정 요청하거나 다시 시도하세요.');
  if (out.stopReason && out.stopReason !== 'end_turn' && out.stopReason !== 'stop_sequence') throw new Error(`응답이 정상적으로 끝나지 않았습니다 (${out.stopReason}). 다시 시도하세요.`);
  return out;
}

// ───── 이미지 호스팅 업로드 (서버가 FTP 로 올린다, core/upload.ts) ─────

export interface UploadTarget {
  channel: string;
  slug: string;
  rev: string;
  publicRoot: string;
  /** 이 작업의 표시 — 이 표시가 있는 rev 폴더에만 올린다 */
  token: string;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: await headers(true), body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error(await errorOf(r));
  return r.json();
}

/** 서버에 이 rev 폴더가 있는지, 있으면 어떤 파일이 있는지 */
export const uploadCheck = (target: UploadTarget, signal?: AbortSignal) =>
  postJson<{ exists: boolean; owned: boolean; files: { file: string; size: number }[]; base: string }>('upload/check', { target }, signal);

/** 파일 몇 장씩 올리기 (data = base64). 같은 이름이 서버에 있으면 refused 로 돌아온다 */
export const uploadFiles = (target: UploadTarget, files: { file: string; data: string }[], signal?: AbortSignal) =>
  postJson<{ done: { file: string; url: string; size: number }[]; refused: { file: string; error: string }[]; left?: string[] }>('upload/files', { target, files }, signal);

/** 공개 주소를 열어 200·용량 확인 */
export const uploadVerify = (target: UploadTarget, files: { file: string; size: number; sha256?: string }[], signal?: AbortSignal) =>
  postJson<{ results: { file: string; url: string; status: number; size: number; ok: boolean; checked: boolean }[] }>('upload/verify', { target, files }, signal);

/** 잘못 올린 것 되돌리기 — 이 작업이 올린 폴더의 이미지(files)를 지운다. left 가 있으면 다시 부른다 */
export const uploadRemove = (target: UploadTarget, files: string[], signal?: AbortSignal) =>
  postJson<{ removed: string[]; left: string[]; folderRemoved: boolean }>('upload/remove', { target, files }, signal);
