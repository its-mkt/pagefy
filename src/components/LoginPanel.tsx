// 로그인 — 회사 계정(광고 인사이트와 같은 계정). 가입·승인 요청·비밀번호 찾기는 광고 인사이트 화면에서 한다
import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, toLoginEmail, type Role } from '../lib/supabase';

/** 계정 관리(가입·승인 요청·비밀번호 찾기)를 하는 곳 */
const ACCOUNT_URL = '/ad-insight/';

/** 권한 상태별 안내 — msg: 지금 상태, next: 할 일, go: 계정 관리 화면으로 보낼 버튼 문구 */
const ROLE_MSG: Partial<Record<Role, { msg: string; next: string; go?: string }>> = {
  pending: { msg: '승인을 기다리는 중입니다.', next: '관리자가 승인하면 바로 쓸 수 있습니다. 급하면 마케팅팀 관리자에게 승인을 요청하세요.' },
  none: { msg: '아직 사용 승인을 요청하지 않은 계정입니다.', next: '계정 관리 화면에서 이름·회사·팀을 적어 승인을 요청하세요.', go: '승인 요청하러 가기' },
  rejected: { msg: '승인 요청이 거절됐습니다.', next: '필요하면 계정 관리 화면에서 다시 요청하거나 마케팅팀 관리자에게 문의하세요.', go: '다시 요청하러 가기' },
  revoked: { msg: '사용 권한이 해제됐습니다.', next: '다시 써야 하면 계정 관리 화면에서 다시 요청하거나 마케팅팀 관리자에게 문의하세요.', go: '다시 요청하러 가기' },
  invalid: { msg: '로그인 정보를 확인하지 못했습니다.', next: '로그인이 만료됐거나 잠시 연결이 끊겼습니다. 다시 로그인해 주세요.' },
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
    if (error) setErr(/invalid/i.test(error.message) ? '아이디 또는 비밀번호가 맞지 않습니다. 비밀번호를 잊었으면 계정 관리 화면에서 찾을 수 있습니다.' : `로그인하지 못했습니다: ${error.message}`);
  }

  if (session) {
    return (
      <section className="panel login">
        <h2 className="panel__title">사용 권한 확인</h2>
        {role === null ? (
          <p className="drop__msg"><span className="spinner" /> 권한 확인 중…</p>
        ) : (
          (() => {
            const m = ROLE_MSG[role] ?? { msg: '승인된 회사 계정만 쓸 수 있습니다.', next: '계정 상태는 계정 관리 화면에서 확인할 수 있습니다.', go: '계정 관리로 가기' };
            return (
              <>
                <p className="msg msg--error">{m.msg}</p>
                <p className="hint">{m.next}</p>
                <p className="hint">로그인한 계정: {session.user.email}</p>
                <div className="actions">
                  {m.go && <a className="btn" href={ACCOUNT_URL}>{m.go}</a>}
                  <button className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>다른 계정으로 로그인</button>
                </div>
              </>
            );
          })()
        )}
      </section>
    );
  }

  return (
    <section className="panel login">
      <h2 className="panel__title">로그인</h2>
      <p className="hint">회사 계정으로 로그인하세요. 광고 인사이트와 같은 계정이라 따로 가입하지 않아도 됩니다.</p>
      <p className="hint">처음 쓰거나 비밀번호를 잊었으면 <a href={ACCOUNT_URL}>계정 관리 화면(광고 인사이트)</a>에서 가입·비밀번호 찾기를 한 뒤 승인을 받으세요.</p>
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
