// 로그인 — 광고 인사이트(ad-insight) 계정 그대로. 가입·승인 요청은 광고 인사이트에서 한다
import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, toLoginEmail, type Role } from '../lib/supabase';

const ROLE_MSG: Partial<Record<Role, string>> = {
  pending: '가입 승인을 기다리는 중입니다. 관리자가 승인하면 쓸 수 있습니다.',
  rejected: '가입 요청이 거절됐습니다. 관리자에게 문의하세요.',
  revoked: '사용 권한이 해제됐습니다. 관리자에게 문의하세요.',
  none: '아직 승인 요청을 하지 않은 계정입니다. 광고 인사이트에서 승인 요청을 먼저 하세요.',
  invalid: '로그인이 만료됐습니다. 다시 로그인하세요.',
};

export default function LoginPanel({ session, role }: { session: Session | null; role: Role | null }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: toLoginEmail(id), password: pw });
    setBusy(false);
    if (error) setErr(/invalid/i.test(error.message) ? '아이디 또는 비밀번호가 맞지 않습니다.' : error.message);
  }

  if (session) {
    return (
      <section className="panel login">
        <h2 className="panel__title">사용 권한 확인</h2>
        {role === null ? (
          <p className="drop__msg"><span className="spinner" /> 권한 확인 중…</p>
        ) : (
          <>
            <p className="msg msg--error">{ROLE_MSG[role] || '승인된 계정만 쓸 수 있습니다.'}</p>
            <p className="hint">로그인 계정: {session.user.email}</p>
            <div className="actions">
              <a className="btn" href="/ad-insight/">광고 인사이트로 가기</a>
              <button className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>다른 계정으로 로그인</button>
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="panel login">
      <h2 className="panel__title">로그인</h2>
      <p className="hint">광고 인사이트 계정으로 로그인합니다. 계정이 없으면 <a href="/ad-insight/">광고 인사이트</a>에서 가입하고 승인을 받으세요.</p>
      <form className="form login__form" onSubmit={login}>
        <label>
          <span>아이디 또는 이메일</span>
          <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          <span>비밀번호</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        </label>
        <div className="actions">
          <button className="btn btn--primary" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
        </div>
      </form>
      {err && <p className="msg msg--error">{err}</p>}
    </section>
  );
}
