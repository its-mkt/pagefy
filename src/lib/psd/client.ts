// 화면 쪽에서 PSD 워커를 다루는 얇은 래퍼
import type { PlanImage, PsdSummary, Tile } from '../../../shared/types';
import type { CutResult, WorkerIn, WorkerOut } from './protocol';

export interface OpenedPsd {
  summary: PsdSummary;
  composite: ImageBitmap;
  notext: ImageBitmap;
}

type Pending = { resolve: (m: WorkerOut) => void; reject: (e: Error) => void };

export class PsdWorker {
  private worker = new Worker(new URL('./psd.worker.ts', import.meta.url), { type: 'module' });
  private reqId = 0;
  private pending = new Map<number, Pending>();
  private openCb: { resolve: (v: OpenedPsd) => void; reject: (e: Error) => void; progress: (m: string) => void; preview?: (p: { summary: PsdSummary; composite: ImageBitmap }) => void } | null = null;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') this.openCb?.progress(m.message);
      else if (m.type === 'preview') {
        if (this.openCb?.preview) this.openCb.preview({ summary: m.summary, composite: m.composite });
        else m.composite.close();
      }
      else if (m.type === 'opened') {
        this.openCb?.resolve({ summary: m.summary, composite: m.composite, notext: m.notext });
        this.openCb = null;
      } else if (m.type === 'error') {
        if (m.reqId != null && this.pending.has(m.reqId)) {
          this.pending.get(m.reqId)!.reject(new Error(m.message));
          this.pending.delete(m.reqId);
        } else {
          this.openCb?.reject(new Error(m.message));
          this.openCb = null;
        }
      } else if ('reqId' in m) {
        this.pending.get(m.reqId)?.resolve(m);
        this.pending.delete(m.reqId);
      }
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'PSD 워커 오류');
      this.openCb?.reject(err);
      this.openCb = null;
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
    };
  }

  /** preview: 레이어 정보·PSD 합성 이미지가 먼저 준비되면 불린다 (글자 뺀 배경은 아직) — 받은 비트맵은 받는 쪽이 닫는다 */
  open(file: File, progress: (m: string) => void, preview?: (p: { summary: PsdSummary; composite: ImageBitmap }) => void): Promise<OpenedPsd> {
    return new Promise((resolve, reject) => {
      this.openCb = { resolve, reject, progress, preview };
      this.send({ type: 'open', file });
    });
  }

  private request<T extends WorkerOut>(make: (reqId: number) => WorkerIn): Promise<T> {
    const reqId = ++this.reqId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: (m) => resolve(m as T), reject });
      this.send(make(reqId));
    });
  }

  async layer(id: number) {
    const m = await this.request<Extract<WorkerOut, { type: 'layer' }>>((reqId) => ({ type: 'layer', reqId, id }));
    return { bitmap: m.bitmap, left: m.left, top: m.top };
  }

  /** Claude 에게 보낼 PSD 렌더 타일 (범위를 주면 그 세로 범위만 — 섹션용) */
  async tiles(range?: { y0: number; y1: number }): Promise<Tile[]> {
    const m = await this.request<Extract<WorkerOut, { type: 'tiles' }>>((reqId) => ({ type: 'tiles', reqId, ...range }));
    return m.tiles;
  }

  /** plan 대로 이미지 자르기 */
  async cut(images: PlanImage[]): Promise<{ results: CutResult[]; errors: string[] }> {
    const m = await this.request<Extract<WorkerOut, { type: 'cut' }>>((reqId) => ({ type: 'cut', reqId, images }));
    return { results: m.results, errors: m.errors };
  }

  private send(msg: WorkerIn) {
    this.worker.postMessage(msg);
  }

  /** 워커를 끝내고, 기다리던 요청은 실패로 끝낸다 (안 그러면 기다리던 생성 흐름이 영원히 멈춤) */
  dispose() {
    this.worker.terminate();
    const err = new Error('PSD 를 닫았습니다.');
    this.openCb?.reject(err);
    this.openCb = null;
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }
}
