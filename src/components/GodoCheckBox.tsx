// 고도몰 등록 확인 — 상품번호(또는 상품 주소)를 넣으면 고도몰 상세설명을 읽어 지금 결과와 같은지 보여 준다 (읽기 전용, core/godo.ts)
// 상품번호는 제품(채널/슬러그)마다 이 브라우저에 기억해 두고, 다음에 결과를 열면 자동으로 다시 확인한다
import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { fetchGodoGoods } from '../lib/api';
import { Tip } from './ui';
import { compareGodo, goodsNoOf, rememberGoodsNo, rememberedGoodsNo, type GodoCheck } from '../lib/godoCheck';

interface Props {
  /** 지금 결과의 복사 구간 HTML */
  html: string;
  /** 'detail/<채널>/<슬러그>/' — 기억 키·Pagefy 결과 판별에 씀 */
  folder: string;
}

const STATUS: Record<GodoCheck['status'], { label: string; tone: string }> = {
  latest: { label: '등록됨 · 지금 결과와 같음', tone: 'badge--ok' },
  old: { label: '등록됨 · 옛 버전', tone: 'badge--warn' },
  other: { label: '이 제품 결과가 아님', tone: 'badge--error' },
  empty: { label: '상세설명 비어 있음', tone: 'badge--error' },
};

/** 2026-11-20 15:31:03 → 2026-11-20 15:31 */
const shortDt = (v: string | null) => (v ? v.slice(0, 16) : '—');

export default function GodoCheckBox({ html, folder }: Props) {
  const [input, setInput] = useState(() => rememberedGoodsNo(folder));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<GodoCheck | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const run = async (raw = input) => {
    const no = goodsNoOf(raw);
    if (!no) return setError('상품번호(숫자) 또는 상품 주소(…goodsNo=숫자)를 넣어 주세요.');
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setBusy(true);
    setError('');
    try {
      const goods = await fetchGodoGoods(no, c.signal);
      if (c.signal.aborted) return;
      rememberGoodsNo(folder, no);
      setInput(no);
      setCheck(compareGodo(goods, html, folder));
    } catch (err) {
      if (!c.signal.aborted) {
        setCheck(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  };

  // 기억한 상품번호가 있으면 결과를 열 때·결과가 바뀔 때 자동 확인
  useEffect(() => {
    const no = rememberedGoodsNo(folder);
    setInput(no);
    setCheck(null);
    setError('');
    if (no) void run(no);
    return () => ctl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, html]);

  const st = check && STATUS[check.status];
  const g = check?.goods;
  return (
    <div className="godo" role="group" aria-label="고도몰 등록 확인">
      <div className="godo__row">
        <b className="godo__title">고도몰 등록 확인</b>
        <input
          className="godo__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && void run()}
          placeholder="상품번호 또는 상품 주소"
          aria-label="고도몰 상품번호 또는 상품 주소"
          spellCheck={false}
        />
        <Button type="button" size="sm" disabled={busy || !input.trim()} onClick={() => void run()}>
          {busy ? '확인 중…' : check ? '다시 확인' : '확인'}
        </Button>
        {st && <span className={`badge ${st.tone}`}>{st.label}</span>}
      </div>
      {error && <p className="msg msg--error godo__msg" role="alert">{error}</p>}
      {check && g && (
        <div className="godo__info">
          <span>
            <a href={g.url} target="_blank" rel="noreferrer">
              {g.name || `상품 ${g.goodsNo}`}
            </a>
            {!g.displayed && ' (진열 안 함)'}
          </span>
          <Tip content="가격·재고 등 상품 정보가 바뀌어도 이 시각이 바뀝니다 — 상세설명을 바꾼 시각과 다를 수 있음">
            <span className="godo__dt" tabIndex={0}>고도몰 마지막 수정 {shortDt(g.modDt)}</span>
          </Tip>
          {check.status === 'old' && (
            <span className="godo__hint">
              {check.sameContent
                ? '글자·이미지는 같고 코드(스타일 등)만 다릅니다. 지금 결과로 다시 붙여넣으면 최신이 됩니다.'
                : '글자나 이미지가 지금 결과와 다릅니다. 지금 결과를 붙여넣으려면 「HTML 복사」 후 상세설명을 바꿔 주세요.'}
            </span>
          )}
          {check.status === 'other' && <span className="godo__hint">이 상품 상세설명에는 이 제품 폴더의 이미지나 Pagefy 마크업이 없습니다. 상품번호를 확인해 주세요.</span>}
          {!g.mobileSameAsPc && !g.descriptionMobile.trim() && check.status !== 'empty' && (
            <span className="godo__hint">모바일 상세설명 칸은 비어 있습니다 (「PC 와 동일」 설정 꺼짐).</span>
          )}
        </div>
      )}
    </div>
  );
}
