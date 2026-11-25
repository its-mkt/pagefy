// 로컬 API 서버: 개발 중 화면(Vite)에서 /api 로 들어온 요청을 받아 Claude API 를 부른다
// 배포(its.itket.com/pagefy)에서는 같은 일을 Supabase 함수(supabase/functions/pagefy)가 한다 — 둘 다 core/ 를 쓴다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { HealthInfo, PlanRequest, SectionRequest, StreamEvent } from '../shared/types.ts';
import { buildPlanMessages, buildSectionMessages, buildSystem } from '../core/prompt.ts';
import { runClaude, usageOfError } from '../core/run.ts';
import { validatePlan, validateSection } from '../core/validate.ts';
import { EFFORT, MODEL, PLAN_RUN, RUN, describeError, getClient } from './claude.ts';
import { mockPlanOutput, mockSectionOutput, mockStream } from './mock.ts';
import { loadRules } from './rules.ts';
import { type UploadFile, type UploadTarget, checkFolder, checkTarget, deleteFiles, putFiles, undoUpload, verifyFiles, type UploadedItem } from '../core/upload.ts';
import { localFtpConfig, nodeDial, readSecretsFile } from './ftpNode.ts';
import { checkGoodsNo, fetchGoods, godoConfigFrom } from '../core/godo.ts';
import { localBudget, opsRouter } from './opsLocal.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.API_PORT || 1101);
const MOCK = process.env.MOCK === '1';
const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const app = express();
/** 배포 주소 경로. 화면은 /pagefy/, API 는 /pagefy/api/… (개발 중 Vite 프록시용 /api/… 도 같이 받는다) */
const BASE_PATH = '/pagefy';
const api = express.Router();
// 다른 사이트가 DNS 를 바꿔 이 PC 의 서버를 부르는 것 막기 (API 키로 Claude 를 부르는 /plan·/section 도): 주소가 localhost·127.0.0.1 일 때만
api.use((req, res, next) => {
  if (['localhost', '127.0.0.1'].includes(req.hostname)) return next();
  res.status(403).json({ error: '이 PC 에서 연 화면에서만 쓸 수 있습니다.' });
});

api.get('/health', (_req, res) => {
  let rules: HealthInfo['rules'] = { source: '(없음)', updatedAt: null, fallback: true };
  try {
    const r = loadRules();
    rules = { source: r.source, updatedAt: r.updatedAt, fallback: r.fallback };
  } catch {
    // 규칙 파일이 없으면 화면에 표시
  }
  const body: HealthInfo = { ok: true, mock: MOCK, hasKey: hasKey(), model: MODEL, effort: EFFORT, planEffort: PLAN_RUN.effort, rules, upload: !!localFtpConfig(), budget: localBudget(), godo: !!godoConfig() };
  res.json(body);
});

api.get('/rules', (_req, res) => {
  try {
    res.json(loadRules());
  } catch (err) {
    res.status(500).json({ error: describeError(err) });
  }
});

