import { describe, expect, it } from 'vitest';
import { imageKind, imageUse } from '../src/lib/imageUse';

const B = 'https://itketweb.hgodo.com/data/detail/itket/zgx';
const html = `
  <div class="dp-sec" style="background-image:url('${B}/s00_bg1.jpg');min-height:10px">
    <img class="dp-t" src="${B}/s00_txt1-title.jpg" alt="HP ZGX &quot;Nano&quot;" width="10" height="10">
  </div>
  <img class="dp-img" src="${B}/s00_img1-hero.jpg" alt="HP ZGX Nano 전면 외관" width="860" height="490">
  <img class="dp-img" src="${B}/s01_img1-hero-2.jpg" alt="" width="860" height="490">
  <div style="background-image:url(&quot;${B}/s02_bg1.jpg&quot;)"></div>`;

describe('imageUse', () => {
  const u = imageUse(html);
  it('<img> 는 alt 와 함께, CSS 배경은 bg 로', () => {
    expect(u.get('s00_bg1.jpg')).toEqual({ tag: 'bg' });
    expect(u.get('s02_bg1.jpg')).toEqual({ tag: 'bg' });
    expect(u.get('s00_txt1-title.jpg')).toEqual({ tag: 'img', alt: 'HP ZGX "Nano"' });
    expect(u.get('s00_img1-hero.jpg')).toEqual({ tag: 'img', alt: 'HP ZGX Nano 전면 외관' });
    expect(u.get('s01_img1-hero-2.jpg')).toEqual({ tag: 'img', alt: '' });
  });
});

describe('imageKind', () => {
  it('종류와 alt 없는 이유', () => {
    expect(imageKind('s00_bg1.jpg', { tag: 'bg' }).label).toBe('배경 · CSS');
    expect(imageKind('s00_txt1-title.jpg', { tag: 'img', alt: 'x' }).label).toBe('구운 글자 · <img>');
    expect(imageKind('s00_img1-hero.jpg', { tag: 'img', alt: '' }).noAlt).toMatch(/이어지는 조각/);
    // 오픈마켓 섹션 이미지: 배경 파일이 <img> 로 쓰임
    expect(imageKind('s03_bg1.jpg', { tag: 'img', alt: '문구' }).label).toBe('섹션 이미지 · <img>');
    expect(imageKind('s09_bg1.jpg', undefined).label).toBe('HTML 에서 안 씀');
  });
});
