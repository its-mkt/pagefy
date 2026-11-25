// 탭 문자: HTML 은 탭을 한 칸 공백으로 접으므로 PSD(포토샵 기본 탭 간격 36pt, 줄 시작 기준)처럼 벌려 줘야 한다.
// 번호 목록("1	2x USB …")처럼 앞부분이 짧은 줄이 대부분. 코드 생성(codegen.ts)과 자간 측정(lsAdjust.ts)이 같은 값을 쓴다

/** 포토샵 기본 탭 간격 (px) */
export const tabStopPx = (dpi: number) => (36 * (dpi || 72)) / 72;

/** 글자 폭 어림 (한글·한자·전각 = 글자 크기, 그 밖 = 0.55배) — 몇 번째 탭 위치까지 갔는지 정할 때만 쓴다 */
export const roughWidth = (text: string, size: number) => [...text].reduce((w, c) => w + (/[ᄀ-ᇿ　-鿿가-힯＀-｠]/.test(c) ? size : c === ' ' ? size * 0.25 : size * 0.55), 0);

/** x 다음 탭 위치 */
export const nextTab = (x: number, stop: number) => (Math.floor(x / stop + 1e-6) + 1) * stop;

/** 탭이 있는 줄의 폭: 조각 폭은 measure 로 재고 탭마다 다음 탭 위치로 건너뛴다 */
export function tabbedWidth(line: string, stop: number, measure: (s: string) => number) {
  return line.split('	').reduce((x, part, i) => (i ? nextTab(x, stop) : x) + measure(part), 0);
}

/**
 * 탭이 든 조각 → HTML. escaped = 조각을 이미 escape 한 글, raw = 원문, before = 같은 줄에서 이 조각 앞의 원문.
 * 줄 첫 조각이면 탭 앞 글을 탭 위치까지의 inline-block 으로 감싼다 (글꼴이 달라도 뒤 글자가 정확한 위치에서 시작).
 * 줄 중간 조각이면 어림한 남은 폭만큼 빈 칸을 둔다
 */
export function tabHtml(escaped: string, raw: string, before: string, size: number, stop: number, len: (px: number) => string) {
  const parts = escaped.split('	');
  const rawParts = raw.split('	');
  let x = before ? tabbedWidth(before, stop, (s) => roughWidth(s, size)) : 0;
  let out = '';
  parts.forEach((part, i) => {
    if (i === parts.length - 1) return void (out += part);
    const at = x + roughWidth(rawParts[i], size);
    const to = nextTab(at, stop);
    out +=
      i === 0 && !before
        ? `<span style="display:inline-block;min-width:${len(to)}">${part}</span>`
        : i > 0 && !before
          ? `<span style="display:inline-block;min-width:${len(to - x)}">${part}</span>`
          : `${part}<span style="display:inline-block;width:${len(to - at)}"></span>`;
    x = to;
  });
  return out;
}
