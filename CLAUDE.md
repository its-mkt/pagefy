# Pagefy (`pagefy`)

통이미지 디자인(상세페이지·랜딩·콘텐츠)을 PSD에서 HTML 마크업으로 바꾸는 웹 서비스. 배포 주소 경로는 `/pagefy/`. 구조·실행법은 README.md.

- 마크업 규칙 원본은 공유 폴더 `\\192.168.1.254\마케팅팀\A_상세페이지\detail_to_markup.md` 하나다.
  서버가 매 요청마다 읽는다. `rules/detail_to_markup.md` 는 접근 불가 때 쓰는 사본이므로 규칙은 원본을 고치고, 사본은 원본에서 복사만 한다.
- 규칙의 텍스트 환산 공식(4-1절)은 `src/lib/psd/extract.ts` 에 코드로 들어가 있다. 규칙이 바뀌면 여기도 맞춘다.
- Claude 호출은 서버에서만 한다: 배포 = Supabase 함수 `supabase/functions/pagefy`, 로컬 = `server/`. 둘 다 `core/` 를 쓴다 (core 는 Node·Deno 공용 — node: 모듈 금지). API 키를 화면 코드로 보내지 않는다.
- 생성은 구조 계획(/plan, Claude 1회) + 코드 생성(`src/lib/codegen.ts`, 브라우저) (2026-11-23~, psd2html build.js 방식). Claude 는 섹션·사진 띠·이미지에 남길 글자·제목 단계만 정하고, 글자 위치·크기·줄바꿈·자간·색은 코드가 PSD 값으로 만든다. Claude 가 HTML 을 직접 쓰는 방식으로 되돌리지 않는다 (품질이 Claude Code 작업보다 떨어졌던 원인). /section 은 저장된 옛 작업용으로만 남아 있다.
- 자간은 `src/lib/lsAdjust.ts` 가 출력과 같은 Pretendard 조각으로 줄 폭을 재서 보정한다 (규칙 4-1 글자 폭).
- 함수를 고치면 `yarn build:function` 뒤 Supabase 프로젝트 `ad-insight DB`(tqxljgmygvanysqnhiar)에 `pagefy` 로 다시 배포 (verify_jwt 끔, 함수가 광고 인사이트 웹앱 whoami 로 권한 확인).
- 배포 함수는 규칙을 GitHub `rules/detail_to_markup.md` 에서 읽는다 → 원본을 고쳤으면 `yarn sync:rules` 후 커밋·push.
- 환경변수는 `PAGEFY_*` 를 쓴다 (`CLAUDE_*` 는 Claude Code 환경변수와 겹침).
- 확인: `yarn typecheck`, `yarn build`, 화면은 `MOCK=1 yarn dev` 로 PSD를 올려 끝까지 흐름 확인.
- 위치 대조(`src/lib/layoutCheck.ts`)를 고치면 기존 검증본 `\\192.168.1.254\마케팅팀\A_상세페이지\아이티켓\ZGX Nano AI Station\` HTML·PSD 로 다시 재서 104/104 통과(못 찾음 11개 = 이미지로 구운 숫자 라벨)가 유지되는지 본다.