/** SSE 응답을 열고 작업을 돌린다 */
async function streamTo(res: express.Response, work: (send: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  const send = (e: StreamEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ac = new AbortController();
  res.on('close', () => ac.abort()); // 화면에서 취소하거나 창을 닫으면 Claude 요청도 끊는다
  try {
    await work(send, ac.signal);
  } catch (err) {
    if (!ac.signal.aborted) send({ type: 'error', message: describeError(err), ...usageOfError(err) });
  } finally {
    res.end();
  }
}

/** 단계별 걸린 시간을 서버 콘솔에 남긴다 (Supabase 150초 제한 안에 드는지 보려고) */
function timed(label: string, effort: string, send: (e: StreamEvent) => void) {
  const t0 = Date.now();
  let first = 0;
  return (e: StreamEvent) => {
    if (!first && e.type === 'text') first = Date.now();
    if (e.type === 'done') console.log(`[${label}] ${((Date.now() - t0) / 1000).toFixed(1)}s (첫 글자 ${first ? ((first - t0) / 1000).toFixed(1) : '-'}s) effort=${effort} out=${e.usage.output} cacheRead=${e.usage.cacheRead} $${e.usage.costUsd}`);
    send(e);
  };
}

function precheck(res: express.Response, problem: string | null) {
  if (problem) {
    res.status(400).json({ error: problem });
    return false;
  }
  if (!MOCK && !hasKey()) {
    res.status(400).json({ error: 'API 키가 없습니다. .env 에 ANTHROPIC_API_KEY 를 넣고 서버를 다시 켜세요 (또는 MOCK=1 로 화면 점검).' });
    return false;
  }
  return true;
}

api.post('/plan', express.json({ limit: '80mb' }), async (req, res) => {
  const body = req.body as PlanRequest;
  if (!precheck(res, validatePlan(body))) return;
  await streamTo(res, async (send, signal) => {
    if (MOCK) return mockStream(mockPlanOutput(body), send, signal);
    const rules = loadRules();
    send({ type: 'status', message: `규칙: ${rules.source}${rules.fallback ? ' (공유 폴더 접근 불가 → 사본 사용)' : ''}` });
    send({ type: 'status', message: `계획 요청 중… (타일 ${body.tiles.length}장, 텍스트 ${body.summary.texts.length}개)` });
    await runClaude(getClient(), PLAN_RUN, buildSystem(rules.text), buildPlanMessages(body), timed('plan', PLAN_RUN.effort, send), signal);
  });
});

api.post('/section', express.json({ limit: '40mb' }), async (req, res) => {
  const body = req.body as SectionRequest;
  if (!precheck(res, validateSection(body))) return;
  await streamTo(res, async (send, signal) => {
    if (MOCK) return mockStream(mockSectionOutput(body), send, signal);
    await runClaude(getClient(), RUN, buildSystem(loadRules().text), buildSectionMessages(body), timed(`section ${body.sectionId}`, RUN.effort, send), signal);
  });
});

// ───── 이미지 호스팅 업로드 (규칙 6절, core/upload.ts) ─────
// 접속 정보가 없으면 503. 같은 이름 파일은 화면이 확인받은 것만 덮어쓴다 (옛 파일은 숨김 백업). 이 서버는 127.0.0.1 에서만 받는다
function uploadGuard(req: express.Request, res: express.Response) {
  // 다른 사이트가 DNS 를 바꿔 이 PC 의 서버를 부르는 것 막기: 주소가 localhost·127.0.0.1 일 때만
  if (!['localhost', '127.0.0.1'].includes(req.hostname)) {
    res.status(403).json({ error: '이 PC 에서 연 화면에서만 올릴 수 있습니다.' });
    return null;
  }
  const cfg = localFtpConfig();
  if (!cfg) {
    res.status(503).json({ error: '이미지 서버 접속 정보가 없습니다 (~/.claude/secrets/nhn-image-ftp.env 또는 PAGEFY_FTP_* 환경변수).' });
    return null;
  }
  const t = (req.body?.target ?? null) as UploadTarget;
  const problem = checkTarget(cfg, t);
  if (problem) {
    res.status(400).json({ error: problem });
    return null;
  }
  return { cfg, t };
}

api.post('/upload/check', express.json(), async (req, res) => {
  const g = uploadGuard(req, res);
  if (!g) return;
  try {
    res.json(await checkFolder(g.cfg, nodeDial, g.t));
  } catch (err) {
    res.status(502).json({ error: describeError(err) });
  }
});

api.post('/upload/files', express.json({ limit: '12mb' }), async (req, res) => {
  const g = uploadGuard(req, res);
  if (!g) return;
  try {
    const out = await putFiles(g.cfg, nodeDial, g.t, req.body.files as UploadFile[], (req.body.overwrite as string[]) ?? []);
    const over = out.done.filter((d) => d.backup).length;
    console.log(`[upload] ${g.t.channel}/${g.t.slug} 올림 ${out.done.length}개${over ? ` (덮어씀 ${over}개)` : ''}${out.refused.length ? ` · 거절 ${out.refused.length}개` : ''}`);
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: describeError(err) });
  }
});

