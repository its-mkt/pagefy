# Pagefy — 통이미지 디자인 → HTML 마크업

**https://its.itket.com/pagefy/** · 저장소 `its-mkt/pagefy` · 폴더 `C:\0.Project\pagefy`

PSD를 올리면 마케팅팀 규칙(`\\192.168.1.254\마케팅팀\A_상세페이지\pagefy.md`)대로
Claude가 상세페이지 HTML을 만들어 주는 웹 서비스.

React + TypeScript + SCSS + Vite (yarn) / 생성 서버: Supabase Edge Function(배포) · Express(로컬) + Anthropic SDK

## 구성

```
브라우저 (its.itket.com/pagefy, GitHub Pages)
  ├─ PSD 읽기·합성·이미지 자르기·위치 대조 — 전부 브라우저(워커) 안. PSD 파일은 서버로 안 감
  ├─ 로그인: 광고 인사이트 계정 (같은 Supabase, 승인된 계정만)
  └─ 생성 요청 → Supabase 함수 pagefy (Claude API 키는 함수 비밀값에만)
        ① /plan    구조 계획: 섹션·사진 띠(img alt)·이미지에 남길 글자·제목 단계 (Claude 1회)
  └─ ② 코드 생성 (브라우저, codegen.ts): PSD 값으로 글자 상자·행·배경 블록·CSS → 자간 보정 → 이미지 자르기 → 위치 대조
```

글자 위치·크기·자간은 Claude 가 아니라 코드가 PSD 값으로 계산한다 (Claude Code + psd2html build.js 와 같은 방식, ZGX 검증본 104/104).
수정 요청은 구조 계획을 고쳐 다시 받고 마크업은 다시 계산한다. /section(섹션별 Claude 작성)은 저장된 옛 작업을 열 때만 쓴다.

## 로컬 개발

```bash
yarn install
cp .env.example .env      # ANTHROPIC_API_KEY 채우기 (console.anthropic.com → API Keys)
yarn dev                  # 화면 http://localhost:1100  (로컬 API 서버 1101 같이 켜짐, 로그인 없음)
```

- API 키 없이 화면 흐름만 볼 때: `MOCK=1 yarn dev` → Claude를 부르지 않고 예시 결과 (비용 없음)
- 로컬 화면에서 배포된 Supabase 함수를 쓰려면 `VITE_PAGEFY_CLOUD=1 yarn dev:web` (로그인 필요)
- 로컬에서도 실제 계정으로 로그인하려면 `.env` 에 `VITE_PAGEFY_LOGIN=1` (생성은 로컬 서버 그대로, 변환 내역은 계정에 저장 — 배포 화면과 같은 표라 MOCK 으로 만든 작업은 자동으로 「테스트」 표시). 바꾼 뒤 `yarn dev` 다시 시작

## 배포

| 무엇 | 어떻게 | 반영 |
|---|---|---|
| 화면 | `main` 에 push → GitHub Actions 가 빌드해 Pages 로 (`.github/workflows/deploy.yml`) | 1~2분 |
| 규칙 | 공유 폴더 원본 수정 → `yarn sync:rules` → `rules/` 커밋·push. 함수가 GitHub 사본을 10분마다 다시 읽음 | 10분 이내 |
| 생성 서버 | `yarn build:function` → `supabase/functions/pagefy` 를 Supabase 프로젝트 `ad-insight DB` 에 함수 `pagefy` 로 배포 (JWT 검사 끔 — 함수가 직접 권한 확인) | 즉시 |
| Claude API 키 | Supabase 대시보드 → Edge Functions → Secrets → `ANTHROPIC_API_KEY` (저장소·채팅에 적지 않음) | 즉시 |

함수 비밀값(선택): `PAGEFY_MODEL`(기본 `claude-opus-5-5`), `PAGEFY_EFFORT`(기본 `medium`), `PAGEFY_PLAN_EFFORT`(기본 `medium`)

