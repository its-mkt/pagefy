// 광고 인사이트(ad-insight)와 같은 Supabase 프로젝트·계정을 쓴다.
// its.itket.com 안에서는 주소(origin)가 같아서 광고 인사이트에 로그인돼 있으면 여기서도 그대로 로그인돼 있다.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://tqxljgmygvanysqnhiar.supabase.co';
/** 공개용 키 (브라우저에 들어가도 되는 값 — 광고 인사이트와 같음) */
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable__Oq9NpOHnxEqRSZ02qJDaw_n-FIAGC2';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** 광고 인사이트 수집기 웹앱 (권한 판정) */
const ROLE_URL = 'https://script.google.com/macros/s/AKfycbzQS9yMlp9L_eRaH77QWLsY6GOY7L5hyRk1fkuaAHg8GvJmHHwhPRgr2zWldgbX5-cNcg/exec';

export type Role = 'admin' | 'manager' | 'member' | 'pending' | 'rejected' | 'revoked' | 'none' | 'invalid' | 'guest';
export const canUse = (r: Role | null) => r === 'admin' || r === 'manager' || r === 'member';

export async function fetchRole(token: string): Promise<Role | null> {
  if (!token) return 'guest';
  try {
    const r = await fetch(`${ROLE_URL}?whoami=1&access_token=${encodeURIComponent(token)}`);
    return ((await r.json()) as { role?: Role }).role || null;
  } catch {
    return null;
  }
}

/** 아이디만 입력하면 @gmail.com 을 붙인다 (광고 인사이트와 같은 규칙) */
export const toLoginEmail = (id: string) => {
  const v = id.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@gmail.com`;
};

export async function currentToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}
