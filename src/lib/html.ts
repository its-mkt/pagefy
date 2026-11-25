/** HTML 본문·속성에 넣을 글자 이스케이프 (생성 HTML 공용) */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');
