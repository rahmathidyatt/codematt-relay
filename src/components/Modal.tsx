import {useEffect,useId,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
export function Modal({title,children,onClose,busy=false,wide=false}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);const id=useId();
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  return <dialog ref={ref} aria-labelledby={id} className={wide?'modal wide':'modal'} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <div className="modal-head"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="Tutup dialog" disabled={busy} onClick={onClose}><X size={20}/></button></div>{children}
  </dialog>;
}
