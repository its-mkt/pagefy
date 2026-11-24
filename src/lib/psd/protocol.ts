import type { PlanImage, PsdSummary, Tile } from '../../../shared/types';

export interface CutResult {
  file: string;
  blob: Blob;
  width: number;
  height: number;
}

export type WorkerIn =
  | { type: 'open'; file: File }
  | { type: 'layer'; reqId: number; id: number }
  | { type: 'tiles'; reqId: number; y0?: number; y1?: number }
  | { type: 'cut'; reqId: number; images: PlanImage[] };

export type WorkerOut =
  | { type: 'progress'; message: string }
  /** 레이어 정보·PSD 합성 이미지가 준비되면 먼저 보낸다 (글자 뺀 배경 합성은 수 초 걸려 화면을 기다리게 하지 않게) */
  | { type: 'preview'; summary: PsdSummary; composite: ImageBitmap }
  | { type: 'opened'; summary: PsdSummary; composite: ImageBitmap; notext: ImageBitmap }
  | { type: 'layer'; reqId: number; id: number; bitmap: ImageBitmap | null; left: number; top: number }
  | { type: 'tiles'; reqId: number; tiles: Tile[] }
  | { type: 'cut'; reqId: number; results: CutResult[]; errors: string[] }
  | { type: 'error'; message: string; reqId?: number };
