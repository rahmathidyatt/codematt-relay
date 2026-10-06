import {useEffect,useState} from 'react';
import {api} from '../../lib/api';
import {Modal} from '../../components/Modal';
import {AudienceCounts} from '../campaigns/CampaignEditor';
import {zones,type Review} from './model';
export function LaunchDialog({id,demo,onClose,onLaunched}:{id:string;demo:boolean;onClose:()=>void;onLaunched:(id:string)=>void}) {
 const [review,setReview]=useState<Review>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [confirmed,setConfirmed]=useState(false);const [name,setName]=useState('');const [mode,setMode]=useState('now');const [date,setDate]=useState('');const [zone,setZone]=useState<keyof typeof zones>('Asia/Jakarta');const [contact,setContact]=useState('');const [testId]=useState(()=>crypto.randomUUID());
 async function load(){setBusy(true);setError('');setConfirmed(false);try{const r=await api<Review>(`campaigns/${id}/review`,{},demo);setReview(r);setContact(r.samples[0]?.id??'');}catch(e){setReview(undefined);setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void load();},[id,demo]);
 async function launch(){if(!review)return;setBusy(true);setError('');try{
  const scheduled=mode==='scheduled'?new Date(date+':00'+zones[zone]).toISOString():null;
  const r=await api<{id:string}>(`campaigns/${id}/${mode==='test'?'test':'launch'}`,{method:'POST',body:JSON.stringify({version:review.version,review_hash:review.hash,confirmed,confirm_name:name,scheduled_at:scheduled,timezone:zone,contact_id:contact,test_id:testId})},demo);onLaunched(r.id);
 }catch(e){setError((e as Error).message);setConfirmed(false);}finally{setBusy(false);}}
 return <Modal title={demo?'Luncurkan simulasi':'Konfirmasi pengiriman'} onClose={onClose} busy={busy} wide>
 {error&&<div role="alert" className="error">{error}</div>}{!review&&<button className="button" disabled={busy} onClick={load}>Periksa draft</button>}
 {review&&<><p className="local-note">{demo?'SIMULASI LOKAL · Tidak ada pesan atau permintaan ke WhatsApp. Antrean dijalankan manual dari monitor.':'Pesan akan dikirim melalui WhatsApp Cloud API setelah antrean diproses. Biaya dan batas akun Meta berlaku.'}</p><dl><dt>Campaign</dt><dd>{review.name}</dd><dt>Template</dt><dd>{review.template} · {review.language}</dd><dt>Versi draft</dt><dd>{review.version}</dd></dl><AudienceCounts counts={review.counts}/>
 <fieldset disabled={busy} className="builder-fields form-stack"><label>Tindakan<select value={mode} onChange={e=>{setMode(e.target.value);setConfirmed(false);}}><option value="now">Kirim sekarang melalui antrean</option><option value="scheduled">Jadwalkan campaign</option><option value="test">Kirim test ke satu kontak</option></select></label>
 {mode==='scheduled'&&<div className="form-grid"><label>Tanggal dan jam<input type="datetime-local" value={date} onChange={e=>{setDate(e.target.value);setConfirmed(false);}}/></label><label>Zona waktu<select value={zone} onChange={e=>{setZone(e.target.value as keyof typeof zones);setConfirmed(false);}}>{Object.keys(zones).map(z=><option key={z}>{z}</option>)}</select></label><p className="field-help">Minimal 1 menit dari sekarang. Jadwal mengikuti zona yang dipilih, bukan zona perangkat. Scheduler memeriksa setiap menit; waktu kirim tepat tidak dijamin.</p></div>}
 {mode==='test'&&<><label>Penerima test<select value={contact} onChange={e=>{setContact(e.target.value);setConfirmed(false);}}>{review.samples.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><p className="field-help">Maksimal 100 kontak layak pertama ditampilkan. Test membuat campaign terpisah melalui pipeline yang sama; draft utama tetap tersimpan. Pilih segmen/manual untuk mempersempit daftar.</p></>}
 {mode!=='test'&&review.counts.eligible>=100&&<label>Ketik nama campaign: {review.name}<input value={name} onChange={e=>setName(e.target.value)}/></label>}
 <label className="check-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Saya memastikan penerima telah memberi persetujuan yang sesuai untuk isi pesan ini, dan telah meninjau preview serta audience.</span></label>
 {!review.enabled&&<p className="error">Pengiriman produksi belum diaktifkan. Admin perlu menyelesaikan konfigurasi server sesuai panduan Phase 4.</p>}</fieldset>
 <p className="field-help">Pause/cancel menghentikan pekerjaan yang belum dikirim. Permintaan yang sudah diteruskan ke Meta tidak dapat ditarik kembali.</p>
 <div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Kembali</button><button type="button" className="button" disabled={busy} onClick={load}>Periksa ulang</button><button type="button" className="button accent" disabled={busy||!review.enabled||!confirmed||(mode==='scheduled'&&!date)||(mode==='test'&&!contact)||(mode!=='test'&&review.counts.eligible>=100&&name!==review.name)} onClick={launch}>{busy?'Memproses…':demo?'Mulai simulasi':mode==='scheduled'?'Jadwalkan Campaign':mode==='test'?'Kirim Test':'Kirim Campaign'}</button></div></>}
 </Modal>;
}
