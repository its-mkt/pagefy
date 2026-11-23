// 이미지: 타일·자르기는 워커에서 하고(화면 쪽 캔버스 인코딩이 결과 처리 중 수 초씩 밀려서), 여기서는 결과를 화면용으로 정리한다
import type { Plan } from '../../shared/types';
import type { PsdWorker } from './psd/client';

export async function bitmapToUrl(bmp: ImageBitmap, type = 'image/jpeg') {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return URL.createObjectURL(await c.convertToBlob({ type, quality: 0.85 }));
}

export interface CutImage {
  file: string;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  alt?: string;
  kind: string;
}

/** plan.images 대로 자른다 (워커) */
export async function cutImages(plan: Plan, worker: PsdWorker): Promise<{ images: CutImage[]; errors: string[] }> {
  const list = plan.images || [];
  const { results, errors } = await worker.cut(list);
  const images = results.map((r) => {
    const im = list.find((x) => x.file === r.file);
    return { file: r.file, blob: r.blob, url: URL.createObjectURL(r.blob), width: r.width, height: r.height, alt: im?.alt, kind: im?.kind ?? '' };
  });
  return { images, errors };
}

/** 미리보기용: HTML 안 이미지 절대 주소 → 방금 자른 로컬 이미지 */
export function localizeHtml(html: string, baseUrl: string, images: CutImage[]) {
  let out = html;
  for (const im of images) out = out.split(`${baseUrl}/${im.file}`).join(im.url);
  // 미리보기는 바깥 스크롤 상자 안의 iframe 이라 지연 로딩(lazy) 이미지가 빈칸으로 보인다 → 미리보기에서만 바로 불러온다 (복사 HTML 은 그대로)
  return out.replace(/loading="lazy"/g, 'loading="eager"');
}
