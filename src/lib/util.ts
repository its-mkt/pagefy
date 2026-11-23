import type { CutImage } from './images';
import { safeFolderName } from './sharedFolder';

/** 규칙 6-1 제품슬러그: 영문 소문자, 공백·특수문자는 '-' 하나로, 앞뒤 '-' 제거 */
export function toSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 한국 날짜 */
export function kstDate(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}

export const todayRev = () => kstDate().replace(/-/g, '');

export function productNameFromFile(fileName: string) {
  return fileName.replace(/\.psd$/i, '').trim();
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

/** 제품 폴더 모양(규칙 2절) 그대로: <제품명>.html + img/<rev>/… */
export async function buildZip(productName: string, rev: string, html: string, images: CutImage[]) {
  // zip 은 받을 때만 쓰므로 그때 불러온다 (첫 화면 파일을 가볍게)
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  // 제품명에 : " / 같은 글자가 있으면 윈도우에서 풀리지 않거나 폴더가 쪼개진다 → 공유 폴더 저장과 같은 규칙으로 다듬는다
  const name = safeFolderName(productName) || 'pagefy';
  const root = zip.folder(name)!;
  root.file(`${name}.html`, html);
  const img = root.folder('img')!.folder(rev)!;
  for (const im of images) img.file(im.file, im.blob);
  return zip.generateAsync({ type: 'blob' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 못 해도 동작에는 지장 없음
  }
}