api.post('/upload/verify', express.json(), async (req, res) => {
  const g = uploadGuard(req, res);
  if (!g) return;
  res.json({ results: await verifyFiles(g.cfg, g.t, req.body.files || []) });
});

// 잘못 올린 것 되돌리기 — 이번에 올린 파일만: 덮어쓴 것은 백업으로 되돌리고 새로 올린 것은 지운다 (core/upload.ts undoUpload)
api.post('/upload/remove', express.json(), async (req, res) => {
  const g = uploadGuard(req, res);
  if (!g) return;
  try {
    const out = await undoUpload(g.cfg, nodeDial, g.t, req.body.items as UploadedItem[]);
    console.log(`[upload] ${g.t.channel}/${g.t.slug} 되돌림 — 복원 ${out.restored.length}개 · 지움 ${out.removed.length}개${out.failed.length ? ` · 실패 ${out.failed.length}개` : ''}`);
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: describeError(err) });
  }
});

// 변환 내역 「이미지 서버에서 지우기」 — 화면이 고른 파일과 그 숨김 백업을 지운다 (core/upload.ts deleteFiles)
api.post('/upload/delete', express.json(), async (req, res) => {
  const g = uploadGuard(req, res);
  if (!g) return;
  try {
    const out = await deleteFiles(g.cfg, nodeDial, g.t, req.body.files as string[]);
    console.log(`[upload] ${g.t.channel}/${g.t.slug} 지움 ${out.removed.length}개 (백업 ${out.backups}개${out.missing.length ? ` · 이미 없음 ${out.missing.length}개` : ''}${out.failed.length ? ` · 실패 ${out.failed.length}개` : ''})`);
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: describeError(err) });
  }
});

// ───── 고도몰 등록 확인 (core/godo.ts — 오픈 API 상품 조회, 읽기 전용) ─────
// 키: ~/.claude/secrets/godo-openapi.env (GODO_PARTNER_KEY·GODO_USER_KEY) 또는 PAGEFY_GODO_* 환경변수. 없으면 화면에 확인 상자가 없다
const godoConfig = () => {
  const file = readSecretsFile('godo-openapi.env');
  return godoConfigFrom((k) => process.env[`PAGEFY_GODO_${k}`] || file[`GODO_${k}`]);
};
api.post('/godo/goods', express.json(), async (req, res) => {
  const cfg = godoConfig();
  if (!cfg) return void res.status(503).json({ error: '고도몰 API 키가 없습니다 (~/.claude/secrets/godo-openapi.env 또는 PAGEFY_GODO_* 환경변수).' });
  const no = req.body?.goodsNo;
  const bad = checkGoodsNo(no);
  if (bad) return void res.status(400).json({ error: bad });
  try {
    const goods = await fetchGoods(cfg, no);
    if (!goods) return void res.status(404).json({ error: `고도몰에 상품번호 ${no} 상품이 없습니다.` });
    res.json(goods);
  } catch (err) {
    res.status(502).json({ error: describeError(err) });
  }
});

// 결과 평가·관리 화면 (로컬은 이 PC 메모리 · MOCK 예시 숫자 — server/opsLocal.ts)
api.use(opsRouter);

app.use('/api', api);
app.use(`${BASE_PATH}/api`, api);

// 빌드한 화면(dist)이 있으면 /pagefy/ 에서 같이 서비스 (yarn build → yarn start 로 한 포트에서 사용)
const dist = path.join(HERE, '..', 'dist');
if (fs.existsSync(dist)) {
  app.get('/', (_req, res) => res.redirect(`${BASE_PATH}/`));
  app.use(BASE_PATH, express.static(dist));
  app.get(new RegExp(`^${BASE_PATH}(/(?!api/).*)?$`), (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// 이 PC 에서만 받는다 (사내망에 열면 누구나 인증 없이 이 PC 의 API 키로 생성할 수 있음). 꼭 열어야 하면 API_HOST=0.0.0.0
const HOST = process.env.API_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`[pagefy api] http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}  model=${MODEL} effort=${EFFORT}${MOCK ? '  (MOCK 모드)' : ''}${hasKey() ? '' : '  ⚠ API 키 없음'}`);
});
