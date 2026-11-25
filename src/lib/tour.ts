// 처음 쓰는 사람을 위한 단계별 안내 (Tour) — 만들기 화면의 단계마다 처음 한 번만 뜬다.
// 화면 요소는 data-tour="이름" 으로 가리킨다 (각 화면은 표시만 붙이고, 안내 내용·순서는 여기 한곳에)
import { readLocal, writeLocal } from './util';

/** 안내 묶음 — 만들기 화면의 단계 (Stepper 와 같은 순서) */
export type TourStage = 'upload' | 'settings' | 'result';

export interface TourStep {
  /** 가리킬 요소 — [data-tour="target"]. 화면에 없으면 그 단계는 건너뛴다 */
  target: string;
  title: string;
  body: string;
}

export const TOURS: Record<TourStage, TourStep[]> = {
  upload: [
    { target: 'upload', title: 'PSD 파일부터 올리세요', body: '상세페이지 PSD를 여기에 끌어다 놓거나 눌러서 고릅니다. 파일은 이 PC 브라우저 안에서만 읽습니다. 예전 작업은 위 메뉴 「변환 내역」에서 이어서 열 수 있습니다.' },
  ],
  settings: [
    { target: 'names', title: '① 제품명과 서버 폴더 이름', body: 'PSD 파일 이름으로 미리 채워 둡니다. 서버 폴더 이름은 이미지 주소에 들어가니 영문으로, 한 번 정하면 바꾸지 않습니다.' },
    { target: 'channel', title: '② 어디에 올릴지 (판매처)', body: '고도몰(아이티켓·온코어)과 오픈마켓은 HTML 방식이 다릅니다. 같은 PSD를 여러 곳에 올릴 때는 하나를 먼저 만들고 변환 내역의 「복제」로 나머지를 만드세요.' },
    { target: 'note', title: '③ 작업 기록 (선택)', body: '담당자·메모·테스트 표시는 변환 내역에서 알아보기 위한 기록입니다. 마크업에는 영향이 없으니 비워 둬도 됩니다.' },
    { target: 'go', title: '④ 마크업 만들기', body: '누르면 Claude가 섹션 구조를 한 번 정하고, 글자 위치·크기·줄바꿈은 프로그램이 PSD 값으로 계산합니다.' },
  ],
  result: [
    { target: 'copy', title: 'HTML 복사 → 붙여넣기', body: '이 버튼으로 복사해 쇼핑몰 상세설명(HTML 모드)에 붙여넣으면 끝입니다. 이미지 서버가 연결돼 있으면 복사할 때 이미지가 먼저 올라가고, 아니면 버튼 옆 안내대로 이미지를 먼저 올립니다.' },
    { target: 'tester', title: '붙여넣기 전에 미리 보기', body: '쇼핑몰 에디터가 저장하면서 HTML을 어떻게 바꾸는지 미리 볼 수 있습니다. 처음 올리는 판매처라면 한 번 확인해 보세요.' },
  ],
};

const KEY = 'pagefy.tour';

/** 이미 본 안내 */
export const tourSeen = (stage: TourStage) => !!readLocal<Partial<Record<TourStage, boolean>>>(KEY, {})[stage];
export const markTourSeen = (stage: TourStage) => writeLocal(KEY, { ...readLocal<Partial<Record<TourStage, boolean>>>(KEY, {}), [stage]: true });
/** 도움말의 「처음 안내 다시 보기」 — 모든 단계를 다시 처음처럼 */
export const resetTour = () => writeLocal(KEY, {});
