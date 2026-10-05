import { useState, type FormEvent } from 'react';
import { acceptInvite, login, updateUser } from '@netlify/identity';
import { ArrowUpRight, Radio } from 'lucide-react';
import { id } from '../i18n/id';
export function Auth({ mode, token, onDone, onDemo }: { mode: 'login' | 'invite' | 'recovery'; token?: string; onDone: () => Promise<void>; onDemo?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const password = String(data.get('password'));
      if (mode === 'invite') {
        if (!token) throw new Error('Missing invitation');
        await acceptInvite(token, password);
      } else if (mode === 'recovery') await updateUser({ password });
      else await login(String(data.get('email')), password);
      await onDone();
    } catch { setError(id.authError); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-brand"><Radio size={44}/><p className="eyebrow">codematt / COMMUNICATION WORKSPACE</p><h1>Good messages.<br/>Better connections.</h1><p>{id.tagline}</p><div className="auth-foot">01 — CLEAR. CALM. CONSIDERATE.</div></section>
    <section className="auth-form"><div className="brand"><Radio/><span><small>codematt</small><strong>Relay</strong></span></div><p className="eyebrow">{id.foundation}</p><h2>{mode === 'login' ? id.loginTitle : mode === 'invite' ? id.invitation : id.recovery}</h2><p className="muted">{id.loginInfo}</p>
      <form onSubmit={submit}>
        {mode === 'login' && <label>{id.email}<input name="email" type="email" autoComplete="username" required maxLength={254}/></label>}
        <label>{id.password}<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 12} maxLength={128} required/></label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? id.loading : mode === 'login' ? id.login : id.savePassword}<ArrowUpRight size={18}/></button>
      </form>
      {onDemo && <button className="secondary" onClick={onDemo}>{id.preview}</button>}
      <p className="helper">{id.setup}</p>
    </section>
  </main>;
}
