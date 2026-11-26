// 로그인 — 회사 계정(광고 인사이트와 같은 계정). 가입·승인 요청·비밀번호 찾기는 광고 인사이트 화면에서 한다
import { useState } from 'react';
import { Button } from './Button';
import type { Session } from '@supabase/supabase-js';
import { supabase, toLoginEmail, type Role } from '../lib/supabase';
import { Check, Lock } from 'lucide-react';

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
    if (role === null) {
      return (
        <GateShell icon={<Lock />} title="권한 확인 중" desc="잠시만 기다려 주세요.">
          <p className="gate__wait"><span className="spinner" /> 권한 확인 중…</p>
        </GateShell>
      );
    }
    const m = ROLE_MSG[role] ?? { msg: '승인된 회사 계정만 쓸 수 있습니다.', next: '계정 상태는 계정 관리 화면에서 확인할 수 있습니다.', go: '계정 관리로 가기' };
    return (
      <GateShell icon={<Lock />} title={m.msg} desc={m.next}>
        <div className="gate__actions">
          <span className="gate__account">{session.user.email}</span>
          {m.go && <a className="btn btn--primary" href={ACCOUNT_URL}>{m.go}</a>}
          <Button  onClick={() => supabase.auth.signOut()}>로그아웃</Button>
        </div>
      </GateShell>
    );
  }

  return (
    <GateShell icon={<Lock />} title="로그인하면 사용할 수 있습니다" desc="광고 인사이트와 같은 계정으로 로그인합니다.">
      <form className="gate__form" onSubmit={login}>
        <label className="gate__field">
          <span>이메일 <em className="req" title="필수 입력">*</em></span>
          <input className={`gate__input${err ? ' is-err' : ''}`} name="username" placeholder="이메일" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoFocus required aria-required="true" />
        </label>
        <label className="gate__field">
          <span>비밀번호 <em className="req" title="필수 입력">*</em></span>
          <input className={`gate__input${err ? ' is-err' : ''}`} type="password" name="password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required aria-required="true" />
        </label>
        {err && <p className="gate__error" role="alert">{err}</p>}
        <Button variant="primary" className="gate__submit" disabled={busy}>{busy ? '확인 중...' : '로그인'}</Button>
      </form>
      {/* 비밀번호 찾기·가입은 광고 인사이트 접속 화면에서 (?reset=1 = 비밀번호 찾기로 바로 열림) */}
      <p className="gate__method">
        <a className="link-btn" href={`${ACCOUNT_URL}?reset=1`}>비밀번호를 잊으셨나요?</a>
      </p>
      <p className="gate__switch">
        계정이 없으신가요? <a className="link-btn" href={ACCOUNT_URL}>회원가입</a>
      </p>
    </GateShell>
  );
}

/** 자물쇠 아이콘 (광고 인사이트 접속 화면의 lucide Lock 과 같은 모양) */

/** 접속 화면 한 장 — 광고 인사이트 AccessGate 와 같은 틀: 왼쪽 서비스 소개(강조색) + 오른쪽 카드 */
function GateShell({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className="gate">
      <div className="gate__shell">
        <aside className="gate__brand">
          <p className="gate__brand-name">Pagefy</p>
          <p className="gate__brand-lead">상세페이지 PSD 를 쇼핑몰에 붙여넣을 HTML 마크업으로 바꿉니다.</p>
          <ul className="gate__brand-points">
            <li><Check className="gate__ico" aria-hidden="true" />관리자가 승인한 계정만 사용</li>
            <li><Check className="gate__ico" aria-hidden="true" />광고 인사이트와 같은 계정</li>
            <li><Check className="gate__ico" aria-hidden="true" />PSD 는 이 PC 브라우저 안에서만 읽음</li>
          </ul>
          <p className="gate__brand-foot">계정·권한 문의는 마케팅팀으로 연락해 주세요.</p>
        </aside>
        <section className="gate__card" aria-labelledby="gate-title">
          <div className="gate__icon">{icon}</div>
          <h2 id="gate-title">{title}</h2>
          <p className="gate__desc">{desc}</p>
          {children}
        </section>
      </div>
    </div>
  );
}
