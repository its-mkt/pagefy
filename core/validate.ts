// 요청 검사 (로컬 서버·Supabase 함수 공용)
import type { GenerateMeta, PlanRequest, SectionRequest } from '../shared/types.ts';

function checkMeta(m: GenerateMeta | undefined): string | null {
  if (!m) return '요청 자료가 비어 있습니다.';
  if (!['itket', 'oncore', 'openmarket'].includes(m.channel)) return '채널 값이 올바르지 않습니다.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.slug || '')) return '제품슬러그는 영문 소문자·숫자·하이픈만 씁니다 (규칙 6-1).';
  if (!/^\d{8}(-\d+)?$/.test(m.rev || '')) return 'rev 는 YYYYMMDD 또는 YYYYMMDD-2 형식입니다 (규칙 6-1).';
  if (!/^https:\/\//.test(m.publicRoot || '')) return '이미지 공개 주소는 https:// 로 시작해야 합니다 (규칙 6절).';
  return null;
}

export function validatePlan(b: PlanRequest): string | null {
  const e = checkMeta(b?.meta);
  if (e) return e;
  if (!b.summary || !Array.isArray(b.tiles)) return '요청 자료가 비어 있습니다.';
  if (b.tiles.length > 90) return `타일이 너무 많습니다 (${b.tiles.length}장). PSD 높이를 확인하세요.`;
  return null;
}

export function validateSection(b: SectionRequest): string | null {
  const e = checkMeta(b?.meta);
  if (e) return e;
  if (!b.bundle?.plan?.sections || !b.sectionId || !Array.isArray(b.tiles) || !b.doc) return '섹션 요청 자료가 비어 있습니다.';
  if (!b.bundle.plan.sections.some((s) => s.id === b.sectionId)) return `계획에 없는 섹션입니다: ${b.sectionId}`;
  if (b.tiles.length > 20) return `섹션 타일이 너무 많습니다 (${b.tiles.length}장).`;
  return null;
}