이미지 서버 업로드(선택, 넣으면 결과 화면에 「이미지 서버에 올리기」 버튼이 생긴다): `PAGEFY_FTP_HOST` · `PAGEFY_FTP_USER` · `PAGEFY_FTP_PASS` · `PAGEFY_FTP_ROOT`(예: `/data/detail`) · `PAGEFY_FTP_PUBLIC_BASE`(예: `https://itketweb.hgodo.com/data/detail`) · `PAGEFY_FTP_PORT`(기본 21).
로컬(`yarn dev`)은 규칙 6절의 `~/.claude/secrets/nhn-image-ftp.env` 를 그대로 읽는다. 이미지 서버가 암호화 없는 FTP 만 받으므로(FTPS·SFTP 없음, 2026-11-23 확인) 가능하면 `/data/detail` 만 쓸 수 있는 전용 FTP 계정을 쓴다.

고도몰 등록 확인(선택, 넣으면 아이티켓 채널 결과에 「고도몰 등록 확인」 상자가 생긴다): `PAGEFY_GODO_PARTNER_KEY` · `PAGEFY_GODO_USER_KEY` — 아이티켓 고도몰 오픈 API 키(광고 인사이트 Apps Script 의 `GODO_PARTNER_KEY`·`GODO_USER_KEY` 와 같은 값). 로컬은 `~/.claude/secrets/godo-openapi.env`(`GODO_PARTNER_KEY=`·`GODO_USER_KEY=`). 상품 조회만 한다(읽기 전용, `core/godo.ts`).

운영 기록·월 상한·실패 알림(2026-11-24~): 생성마다 `pagefy_runs` 에 비용·결과를 남기고, 월 상한(`pagefy_settings`, 기본 $100)에 닿으면 새 생성을 막는다. (결과 평가 막대는 2026-11-24 화면에서 뺐다 — 팀 내부용이라 필요 없음. `pagefy_feedback` 표와 함수 `/feedback` 은 남아 있지만 쓰지 않는다)
도입 성과는 「관리」의 월 완료 건수·실패율·1건 평균 비용·평균 소요 시간(`pagefy_runs`)으로 본다.
admin 계정은 화면 「관리」(`#admin`)에서 보고 상한을 바꾼다. 실패 알림은 `PAGEFY_NOTIFY_URL`·`PAGEFY_NOTIFY_SECRET`·`PAGEFY_NOTIFY_TO` 가 있을 때만.
표: `supabase/migrations/20261124_pagefy_ops.sql` · 운영·장애 대처: **`docs/operations.md`** · 단위 테스트: `yarn test` (CI 에서도 돈다)

## 쓰는 법

1. **로그인** — 광고 인사이트 계정. 같은 its.itket.com 안이라 광고 인사이트에 로그인돼 있으면 그대로 들어간다. 가입·승인은 광고 인사이트에서
2. **PSD 올리기** — 파일은 브라우저 안에서만 읽는다. 서버로는 레이어·텍스트 값과 축소 렌더 타일만 간다
3. **PSD 확인** — 크기·사용/숨김 레이어·폰트·경고. "글자 뺀 배경"이 PSD 합성과 비슷한지 본다
4. **설정** — 제품명(= PSD 파일명, 공유 폴더·HTML 파일 이름), 채널 폴더(아이티켓·온코어 = 고도몰용 / 오픈마켓 = 인라인 전용), 서버 폴더 이름(= 제품슬러그, 제품명 옆), 추가 지시, HTML 이미지 주소(늘 보임 · 주소 루트는 「주소 루트 바꾸기」를 눌러야 고침)
5. **결과** — 구조 계획 → 코드 생성 → 자동 점검, 미리보기(PSD와 나란히 · 모바일 360px), HTML(복사 구간만 복사), 완료 보고, 이미지
   - **PSD 위치 대조**(자동): 텍스트 레이어마다 첫 줄 기준선·가로 위치를 PSD 값과 비교 (규칙 4-1 기준 세로 ±3px·가로 ±6px) + 모바일 360px 가로 스크롤. 기존 검증본 ZGX HTML 로 104/104 통과 확인
   - **대조 결과로 고치기**: 어긋난 텍스트가 있는 섹션만 골라 다시 만든다
   - **수정 요청**: 섹션을 고르고 고칠 점을 적으면 그 섹션만 다시 만든다
   - **zip 내려받기** = 제품 폴더 모양 그대로 (`<제품명>/<제품명>.html`, `img/…`)
