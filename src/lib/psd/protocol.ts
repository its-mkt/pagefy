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
  | { type: 'opened'; summary: PsdSummary; composite: ImageBitmap; notext: ImageBitmap }
  | { type: 'layer'; reqId: number; id: number; bitmap: ImageBitmap | null; left: number; top: number }
  | { type: 'tiles'; reqId: number; tiles: Tile[] }
  | { type: 'cut'; reqId: number; results: CutResult[]; errors: string[] }
  | { type: 'error'; message: string; reqId?: number };
