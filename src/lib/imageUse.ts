// 결과 「이미지」 탭 — 그림이 결과 HTML 에서 어떻게 쓰였는지(<img alt> / CSS 배경)와 종류 표시 (tests/imageUse.test.ts)

export type ImageUse = { tag: 'img'; alt: string } | { tag: 'bg'; alt?: undefined };

/** 결과 HTML 에서 그림 파일이 어떻게 쓰였는지 — <img src=".../파일" alt="…"> 또는 background-image:url('.../파일') */
export function imageUse(html: string): Map<string, ImageUse> {
  const m = new Map<string, ImageUse>();
  const fileOf = (url: string) => decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '');
  const unesc = (v: string) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1];
    if (!src) continue;
    const f = fileOf(src);
    if (!m.has(f)) m.set(f, { tag: 'img', alt: unesc(/\salt="([^"]*)"/i.exec(tag)?.[1] ?? '') });
  }
  for (const [, url] of html.matchAll(/background-image:\s*url\((?:'|"|&quot;)?([^'")&]+)/gi)) {
    const f = fileOf(url);
    if (!m.has(f)) m.set(f, { tag: 'bg' });
  }
  return m;
}

/** 그림 종류 표시 — 파일명 종류(규칙 6-1: bg·img·txt·ico·gif) + HTML 에서 쓰인 방식. alt 가 없을 때 그 이유도 */
export function imageKind(file: string, u: ImageUse | undefined): { label: string; tone: 'bg' | 'img' | 'txt' | 'none'; noAlt: string } {
  const kind = /_(bg|img|txt|ico|gif)\d/.exec(file)?.[1] ?? '';
  if (!u) return { label: 'HTML 에서 안 씀', tone: 'none', noAlt: '이 결과 HTML 에 쓰이지 않는 그림입니다.' };
  if (u.tag === 'bg') return { label: '배경 · CSS', tone: 'bg', noAlt: 'alt 없음 — CSS 배경이라 넣을 자리가 없고, 위 문구는 HTML 글자로 들어가 있습니다.' };
  if (kind === 'txt') return { label: '구운 글자 · <img>', tone: 'txt', noAlt: 'alt 비어 있음 — 원문이 있어야 합니다 (규칙 8-2 3항).' };
  if (kind === 'bg') return { label: '섹션 이미지 · <img>', tone: 'img', noAlt: 'alt 비어 있음.' };
  return { label: kind === 'img' ? '사진 · <img>' : '그림 · <img>', tone: 'img', noAlt: 'alt="" — 장식이거나, 여러 장으로 나뉜 사진의 이어지는 조각입니다.' };
}
