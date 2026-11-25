// 도움말 (주소 #help) — 처음 쓰는 디자이너용: 흐름 · PSD 준비 · 지원 환경 · 자주 묻는 질문 · 문의
// 개발 용어(슬러그·규칙 절 번호·토큰)는 쓰지 않는다. 자세한 마크업 규칙은 공유 폴더 원본 한 곳에만 둔다
import { SHARED_ROOT } from '../lib/sharedFolder';
import { Fold } from './ui';
import { Button } from './Button';

const STEPS = [
  ['PSD 올리기', 'PSD 파일을 「PSD 올리기」 칸에 끌어다 놓거나 「클릭해서 고르기」 (칸 밖에 놓으면 열리지 않음). 파일은 서버로 가지 않고 이 PC 브라우저 안에서만 읽습니다.'],
  ['확인·설정', '제품명과 채널(고도몰 / 오픈마켓)을 확인합니다. 처음 보는 제품이면 이미지 폴더 이름(영문)을 한 번 정합니다.'],
  ['마크업 만들기', '「마크업 만들기」를 누르면 보통 1~3분 걸립니다. 그동안 다른 탭에서 일해도 됩니다.'],
  ['복사해 붙여넣기', '「이미지 올리고 HTML 복사」 → 쇼핑몰 상품 상세(HTML 모드)에 붙여넣기. 붙여넣은 뒤 상품 페이지 화면을 확인해 주세요.'],
] as const;

const PREP = [
  '글자는 래스터화하지 말고 텍스트 레이어로 두세요 — 텍스트 레이어만 HTML 글자가 됩니다.',
  '폭은 860px(고도몰) 기준입니다. 오픈마켓은 플랫폼별 폭에 맞춰 자동으로 줄입니다.',
  '쓰지 않는 레이어는 지우거나 숨기세요. 숨긴 레이어는 무시합니다.',
  '조정 레이어·내부 그림자·경사·패턴 효과는 배경에 반영되지 않습니다. 그런 부분은 이미지로 합쳐(병합) 두세요.',
  '움직이는 GIF 는 만들 수 없습니다 (정지 이미지로 저장됩니다).',
  '아주 긴 PSD 는 한 번에 보낼 수 없을 수 있습니다 — 그때는 PSD 를 둘로 나눠 주세요.',
];

const FAQ: [string, string][] = [
  ['결과가 PSD 와 조금 달라요.', '결과 화면의 「나란히 비교」로 어긋난 곳을 확인한 뒤 「수정 요청」에 고칠 곳을 적어 보내세요. 글자 위치·크기는 PSD 값으로 다시 계산합니다. 그래도 안 되면 관리자에게 알려 주세요 (아래 「문의」).'],
  ['「이미지에 남긴 글자」가 뭔가요?', 'HTML 글자로 바꾸지 않고 이미지에 그대로 둔 글자입니다 (숫자 라벨·로고 글자 등). 이 문구를 고치려면 PSD 를 고쳐 다시 만들어야 합니다.'],
  ['다른 PC 에서 이어서 할 수 있나요?', '머리말 메뉴 「변환 내역」은 계정에 저장돼 다른 PC 에서도 보입니다. 다만 PSD 원본은 PC 에만 있으니, 이어서 고치려면 같은 PSD 를 다시 골라 주세요. 완료한 작업은 「공유 폴더에 저장」으로 남겨 두면 팀원도 열 수 있습니다.'],
  ['이미지를 잘못 올렸어요.', '복사 버튼 옆 「잘못 올렸으면 되돌리기」로 이번에 올린 이미지만 되돌립니다. 이미 쇼핑몰에 붙여넣었다면 그 페이지 그림이 빈칸이 되니 먼저 확인하세요.'],
  ['「이번 달 사용 한도」에 걸렸어요.', '팀 전체 월 사용 한도가 있습니다. 한도에 닿으면 새로 만들 수 없으니 Pagefy 관리자에게 해제를 요청하세요. 이미 만든 결과는 그대로 열고 복사할 수 있습니다.'],
  ['만드는 중에 창을 닫았어요.', '「변환 내역」(또는 만들기 화면의 「최근 작업」)에서 다시 열면 이미 받은 부분은 남아 있습니다. 「저장된 계획으로 마무리」가 보이면 비용 없이 끝낼 수 있습니다.'],
];

/** onRestartTour: 만들기 화면의 단계별 처음 안내를 처음처럼 다시 띄운다 (lib/tour.ts) */
export default function HelpPanel({ onRestartTour }: { onRestartTour?: () => void }) {
  return (
    <section className="panel help" aria-labelledby="help-title">
      <h2 id="help-title" className="panel__title">도움말</h2>

      <div className="help__head">
        <h3 className="help__h">이렇게 씁니다</h3>
        {onRestartTour && (
          <Button type="button" size="sm" onClick={onRestartTour}>
            처음 안내 다시 보기
          </Button>
        )}
      </div>
      <ol className="help__steps">
        {STEPS.map(([t, d], i) => (
          <li key={t}>
            <span className="help__num" aria-hidden="true">{i + 1}</span>
            <div>
              <b>{t}</b>
              <p>{d}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="help__cols">
        <div>
          <h3 className="help__h">PSD 준비</h3>
          <ul className="help__list">
            {PREP.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="help__h">쓸 수 있는 환경</h3>
          <ul className="help__list">
            <li>사내 PC 의 <b>Chrome</b> 또는 <b>Edge</b> (데스크톱). 다른 브라우저에서는 「공유 폴더에 저장」이 되지 않습니다.</li>
            <li>광고 인사이트에서 승인된 회사 계정으로 로그인해야 합니다.</li>
            <li>「공유 폴더에 저장」은 사내망에서 <code>{SHARED_ROOT}</code> 에 접근할 수 있어야 합니다.</li>
            <li>수백 MB 짜리 PSD 는 PC 메모리를 많이 씁니다. 다른 큰 프로그램을 닫고 여세요.</li>
          </ul>
        </div>
      </div>

      <h3 className="help__h">자주 묻는 질문</h3>
      <div className="help__faq">
        {FAQ.map(([q, a]) => (
          <Fold key={q} className="fold" summary={<>{q}</>}>
            <p>{a}</p>
          </Fold>
        ))}
      </div>

      <h3 className="help__h">문의</h3>
      <p className="help__contact">
        막히거나 결과가 이상하면 마케팅팀 Pagefy 담당자에게 메신저로 알려 주세요. 결과 화면에 「진단 정보 복사」 버튼이 보이면 그 내용을, 없으면 화면 캡처와 PSD 이름을 함께 보내 주세요. 마크업 규칙 원본은 공유 폴더의 <code>pagefy.md</code> 입니다.
      </p>
    </section>
  );
}