6. **이미지 서버에 올리기** (「이미지 올리고 HTML 복사」, 서버에 FTP 접속 정보가 있을 때) — 서버가 `/data/detail/<채널>/<슬러그>/` 에 올리고 공개 주소를 열어 200·용량·내용(SHA-256)을 확인한다 (`core/upload.ts`, 규칙 6-1 — 2026-11-24 부터 날짜(rev) 폴더 없음)
   - 정해진 폴더·6-1 파일명·실제 이미지 형식만
   - 서버에 같은 이름 파일이 있으면 내용(SHA-256)을 비교해 같은 것은 건너뛰고, 다른 것은 **덮어쓰기 안내**(덮어쓸 목록·그림 크기 변화)를 띄워 확인받은 뒤에만 덮어쓴다
   - 덮어쓸 때 옛 파일은 같은 폴더의 숨김 백업 `.bak-<YYYYMMDD-HHmmss>-<파일명>` 으로 옮긴다 → 「잘못 올렸으면 되돌리기」는 이번에 올린 파일만 되돌린다 (덮어쓴 것은 백업으로, 새로 올린 것은 삭제)
   - 그림 크기가 바뀐 이미지가 있으면 이미 붙여 둔 옛 HTML 과 어긋나므로 안내에서 HTML 다시 붙여넣기를 알린다. 서버에서 이 HTML 이 쓰지 않는 파일은 지우지 않는다
   - 버튼이 없을 때는 zip 을 받아 `img` 폴더 안 이미지를 FTP 로 `<채널>/<슬러그>/` 에 올린다 (예전 `psd2html\upload.js` 는 날짜 폴더 방식이라 쓰지 않음)
   - 실제 채널에 붙여넣어 깨지지 않는지는 사람이 확인 (규칙 9절)
7. **고도몰 등록 확인** (아이티켓 채널, 서버에 고도몰 API 키가 있을 때) — 상품번호나 상품 주소를 넣으면 고도몰 상세설명을 읽어 지금 결과와 비교한다: 「등록됨 · 지금 결과와 같음」 / 「등록됨 · 옛 버전」(글자·이미지는 같고 코드만 다른지도 알림) / 「이 제품 결과가 아님」 / 「상세설명 비어 있음」
   - 상품번호는 제품(채널/슬러그)마다 브라우저에 기억해 다음에 결과를 열면 자동으로 다시 확인한다
   - 표시하는 「고도몰 마지막 수정」 시각은 상품 수정일(`modDt`)이라 가격·재고만 바꿔도 갱신된다 (상세설명을 바꾼 시각과 다를 수 있음)
   - 온코어 고도몰은 키가 달라 아직 지원하지 않는다

8. **에디터 테스트** (머리말 메뉴, `#tester`) — HTML 을 붙여넣거나 「지금 결과 불러오기」·「변환 내역에서 불러오기」(저장된 HTML 이 있는 작업을 계정에서 검색·20개씩 더 보기)로 넣고 플랫폼(고도몰 / 스마트스토어·쿠팡·11번가·G마켓·옥션·롯데온·하이마트·컴퓨존)을 고르면, 그 에디터에 저장했을 때 지워지는 것·바뀌는 것(<style>·외부 링크·max-width·GIF→jpg·base64 이미지 등)과 상품 페이지 PC·모바일 미리보기(상세 폭·스킨 CSS·가로 넘침)를 보여 준다
   - 근거는 규칙 7-2-1·7-3·7-4 표와 2026-11-25 조사(공식 문서·에디터·사이트 코드·실물·커뮤니티). 처리마다 근거 수준(공식·소스·등록 확인·관찰·커뮤니티·추정)을 붙이고, 공개 근거가 없는 것은 「지워질 수도 있는 것까지 미리 지워 보기」에서만 지운다 (`src/lib/editorSim.ts` — 규칙 표를 고치면 여기도 맞춘다)
   - 실제 에디터 코드가 아닌 흉내라, 처음 쓰는 플랫폼은 실제 등록으로 확인한다
   - 고도몰은 Editor 탭에서 글자를 바로 고치고 SmartEditor 2 도구(글꼴·크기·굵게·기울임·밑줄·취소선·정렬·링크)로 꾸며 볼 수 있다 — 테스트라 쇼핑몰에는 저장하지 않고, 고친 HTML 은 입력 칸(이 탭의 임시 저장)에만 들어간다 (`src/components/SeEditor.tsx`). PC 미리보기는 상세페이지 양옆의 빈 쇼핑몰 바탕을 잘라 보여 준다

