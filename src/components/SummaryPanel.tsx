import { useState } from 'react';
import type { Loaded } from '../App';

export default function SummaryPanel({ loaded }: { loaded: Loaded }) {
  const { summary: s } = loaded;
  const [view, setView] = useState<'composite' | 'notext'>('composite');
  const baked = s.texts.filter((t) => t.bakeHint);

  return (
    <section className="panel">
      <h2 className="panel__title">2. PSD 확인</h2>
      <div className="summary">
        <div className="summary__info">
          <dl className="facts">
            <div><dt>크기</dt><dd>{s.width} × {s.height}px · {s.dpi}ppi</dd></div>
            <div><dt>사용 레이어</dt><dd>{s.layers.length}개</dd></div>
            <div><dt>제외(숨김)</dt><dd>{s.hiddenCount}개</dd></div>
            <div><dt>텍스트 레이어</dt><dd>{s.texts.length}개</dd></div>
          </dl>
          <h3>폰트</h3>
          <ul className="fonts">
            {s.fonts.map((f) => (
              <li key={f.name} className={f.mapped || f.bake ? '' : 'is-bad'}>
                {f.name} <small>×{f.count}</small> {f.bake ? <em>이미지로 굽기</em> : !f.mapped && <em>웹폰트 표에 없음</em>}
              </li>
            ))}
            {!s.fonts.length && <li>텍스트 레이어 없음</li>}
          </ul>
          {s.warnings.length > 0 && (
            <>
              <h3>확인할 것</h3>
              <ul className="warnings">
                {s.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </>
          )}
          {baked.length > 0 && (
            <details className="baked">
              <summary>이미지로 구울 후보 글자 {baked.length}개</summary>
              <ul>{baked.map((t) => <li key={t.id}>"{t.lines[0]}" — {t.bakeHint}</li>)}</ul>
            </details>
          )}
          <details className="baked">
            <summary>텍스트 레이어 값 보기</summary>
            <table className="texts">
              <thead><tr><th>y</th><th>글자</th><th>크기/행간</th><th>굵기</th><th>색</th></tr></thead>
              <tbody>
                {s.texts.map((t) => (
                  <tr key={t.id}>
                    <td>{Math.round(t.lineTop)}</td>
                    <td>{t.lines.join(' / ').slice(0, 40)}</td>
                    <td>{t.size}/{t.lineHeight}</td>
                    <td>{t.weight}</td>
                    <td><span className="swatch" style={{ background: `#${t.color}` }} />#{t.color}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
        <div className="summary__preview">
          <div className="seg">
            <button className={view === 'composite' ? 'is-on' : ''} onClick={() => setView('composite')}>PSD 합성</button>
            <button className={view === 'notext' ? 'is-on' : ''} onClick={() => setView('notext')}>글자 뺀 배경</button>
          </div>
          <div className="scrollimg">
            <img src={view === 'composite' ? loaded.compositeUrl : loaded.notextUrl} alt={view === 'composite' ? 'PSD 합성 렌더' : '글자 뺀 배경 합성'} />
          </div>
          <p className="hint">"글자 뺀 배경"은 브라우저로 다시 합성한 것입니다. 그림자·광선·오버레이·획은 근사해서 그리고, 내부 그림자·경사 같은 효과와 조정 레이어는 빠집니다. PSD 합성과 비교해 보세요.</p>
        </div>
      </div>
    </section>
  );
}
