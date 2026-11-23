// 로컬 API 서버: 개발 중 화면(Vite)에서 /api 로 들어온 요청을 받아 Claude API 를 부른다
// 배포(its.itket.com/pagefy)에서는 같은 일을 Supabase 함수(supabase/functions/pagefy)가 한다 — 둘 다 core/ 를 쓴다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { HealthInfo, PlanRequest, SectionRequest, StreamEvent } from '../shared/types.ts';
import { buildPlanMessages, buildSectionMessages, buildSystem } from '../core/prompt.ts';
import { runClaude } from '../core/run.ts';
import { validatePlan, validateSection } from '../core/validate.ts';
import { EFFORT, MODEL, PLAN_RUN, RUN, describeError, getClient } from './claude.ts';
import { mockPlanOutput, mockSectionOutput, mockStream } from './mock.ts';
import { loadRules } from './rules.ts';
import { type UploadFile, type UploadTarget, checkFolder, checkTarget, putFiles, removeUpload, verifyFiles } from '../core/upload.ts';
import { localFtpConfig, nodeDial } from './ftpNode.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.API_PORT || 1101);
const MOCK = process.env.MOCK === '1';
const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const app = express();
/** 배포 주소 경로. 화면은 /pagefy/, API 는 /pagefy/api/… (개발 중 Vite 프록시용 /api/… 도 같이 받는다) */
const BASE_PATH = '/pagefy';
const api = express.Router();

api.get('/health', (_req, res) => {
  let rules: HealthInfo['rules'] = { source: '(없음)', updatedAt: null, fallback: true };
  try {
    const r = loadRules();
    rules = { source: r.source, updatedAt: r.updatedAt, fallback: r.fallback };
  } catch {
    // 규칙 파일이 없으면 화면에 표시
  }
  const body: HealthInfo = { ok: true, mock: MOCK, hasKey: hasKey(), model: MODEL, effort: EFFORT, rules, upload: !!localFtpConfig() };
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
    if (!ac.signal.aborted) send({ type: 'error', message: describeError(err) });
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
// 접속 정보가 없으면 503. 같은 이름 파일은 덮어쓰지 않는다. 이 서버는 127.0.0.1 에서만 받는다
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
    const out = await putFiles(g.cfg, nodeDial, g.t, req.body.files as UploadFile[]);
    console.log(`[upload] ${g.t.channel}/${g.t.slug}/${g.t.rev} 올림 ${out.done.length}개${out.refused.length ? ` · 거절 ${out.refused.length}개` : ''}`);
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

// 잘못 올린 것 되돌리기 — 이 작업이 올린 폴더만, 폴더 안 파일이 모두 이 결과의 이미지일 때만 (core/upload.ts removeUpload)
api.post('/upload/remove', express.json(), async (req, res) => {
  const g = uploadGuard(req, res);
  if (!g) return;
  try {
    const out = await removeUpload(g.cfg, nodeDial, g.t, req.body.files as string[]);
    console.log(`[upload] ${g.t.channel}/${g.t.slug}/${g.t.rev} 되돌림 ${out.removed.length}개${out.folderRemoved ? " · 폴더 삭제" : ""}`);
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: describeError(err) });
  }
});

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
