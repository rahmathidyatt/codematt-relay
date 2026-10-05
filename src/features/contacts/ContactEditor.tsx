import {useState,type FormEvent} from 'react';
import {Modal} from '../../components/Modal';
import {labels as c,consentLabel} from './labels';
import {type Contact} from './types';
import type {ContactsClient} from './client';
export function ContactEditor({contact,client,onClose,onSaved}:{contact?:Contact;client:ContactsClient;onClose:()=>void;onSaved:()=>void}) {
  const [status,setStatus]=useState('unknown'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const form=new FormData(e.currentTarget);
    const name=String(form.get('name')),tags=String(form.get('tags')).split(/[,;]/).map(x=>x.trim()).filter(Boolean);
    try{if(contact)await client.update(contact.id,{name,tags,version:contact.version});else await client.create({name,tags,phone:String(form.get('phone')),country:String(form.get('country')),consent_status:status,consent_source:String(form.get('source')??''),consent_at:form.get('date')?new Date(String(form.get('date'))).toISOString():undefined});onSaved();}
    catch(e){setError(e instanceof Error?e.message:'Kontak tidak dapat disimpan.');}finally{setBusy(false);}}
  return <Modal title={contact?c.edit:c.add} onClose={onClose} busy={busy}><form onSubmit={submit} className="form-stack">
    <label>{c.name}<input name="name" defaultValue={contact?.name} maxLength={200} required autoFocus/></label>
    <label>{c.phone}<input name="phone" type="tel" defaultValue={contact?.phone_e164} placeholder="081234567890" readOnly={Boolean(contact)} required maxLength={40}/></label>
    <p className="field-help">{contact?c.immutable:c.phoneNote}</p>
    {!contact&&<label>Negara untuk nomor lokal<select name="country" defaultValue="ID"><option value="ID">Indonesia (+62)</option><option value="MY">Malaysia (+60)</option><option value="SG">Singapura (+65)</option><option value="US">Amerika Serikat (+1)</option></select></label>}
    <label>{c.tag}<input name="tags" defaultValue={contact?.tags.join(', ')} placeholder="training, leader" maxLength={1000}/><span className="field-help">Pisahkan dengan koma. Maksimal 20 tag.</span></label>
    {!contact&&<><label>{c.consent}<select value={status} onChange={e=>setStatus(e.target.value)}>{Object.entries(consentLabel).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      {status!=='unknown'&&<><label>{c.source}<input name="source" maxLength={300} required placeholder="Contoh: formulir pendaftaran acara"/></label><label>{status==='revoked'?'Waktu permintaan opt-out':c.date}<input type="datetime-local" name="date" required/></label><label className="check-label"><input type="checkbox" required/>{c.confirm}</label></>}
      <p className="field-help">{c.consentNote}</p></>}
    {error&&<p className="error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>{c.cancel}</button><button className="button accent" disabled={busy}>{busy?'Menyimpan…':c.save}</button></div>
  </form></Modal>;
}
