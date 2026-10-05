import {useEffect,useState,type FormEvent} from 'react';
import {Modal} from '../../components/Modal';
import type {Contact,ConsentEvent} from './types';
import type {ContactsClient} from './client';
import {labels as c,consentLabel} from './labels';
export function ConsentDialog({contact,client,onClose,onSaved}:{contact:Contact;client:ContactsClient;onClose:()=>void;onSaved:()=>void}) {
  const [status,setStatus]=useState(''),[events,setEvents]=useState<ConsentEvent[]>([]),[page,setPage]=useState(1),[hasMore,setMore]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;client.history(contact.id,page).then(data=>{if(active){setEvents(data.items);setMore(data.hasMore);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client,contact.id,page]);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const form=new FormData(e.currentTarget);try{await client.consent(contact.id,{status,source:String(form.get('source')),occurred_at:form.get('date')?new Date(String(form.get('date'))).toISOString():undefined,confirmed:form.get('confirmed')==='on',version:contact.version});onSaved();}catch(e){setError(e instanceof Error?e.message:'Consent tidak dapat disimpan.');}finally{setBusy(false);}}
  return <Modal title={c.history+' · '+contact.name} onClose={onClose} busy={busy}>
    <span className={'status-chip '+contact.consent_status}>{consentLabel[contact.consent_status]}</span>
    <div className="history-list">{events.length?events.map(event=><article key={event.id}><strong>{consentLabel[event.status]}</strong><small>{new Date(event.occurred_at).toLocaleString('id-ID')}</small><p>{event.source}</p></article>):<p className="muted">Belum ada bukti consent yang dicatat.</p>}</div>
    {(page>1||hasMore)&&<div className="pagination"><button className="button" disabled={page===1} onClick={()=>setPage(page-1)}>Sebelumnya</button><span>Halaman {page}</span><button className="button" disabled={!hasMore} onClick={()=>setPage(page+1)}>Berikutnya</button></div>}
    <form onSubmit={submit} className="form-stack"><label>Tindakan<select value={status} onChange={e=>setStatus(e.target.value)} required><option value="">Pilih tindakan</option><option value="active" disabled={Boolean(contact.archived_at)}>{c.newConsent}</option><option value="revoked">{c.optout}</option></select></label>
      {status&&<><p className="field-help">{status==='active'?c.reconsent:'Kontak langsung tidak layak menerima campaign. Waktu opt-out dicatat saat disimpan.'}</p><label>{c.source}<input name="source" required maxLength={300}/></label>{status==='active'&&<label>{c.date}<input type="datetime-local" name="date" required/></label>}<label className="check-label"><input name="confirmed" type="checkbox" required/>{c.confirm}</label></>}
      {error&&<p role="alert" className="error">{error}</p>}<div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>{c.close}</button><button className="button accent" disabled={busy||!status}>{busy?'Menyimpan…':c.save}</button></div>
    </form>
  </Modal>;
}
