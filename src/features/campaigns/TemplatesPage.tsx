import {useEffect,useState} from 'react';
import {RefreshCw,FileText} from 'lucide-react';
import {api} from '../../lib/api';
import {Modal} from '../../components/Modal';
import type {Template} from './model';
export type TemplatesResponse={items:Template[];configured:boolean;demo:boolean;last_sync:string|null};
export function TemplateContent({template}:{template:Template}) {
 return <div className="template-content">{template.components.map((c,i)=><section key={i}><small className="eyebrow">{c.type}{c.format?' · '+c.format:''}</small>{c.text&&<p>{c.text}</p>}{c.buttons?.map((b,j)=><div className="preview-button" key={j}>{b.text}<small>{b.url??b.phone_number??b.type}</small></div>)}{!c.text&&!c.buttons&&<p className="muted">Komponen nonteks · hanya dapat dilihat.</p>}</section>)}</div>;
}
export function TemplatesPage({demo,allowed,canSync,onChange}:{demo:boolean;allowed:boolean;canSync:boolean;onChange:()=>void}) {
 const [data,setData]=useState<TemplatesResponse>();const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [selected,setSelected]=useState<Template>();const [q,setQ]=useState('');const [status,setStatus]=useState('all');
 async function load(){setBusy(true);setError('');try{setData(await api<TemplatesResponse>('templates',{},demo));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{if(allowed)void load();},[allowed,demo]);
 async function sync(){setBusy(true);setError('');setMessage('');try{const r=await api<{count:number}>('templates/sync',{method:'POST'},demo);setData(await api<TemplatesResponse>('templates',{},demo));setMessage(`${r.count} template ${demo?'contoh dimuat':'berhasil disinkronkan'}.`);onChange();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(!allowed)return <section className="panel">Template hanya tersedia untuk admin dan operator.</section>;
 const items=data?.items.filter(t=>(t.name+' '+t.language).toLowerCase().includes(q.toLowerCase())&&(status==='all'||(status==='usable'?t.usable:t.status===status)))??[];
 return <>
  <div className="contacts-heading"><div><h2>Template pesan</h2><p className="muted">Status dari Meta dan konten template yang tersedia untuk campaign.</p></div><div className="toolbar-actions"><button className="button" disabled={busy} onClick={load}>Muat ulang</button><button className="button accent" disabled={busy||!canSync} onClick={sync}><RefreshCw size={16}/>{busy?'Memuat…':demo?'Muat template contoh':'Sinkronkan Template'}</button></div></div>
  {demo&&<p className="local-note">SIMULASI · Template dan status contoh dibuat untuk latihan lokal, bukan persetujuan dari Meta.</p>}
  {!canSync&&<p className="local-note">Minta admin melakukan sinkronisasi template.</p>}
  {data&&!data.configured&&<p className="local-note">Koneksi template belum dikonfigurasi. Admin perlu mengisi kredensial Meta di server, sesuai panduan Phase 3.</p>}
  {error&&<div className="error" role="alert">{error}</div>}{message&&<p className="success-message" role="status">{message}</p>}
  <section className="contact-panel"><div className="campaign-filters"><label>Cari template<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Nama atau bahasa"/></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Semua status</option><option value="usable">Bisa dipakai di builder</option>{['APPROVED','PENDING','REJECTED','PAUSED','DISABLED','UNAVAILABLE'].map(s=><option key={s}>{s}</option>)}</select></label></div>
  <p className="sync-caption">Sinkronisasi terakhir: {data?.last_sync?new Date(data.last_sync).toLocaleString('id-ID'):'Belum pernah'} · Sinkronkan ulang setelah 24 jam. Maksimal 1.000 template ditampilkan, mengutamakan akun aktif.</p>
  {items.length?<div className="table-scroll"><table><thead><tr><th>Template</th><th>Kategori / bahasa</th><th>Status {demo?'simulasi':'Meta'}</th><th>Ketersediaan</th><th/></tr></thead><tbody>{items.map(t=><tr key={t.id}><td><strong>{t.name}</strong><small className="phone-text">{new Date(t.synced_at).toLocaleString('id-ID')}</small></td><td>{t.category}<small className="phone-text">{t.language}</small></td><td><span className={'status-chip '+(t.status==='APPROVED'?'active':'')}>{t.status}</span></td><td>{t.usable?'Bisa dipakai':t.reason}</td><td><button className="button" onClick={()=>setSelected(t)}>Lihat</button></td></tr>)}</tbody></table></div>:<div className="empty"><FileText/><h3>Belum ada template yang cocok.</h3><p>{demo?'Klik Muat template contoh untuk mencoba builder.':'Hubungkan WhatsApp Business dan sinkronkan template.'}</p></div>}</section>
  {selected&&<Modal title={selected.name} onClose={()=>setSelected(undefined)}><p className="muted">{selected.language} · {selected.category} · {selected.status}{demo?' (simulasi)':''}</p><TemplateContent template={selected}/><p className="field-help">Variabel: {selected.variables.join(', ')||'Tidak ada'}</p>{selected.reason&&<p className="local-note">{selected.reason}</p>}<details><summary>Detail komponen</summary><pre className="component-json">{JSON.stringify(selected.components,null,2)}</pre></details></Modal>}
 </>;
}
