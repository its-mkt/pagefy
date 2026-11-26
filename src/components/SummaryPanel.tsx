import { useState } from 'react';
import type { Loaded } from '../App';
import { Fold, Seg } from './ui';

export default function SummaryPanel({ loaded }: { loaded: Loaded }) {
  const { summary: s } = loaded;
  const [view, setView] = useState<'composite' | 'notext'>('composite');
  const baked = s.texts.filter((t) => t.bakeHint);
  const unmapped = s.fonts.filter((f) => !f.mapped && !f.bake);
  const issues = [...s.warnings, ...(unmapped.length ? [`웹폰트 표에 없는 폰트: ${unmapped.map((f) => f.name).join(', ')}`] : [])];

  return (
    <section className="panel">
      <h2 className="panel__title">PSD 확인</h2>

      {issues.length > 0 ? (
        <div className="ready ready--warn">
          <p className="ready__title">확인할 것 {issues.length}건 <span className="ready__sub">주의 사항이라 그대로 만들어도 됩니다</span></p>
          <ul className="ready__list">
            {issues.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      ) : (
        <div className="ready ready--ok">
          <p className="ready__title">문제 없이 바로 만들 수 있습니다</p>
        </div>
      )}

      <dl className="facts">
        <div><dt>크기</dt><dd>{s.width}×{s.height}</dd></div>
        <div><dt>텍스트 레이어</dt><dd>{s.texts.length}개</dd></div>
        <div><dt>사용 레이어</dt><dd>{s.layers.length}개</dd></div>
        <div><dt>폰트</dt><dd>{s.fonts.length}종</dd></div>
      </dl>

      <Fold className="more" summary="PSD 자세히 보기">
        <div className="summary">
          <div className="summary__info">
            <p className="hint summary__meta">{s.width} × {s.height}px · {s.dpi}ppi · 제외(숨김) 레이어 {s.hiddenCount}개</p>
            <h3>폰트</h3>
            <ul className="fonts">
              {s.fonts.map((f) => (
                <li key={f.name} className={f.mapped || f.bake ? '' : 'is-bad'}>
                  {f.name} <small>×{f.count}</small> {f.bake ? <em>이미지로 굽기</em> : !f.mapped && <em>웹폰트 표에 없음</em>}
                </li>
              ))}
              {!s.fonts.length && <li>텍스트 레이어 없음</li>}
            </ul>
            {baked.length > 0 && (
              <Fold className="baked" summary={<>이미지로 구울 후보 글자 {baked.length}개</>}>
                <ul>{baked.map((t) => <li key={t.id}>"{t.lines[0]}" — {t.bakeHint}</li>)}</ul>
              </Fold>
            )}
            <Fold className="baked" summary="텍스트 레이어 값 보기">
              <div className="texts__wrap">
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
              </div>
            </Fold>
          </div>
          <div className="summary__preview">
            <Seg
              aria-label="미리보기 이미지"
              value={view}
              onChange={setView}
              items={[
                { value: 'composite', label: 'PSD 합성' },
                { value: 'notext', label: '글자 뺀 배경' },
              ]}
            />
            <div className="scrollimg">
              {view === 'notext' && !loaded.notextUrl ? (
                <p className="hint scrollimg__wait"><span className="spinner" /> 글자 뺀 배경을 합성하는 중입니다… 몇 초 뒤 나타납니다.</p>
              ) : (
                <img src={view === 'composite' ? loaded.compositeUrl : loaded.notextUrl} alt={view === 'composite' ? 'PSD 합성 렌더' : '글자 뺀 배경 합성'} decoding="async" />
              )}
            </div>
            <p className="hint">"글자 뺀 배경"은 브라우저로 다시 합성한 것입니다. 그림자·광선·오버레이·획은 근사해서 그리고, 내부 그림자·경사 같은 효과와 조정 레이어는 빠집니다. PSD 합성과 비교해 보세요.</p>
          </div>
        </div>
      </Fold>
    </section>
  );
}
