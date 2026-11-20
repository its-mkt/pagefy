// PSD 하나를 읽어 Claude 에게 넘길 요약이 제대로 나오는지 점검 (이미지 디코딩 없이 빠르게)
// usage: yarn check:psd "<PSD 경로>" [--json 출력파일]
import fs from 'node:fs';
import { readPsd } from 'ag-psd';
import { extractSummary } from '../src/lib/psd/extract.ts';

const [file, flag, out] = process.argv.slice(2);
if (!file) {
  console.error('usage: yarn check:psd "<PSD 경로>" [--json 출력파일]');
  process.exit(1);
}
const t0 = Date.now();
const buf = fs.readFileSync(file);
const psd = readPsd(buf, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true, useImageData: true });
const s = extractSummary(psd, file.split(/[\/]/).pop() || file);
console.log(`${s.fileName}  ${s.width}x${s.height}  ${s.dpi}ppi  (${Date.now() - t0}ms)`);
console.log(`사용 레이어 ${s.layers.length} / 제외(숨김) ${s.hiddenCount} / 텍스트 ${s.texts.length}`);
console.log('폰트:', s.fonts.map((f) => `${f.name}×${f.count}${f.bake ? ' (이미지로 굽기)' : f.mapped ? '' : ' (표에 없음)'}`).join(', '));
for (const w of s.warnings) console.log('⚠', w);
console.log('\n텍스트 앞 15개:');
for (const t of s.texts.slice(0, 15)) {
  console.log(`  #${t.id} y${t.lineTop} x${t.anchorX} ${t.align} ${t.size}px/${t.lineHeight} w${t.weight} #${t.color} ls${t.ls} ${t.shape}${t.runs ? ' [혼합]' : ''}${t.bakeHint ? ' [굽기:' + t.bakeHint + ']' : ''} | ${t.lines.join(' / ').slice(0, 60)}`);
}
const json = JSON.stringify(s);
console.log(`\n요약 JSON 크기: ${(json.length / 1024).toFixed(1)}KB (대략 ${Math.round(json.length / 3.2 / 1000)}K 토큰)`);
if (flag === '--json' && out) fs.writeFileSync(out, JSON.stringify(s, null, 2));
