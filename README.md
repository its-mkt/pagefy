# Pagefy — 통이미지 디자인 → HTML 마크업

**https://its.itket.com/pagefy/** · 저장소 `its-mkt/pagefy` · 폴더 `C:\0.Project\pagefy`

PSD를 올리면 마케팅팀 규칙(`\\192.168.1.254\마케팅팀\A_상세페이지\detail_to_markup.md`)대로
Claude가 상세페이지 HTML을 만들어 주는 웹 서비스.

React + TypeScript + SCSS + Vite (yarn) / 생성 서버: Supabase Edge Function(배포) · Express(로컬) + Anthropic SDK

## 구성

```
브라우저 (its.itket.com/pagefy, GitHub Pages)
  ├─ PSD 읽기·합성·이미지 자르기·위치 대조 — 전부 브라우저(워커) 안. PSD 파일은 서버로 안 감
  ├─ 로그인: 광고 인사이트 계정 (같은 Supabase, 승인된 계정만)
  └─ 생성 요청 → Supabase 함수 pagefy (Claude API 키는 함수 비밀값에만)
        ① /plan    계획: 섹션·이미지·공통 스타일·작성 지침
        ② /section 섹션별 마크업 (4개씩 동시에) → 화면에서 합쳐 HTML 완성
```

무료 Supabase 함수는 한 번에 150초까지만 돌아서, 한 번에 다 만들지 않고 **계획 + 섹션별**로 나눴다.
섹션 하나는 140초가 넘으면 끊고 알린다 (→ 그 섹션만 다시 수정 요청).

## 로컬 개발

```bash
yarn install
cp .env.example .env      # ANTHROPIC_API_KEY 채우기 (console.anthropic.com → API Keys)
yarn dev                  # 화면 http://localhost:1100  (로컬 API 서버 1101 같이 켜짐, 로그인 없음)
```

- API 키 없이 화면 흐름만 볼 때: `MOCK=1 yarn dev` → Claude를 부르지 않고 예시 결과 (비용 없음)
- 로컬 화면에서 배포된 Supabase 함수를 쓰려면 `VITE_PAGEFY_CLOUD=1 yarn dev:web` (로그인 필요)

## 배포

| 무엇 | 어떻게 | 반영 |
|---|---|---|
| 화면 | `main` 에 push → GitHub Actions 가 빌드해 Pages 로 (`.github/workflows/deploy.yml`) | 1~2분 |
| 규칙 | 공유 폴더 원본 수정 → `yarn sync:rules` → `rules/` 커밋·push. 함수가 GitHub 사본을 10분마다 다시 읽음 | 10분 이내 |
| 생성 서버 | `yarn build:function` → `supabase/functions/pagefy` 를 Supabase 프로젝트 `ad-insight DB` 에 함수 `pagefy` 로 배포 (JWT 검사 끔 — 함수가 직접 권한 확인) | 즉시 |
| Claude API 키 | Supabase 대시보드 → Edge Functions → Secrets → `ANTHROPIC_API_KEY` (저장소·채팅에 적지 않음) | 즉시 |

함수 비밀값(선택): `PAGEFY_MODEL`(기본 `claude-opus-5-5`), `PAGEFY_EFFORT`(기본 `medium`)

## 쓰는 법

1. **로그인** — 광고 인사이트 계정. 같은 its.itket.com 안이라 광고 인사이트에 로그인돼 있으면 그대로 들어간다. 가입·승인은 광고 인사이트에서
2. **PSD 올리기** — 파일은 브라우저 안에서만 읽는다. 서버로는 레이어·텍스트 값과 축소 렌더 타일만 간다
3. **PSD 확인** — 크기·사용/숨김 레이어·폰트·경고. "글자 뺀 배경"이 PSD 합성과 비슷한지 본다
4. **설정** — 제품명, 채널 폴더(아이티켓·온코어 = 고도몰용 / 오픈마켓 = 인라인 전용), 제품슬러그, rev, 추가 지시
5. **결과** — 섹션별 진행 → 자동 점검, 미리보기(PSD와 나란히 · 모바일 360px), HTML(복사 구간만 복사), 완료 보고, 이미지
   - **PSD 위치 대조**(자동): 텍스트 레이어마다 첫 줄 기준선·가로 위치를 PSD 값과 비교 (규칙 4-1 기준 세로 ±3px·가로 ±6px) + 모바일 360px 가로 스크롤. 기존 검증본 ZGX HTML 로 104/104 통과 확인
   - **대조 결과로 고치기**: 어긋난 텍스트가 있는 섹션만 골라 다시 만든다
   - **수정 요청**: 섹션을 고르고 고칠 점을 적으면 그 섹션만 다시 만든다
   - **zip 내려받기** = 제품 폴더 모양 그대로 (`<제품명>/<제품명>.html`, `img/<rev>/…`)
6. 이미지 업로드는 기존 도구로: `node C:\Users\user\.claude\tools\psd2html\upload.js <제품폴더> <채널> <슬러그> <rev>`
   업로드 후 이미지 주소가 열리는지, 실제 채널에 붙여넣어 깨지지 않는지 확인 (규칙 9절)

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