## 구조

```
core/              생성 공용 코드 (로컬 서버·Supabase 함수가 같이 씀, Node·Deno 공용)
  prompt.ts        서비스 지시 + 규칙 + PSD 자료 → 계획·섹션 메시지 (규칙·계획은 프롬프트 캐시)
  run.ts           Claude 스트리밍 호출 (adaptive thinking, 거절 시 서버 자동 대체 모델, 시간 제한), 비용 계산
  validate.ts      요청 검사
supabase/functions/pagefy/  배포 생성 서버 (index.ts·deno.json. core/·shared/ 는 build:function 이 복사)
server/            로컬 API 서버 (/api/health·plan·section, MOCK=1 예시 결과, 규칙은 공유 폴더에서 바로 읽음)
src/lib/psd/       PSD 읽기 (ag-psd, 웹 워커): extract 값 추출 · composite/effects 글자 뺀 배경 합성 · worker 타일·자르기
src/lib/api.ts     생성 요청 (배포 = Supabase 함수 + 로그인 토큰, 개발 = /api)
src/lib/supabase.ts 광고 인사이트와 같은 Supabase·권한 확인
src/lib/output.ts  응답 해석 + 자동 점검 (6-1·7·8-4절 중 코드로 볼 수 있는 것)
src/lib/assemble.ts 계획 + 섹션 → 7-1 모양 HTML
src/lib/layoutCheck.ts  PSD 위치 대조
shared/types.ts    화면·서버 공용 타입
rules/             규칙 사본 (배포 함수가 읽음 — 원본은 공유 폴더, yarn sync:rules 로 맞춤)
scripts/           check-psd(요약 점검) · sync-rules · build-function
```

## 알아 둘 한계

- 섹션을 따로 만들어 합치므로, 섹션 사이 스타일 통일은 계획 단계(공통 CSS·지침)에 달렸다. 어긋나면 해당 섹션만 수정 요청
- "글자 뺀 배경"은 브라우저로 다시 합성한 것이다. 드롭 섀도·외부 광선·색상/그라데이션 오버레이·획은 근사해서 그리지만 **조정 레이어와 내부 그림자·경사·새틴·패턴 효과는 빠진다**. 그런 영역은 "그 섹션은 원본 합성으로 / 레이어로 잘라 줘" 라고 수정 요청
- 사진 띠(`img`)는 PSD 원본 합성에서 자르므로 정확하다. 글자와 겹치면 자동 점검이 경고한다
- 메모리 절약을 위해 PSD를 연 뒤 큰 레이어 픽셀은 놓아준다 → `layer` 소스(투명 PNG)로 자를 수 있는 것은 텍스트·작은 레이어(100만 px 이하)뿐
- 큰 PSD(수백 MB)는 PC 메모리를 많이 쓴다. 메모리가 부족하면 읽다가 멈출 수 있다
- 제품슬러그는 브라우저에 제품명별로 기억한다 (규칙 6-1). 다른 PC에서는 기존 HTML의 이미지 주소를 보고 맞춘다
- 웹폰트 표(규칙 5절)에 없는 폰트는 대체하지 않고 경고만 한다 → 규칙 표에 추가하거나 이미지로 굽도록 지시
- 움직이는 GIF는 만들 수 없다 (정지 이미지로 저장 + 경고)
- 비용은 PSD 크기·섹션 수에 따라 다르다 (결과 화면에 실제 토큰·비용 합계 표시)
