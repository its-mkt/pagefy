/// <reference lib="webworker" />
// PSD 읽기·합성·이미지 자르기는 무거워서(100MB 이상) 화면이 멈추지 않게 워커에서 한다
import { initializeCanvas, readPsd, type Layer, type Psd } from 'ag-psd';
import type { Tile } from '../../../shared/types';
import { extractSummary, isUsable } from './extract';
import { isBlank, pixelsToCanvas, renderDocument } from './composite';
import type { CutResult, WorkerIn, WorkerOut } from './protocol';

// 워커에는 DOM 캔버스가 없으므로 OffscreenCanvas 로 대신한다 (패턴·썸네일 등 일부 데이터가 캔버스를 씀)
initializeCanvas(
  (w, h) => new OffscreenCanvas(Math.max(1, w), Math.max(1, h)) as unknown as HTMLCanvasElement,
  (w, h) => new ImageData(Math.max(1, w), Math.max(1, h)),
);

let psd: Psd | null = null;
/** 자르기용 원본 (워커에 둔다) */
let compositeCanvas: OffscreenCanvas | null = null;
let notextCanvas: OffscreenCanvas | null = null;

/** 타일 한 장 최대 크기 (Claude 이미지 긴 변 1568px 이하 → 축소 없이 읽힘) */
const TILE_MAX_W = 1000;
const TILE_MAX_H = 1560;

