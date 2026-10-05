import { useEffect, useState, lazy, Suspense } from 'react';
import { getUser, handleAuthCallback, logout } from '@netlify/identity';
import { LayoutDashboard, Users, Send, FileText, ChartNoAxesCombined, Settings, Radio, ArrowUpRight, Check, LogOut, Menu, ShieldCheck } from 'lucide-react';
import { Auth } from '../components/Auth';
import { api, type Session, type Summary } from '../lib/api';
import { can } from '../lib/permissions';
import { id } from '../i18n/id';
const ContactsPage=lazy(()=>import('../features/contacts/ContactsPage').then(module=>({default:module.ContactsPage})));
const CampaignsPage=lazy(()=>import('../features/campaigns/CampaignsPage').then(m=>({default:m.CampaignsPage})));
const TemplatesPage=lazy(()=>import('../features/campaigns/TemplatesPage').then(m=>({default:m.TemplatesPage})));
const paths = ['/dashboard', '/contacts', '/campaigns', '/templates', '/analytics', '/settings'];
const icons = [LayoutDashboard, Users, Send, FileText, ChartNoAxesCombined, Settings];
// Run once, including under development StrictMode; callback tokens are single use.
const bootstrap = import.meta.env.DEV && !location.hash ? Promise.resolve(null) : handleAuthCallback();
export default function App() {
  const [user, setUser] = useState<Session | null>(null);
  const [demo, setDemo] = useState(false);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'login' | 'invite' | 'recovery'>('login');
  const [token, setToken] = useState<string>();
  const [error, setError] = useState('');
  const [path, setPath] = useState(location.pathname);
  const [menu, setMenu] = useState(false);
  const [summary, setSummary] = useState<Summary>();
  const [settings, setSettings] = useState<{workspace_name: string; timezone: string}>();
  const [busy, setBusy] = useState(false);
  function navigate(next: string) { history.pushState({}, '', next); setPath(next); setMenu(false); }
  async function loadSession() {
    const session = await api<Session>('session'); setUser(session); setMode('login'); setToken(undefined); navigate('/dashboard');
  }
  useEffect(() => {
    let active = true;
    bootstrap.then(async result => {
      if (!active) return;
      if (result?.type === 'invite') { setToken(result.token); setMode('invite'); }
      else if (result?.type === 'recovery') setMode('recovery');
      else if (await getUser()) { const session = await api<Session>('session'); if (active) setUser(session); }
    }).catch(() => { if (active) setError(id.authError); }).finally(() => { if (active) setReady(true); });
    const back = () => setPath(location.pathname); window.addEventListener('popstate', back);
    return () => { active = false; window.removeEventListener('popstate', back); };
  }, []);
  async function refresh() {
    setError(''); setBusy(true);
    try {
      if (demo) { setSummary(await api<Summary>('dashboard',{},true)); setSettings({workspace_name:'codematt Relay', timezone:'Asia/Jakarta'}); }
      else {
        setSummary(await api<Summary>('dashboard'));
        if (user && can(user.roles, 'settings:read')) setSettings(await api('settings'));
      }
    } catch (e) { setError(e instanceof Error ? e.message : id.authError); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (user || demo) void refresh(); }, [user, demo, path]); // Refresh when session or page changes.
  async function exit() {
    try { if (!demo) await logout(); setUser(null); setDemo(false); setSummary(undefined); setSettings(undefined); navigate('/login'); }
    catch { setError(id.authError); }
  }
  if (!ready) return <main className="loading" role="status">{id.loading}</main>;
  if ((!user && !demo) || mode !== 'login') return <>{error && <div role="alert" className="error">{error}</div>}<Auth mode={mode} token={token} onDone={loadSession} onDemo={import.meta.env.DEV && mode === 'login' ? () => {setDemo(true); setError(''); navigate('/dashboard');} : undefined}/></>;
  const index = paths.indexOf(path === '/' ? '/dashboard' : path);
  const settingsAllowed = demo || (user && can(user.roles, 'settings:read'));
  return <div className="shell">
    <aside className={menu ? 'sidebar open' : 'sidebar'}>
      <a className="brand" href="/dashboard" onClick={e => {e.preventDefault(); navigate('/dashboard');}}><Radio/><span><small>codematt</small><strong>Relay</strong></span></a>
      <div className="workspace"><span className="avatar">R</span><span><strong>{settings?.workspace_name || 'codematt Relay'}</strong><small>Communication workspace</small></span></div>
      <p className="nav-label">WORKSPACE</p><nav aria-label="Navigasi utama">{paths.map((href, i) => {const Icon = icons[i]; return <a key={href} href={href} aria-current={index === i ? 'page' : undefined} onClick={e => { e.preventDefault(); navigate(href); }}><Icon size={18}/>{id.nav[i]}{i > 1 && i < 5 && <span className="nav-dot"/>}</a>;})}</nav>
      <div className="sidebar-bottom"><ShieldCheck size={20}/><strong>Consent comes first.</strong><p>Hubungan baik dimulai dari persetujuan.</p><button className="text-button" onClick={exit}><LogOut size={16}/>{id.logout}</button></div>
    </aside>
    <div className="main-wrap"><header className="topbar"><button className="menu-button" aria-label="Buka navigasi" aria-expanded={menu} onClick={() => setMenu(!menu)}><Menu/></button><span>Workspace <span className="muted">/ {id.nav[index] || 'Halaman'}</span></span><span className="account">{demo ? 'Preview lokal' : user?.email}<span className="avatar small">R</span></span></header>
    {demo && <div className="demo-banner">{id.demo}</div>}
    <main id="main" className="content"><div className="page-heading"><div><p className="eyebrow">{id.foundation}</p><h1>{index === 0 ? id.welcome : id.nav[index] || 'Halaman tidak ditemukan'}</h1><p className="muted">{index === 0 ? id.intro : id.tagline}</p></div><span className="badge neutral">{demo ? 'DEMO' : user?.roles.join(' · ')}</span></div>
    {error && <div role="alert" className="error">{error} <button className="text-button" disabled={busy} onClick={refresh}>{id.retry}</button></div>}
    {index === 0 ? <>
      <section className="metrics" aria-label={id.dashboard}>{[['Kontak',summary?.contacts,Users],['Campaign',summary?.campaigns,Send],['Template',summary?.templates,FileText]].map(([label,value,Icon]) => { const MetricIcon = Icon as typeof Users; return <article className="metric" key={String(label)}><div><span>{String(label)}</span><MetricIcon size={18}/></div><strong>{value === undefined ? '—' : Number(value).toLocaleString('id-ID')}</strong><small>{demo ? 'Database demo lokal' : 'Total workspace'}</small></article>;})}</section>
      <div className="dashboard-grid"><section className="panel onboarding"><span className="badge">MULAI DARI SINI</span><h2>{id.start}</h2><p className="muted">Empat langkah menuju campaign pertama Anda.</p><ol>{id.steps.map((step,i) => <li key={step}><span className="step-number">{i+1}</span><span>{step}</span><span className="muted">Phase {i === 0 ? 4 : i === 1 ? '2 · tersedia' : '3 · tersedia'}</span></li>)}</ol></section>
      <section className="panel integration"><div className="integration-icon"><Radio size={25}/></div><h2>{id.integration}</h2><span className="badge neutral">{id.disconnected}</span><p className="muted">{id.integrationInfo}</p><a href="/settings" onClick={e=>{e.preventDefault();navigate('/settings');}}>Lihat pengaturan <ArrowUpRight size={17}/></a></section></div>
      <section className="panel"><div className="section-title"><h2>Campaign workspace</h2><span className="muted">Aktivitas workspace</span></div><div className="empty"><Send size={28}/><h3>{summary?.campaigns?`${summary.campaigns} campaign tersimpan`:id.noCampaign}</h3><p>{id.noCampaignInfo}</p><a className="button" href="/campaigns" onClick={e=>{e.preventDefault();navigate('/campaigns');}}>Buka Campaigns</a></div></section>
    </> : index === 1 ? <Suspense fallback={<p role="status">Memuat kontak…</p>}><ContactsPage demo={demo} allowed={Boolean(demo || (user && can(user.roles,'contacts:write')))} onChange={()=>void refresh()}/></Suspense> : index === 2 ? <Suspense fallback={<p role="status">Memuat campaign…</p>}><CampaignsPage demo={demo} allowed={Boolean(demo||(user&&can(user.roles,'campaigns:write')))} onChange={()=>void refresh()}/></Suspense> : index === 3 ? <Suspense fallback={<p role="status">Memuat template…</p>}><TemplatesPage demo={demo} allowed={Boolean(demo||(user&&can(user.roles,'campaigns:write')))} canSync={Boolean(demo||(user&&can(user.roles,'templates:sync')))} onChange={()=>void refresh()}/></Suspense> : index === 5 ? <section className="panel"><h2>{id.settings}</h2>{settingsAllowed ? <><dl><dt>{id.name}</dt><dd>{settings?.workspace_name || '—'}</dd><dt>{id.timezone}</dt><dd>{settings?.timezone || '—'}</dd><dt>{id.integration}</dt><dd>{id.disconnected}</dd></dl><p className="muted">{id.setup}</p></> : <p>{id.settingsRestricted}</p>}</section> : index === 4 ? <section className="panel empty"><ChartNoAxesCombined size={32}/><h2>{id.noAnalytics}</h2><p>{id.noAnalyticsInfo}</p></section> : index >= 0 ? <section className="panel"><h2>{id.unavailable}</h2><p className="muted">{id.roadmap}</p><ol className="roadmap">{id.modules.map((text,i)=><li key={text}><span className={i === 0 ? 'done' : ''}>{i === 0 ? <Check size={18}/> : i+1}</span>{text}</li>)}</ol></section> : <a href="/dashboard">Kembali ke Dashboard</a>}
    <footer><span>codematt Relay</span><span>{id.tagline}</span></footer></main></div>
  </div>;
}