const post = (msg: WorkerOut, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

function findLayer(children: Layer[] | undefined, id: number): Layer | undefined {
  for (const l of children || []) {
    if (l.id === id) return l;
    const r = findLayer(l.children, id);
    if (r) return r;
  }
}

async function blobToBase64(b: Blob) {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function makeTiles(src: OffscreenCanvas, from = 0, to = src.height): Promise<Tile[]> {
  const scale = Math.min(1, TILE_MAX_W / src.width);
  const srcH = Math.floor(TILE_MAX_H / scale);
  const tiles: Tile[] = [];
  for (let y = from; y < to; y += srcH) {
    const h = Math.min(srcH, to - y);
    const c = new OffscreenCanvas(Math.round(src.width * scale), Math.round(h * scale));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, y, src.width, h, 0, 0, c.width, c.height);
    tiles.push({ y0: y, y1: y + h, data: await blobToBase64(await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })) });
  }
  return tiles;
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === 'open') {
      psd = null;
      compositeCanvas = notextCanvas = null;
      post({ type: 'progress', message: `PSD 읽는 중… (${(msg.file.size / 1024 / 1024).toFixed(0)}MB)` });
      const buf = await msg.file.arrayBuffer();
      // 큰 PSD 도 레이어 픽셀을 모두 읽도록 디코딩 메모리 한도를 기본(2GB)보다 넉넉히 준다
      psd = readPsd(buf, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true, totalMemoryLimit: 6 * 1024 ** 3 });

      post({ type: 'progress', message: '레이어 정보 정리 중…' });
      const summary = extractSummary(psd, msg.file.name);

      // 픽셀을 못 읽은 레이어 (메모리 한도·미지원 형식) → 배경에서 빠지므로 알린다
      const missing: string[] = [];
      const scan = (children: Layer[] | undefined) => {
        for (const l of children || []) {
          if (!isUsable(l, psd!)) continue;
          if (l.children) scan(l.children);
          else if (!l.text && !l.adjustment && !l.imageData && (l.right ?? 0) > (l.left ?? 0)) missing.push(`${l.name}(#${l.id})`);
        }
      };
      scan(psd.children);
      if (missing.length) summary.warnings.unshift(`픽셀을 읽지 못한 레이어 ${missing.length}개가 "글자 뺀 배경"에서 빠졌습니다: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}. 그 영역은 원본 합성(composite)으로 쓰게 지시하세요.`);

      post({ type: 'progress', message: '글자 뺀 배경 합성 중…' });
      notextCanvas = renderDocument(psd, { skipText: true });

      if (!isBlank(psd.imageData)) {
        compositeCanvas = pixelsToCanvas(psd.imageData!)!;
      } else {
        summary.warnings.unshift('PSD 안에 합성 이미지가 없어(최대 호환성 꺼짐) 레이어를 직접 합성했습니다. 효과·조정 레이어가 빠질 수 있으니, 가능하면 Photoshop에서 "최대 호환성"을 켜고 다시 저장한 PSD를 쓰세요.');
        compositeCanvas = renderDocument(psd, { skipText: false });
      }
      psd.imageData = undefined;
      // 큰 PSD 는 레이어 픽셀만 수 GB 라 PC 가 느려진다. 합성이 끝났으니 나중에 "layer" 소스로 자를 수 있는
      // 텍스트 레이어·작은 레이어(아이콘 등, 100만 px 이하)만 남기고 놓아준다
      const release = (children: Layer[] | undefined) => {
        for (const l of children || []) {
          if (l.mask) l.mask.imageData = undefined;
          if (l.realMask) l.realMask.imageData = undefined;
          if (l.imageData && !l.text && l.imageData.width * l.imageData.height > 1_000_000) l.imageData = undefined;
          release(l.children);
        }
      };
      release(psd.children);
      // 화면 표시용 복사본 (원본 캔버스는 자르기용으로 워커에 남긴다)
      const composite = await createImageBitmap(compositeCanvas);
      const notext = await createImageBitmap(notextCanvas);
      post({ type: 'opened', summary, composite, notext }, [composite, notext]);
      return;
    }

    if (msg.type === 'layer') {
      const layer = psd && findLayer(psd.children, msg.id);
      if (!layer || !layer.imageData) {
        post({ type: 'layer', reqId: msg.reqId, id: msg.id, bitmap: null, left: 0, top: 0 });
        return;
      }
      const bitmap = pixelsToCanvas(layer.imageData)!.transferToImageBitmap();
      post({ type: 'layer', reqId: msg.reqId, id: msg.id, bitmap, left: layer.left ?? 0, top: layer.top ?? 0 }, [bitmap]);
      return;
    }

    if (msg.type === 'tiles') {
      if (!compositeCanvas) throw new Error('PSD 가 열려 있지 않습니다.');
      const from = Math.max(0, Math.floor(msg.y0 ?? 0));
      const to = Math.min(compositeCanvas.height, Math.ceil(msg.y1 ?? compositeCanvas.height));
      post({ type: 'tiles', reqId: msg.reqId, tiles: await makeTiles(compositeCanvas, from, to) });
      return;
    }

    if (msg.type === 'cut') {
      // plan.images 대로 자른다. 사진·배경 JPG 품질 82 (규칙 6절 80~85)
      const results: CutResult[] = [];
      const errors: string[] = [];
      for (const im of msg.images) {
        try {
          const w = Math.round(im.x1 - im.x0);
          const h = Math.round(im.y1 - im.y0);
          if (w <= 0 || h <= 0) throw new Error('영역이 비어 있음');
          const c = new OffscreenCanvas(w, h);
          const ctx = c.getContext('2d')!;
          const isJpg = /\.jpe?g$/i.test(im.file);
          if (isJpg) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, h);
          }
          if (im.source === 'layer') {
            const layer = psd && im.layerId != null ? findLayer(psd.children, im.layerId) : undefined;
            if (!layer?.imageData) throw new Error(`레이어 #${im.layerId} 픽셀 없음 (텍스트·작은 레이어만 "layer" 소스로 자를 수 있음 → composite 로 바꿔 수정 요청)`);
            ctx.drawImage(pixelsToCanvas(layer.imageData)!, im.x0 - (layer.left ?? 0), im.y0 - (layer.top ?? 0), w, h, 0, 0, w, h);
          } else {
            const src = im.source === 'composite' ? compositeCanvas : notextCanvas;
            if (!src) throw new Error('PSD 가 열려 있지 않습니다.');
            ctx.drawImage(src, im.x0, im.y0, w, h, 0, 0, w, h);
          }
          const blob = await c.convertToBlob(isJpg ? { type: 'image/jpeg', quality: 0.82 } : { type: 'image/png' });
          results.push({ file: im.file, blob, width: w, height: h });
        } catch (err) {
          errors.push(`${im.file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      post({ type: 'cut', reqId: msg.reqId, results, errors });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), reqId: 'reqId' in msg ? msg.reqId : undefined });
  }
};
