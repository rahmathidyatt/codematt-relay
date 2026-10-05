import {InputError,object,text,tags,uuid} from '../contacts/validation.ts';
export type Component={type:string;format?:string;text?:string;buttons?:{type:string;text?:string;url?:string;phone_number?:string}[]};
export type Template={id:string;provider_id:string;name:string;language:string;category:string;status:string;components:Component[];parameter_format:string;source_waba:string|null;synced_at:string;usable:boolean;reason:string;variables:string[]};
export type Audience={mode:'all'|'segment'|'manual';tags:string[];match:'any'|'all';ids:string[];q:string};
export type Mapping=Record<string,{source:'name'|'phone_e164'|'literal';value?:string}>;
export type DraftInput={id:string;version?:number;name:string;template_id:string|null;audience_rules:Audience;variable_mapping:Mapping};
export type Campaign=DraftInput&{version:number;status:string;updated_at:string;template_snapshot:Template|null;audience_snapshot:{ids:string[];counts:Counts;captured_at:string}|null};
export type Counts={selected:number;eligible:number;archived:number;no_consent:number;opted_out:number;invalid:number;missing:number};
export type Preview={counts:Counts;issues:string[];samples:{id:string;name:string;phone_e164:string;parts:{type:string;text:string}[]}[];page:number;pages:number};
export const emptyAudience=():Audience=>({mode:'all',tags:[],match:'any',ids:[],q:''});
export function validateAudience(raw:unknown):Audience {
 const a=object(raw);if(!['all','segment','manual'].includes(String(a.mode)))throw new InputError('Pilihan audience tidak valid.');
 const list=a.ids??[];if(!Array.isArray(list)||list.length>1000)throw new InputError('Maksimal 1.000 kontak dipilih manual.');
 const match=a.match??'any';if(!['any','all'].includes(String(match)))throw new InputError('Aturan tag tidak valid.');
 const q=a.q===undefined||a.q===''?'':text(a.q,'Pencarian audience',100);
 return {mode:a.mode as Audience['mode'],tags:tags(a.tags),match:match as Audience['match'],ids:[...new Set(list.map(uuid))],q};
}
export function validateMapping(raw:unknown):Mapping {
 const obj=object(raw??{});if(Object.keys(obj).length>100)throw new InputError('Terlalu banyak variabel.');
 const result:Mapping={};for(const [key,v] of Object.entries(obj)) {
  if(!/^(HEADER|BODY):([1-9][0-9]*|[a-z][a-z0-9_]*)$/.test(key)||key.length>100)throw new InputError('Nama variabel tidak valid.');
  const m=object(v);if(!['name','phone_e164','literal'].includes(String(m.source)))throw new InputError('Sumber variabel tidak valid.');
  result[key]={source:m.source as Mapping[string]['source'],...(m.source==='literal'?{value:m.value===''?'':text(m.value,'Isi variabel',1024)}:{})};
 }return result;
}
export function templateShape(t:Pick<Template,'components'|'parameter_format'|'category'>):{variables:string[];reason:string} {
 const variables:string[]=[];let bodies=0;const seen=new Set<string>();
 if(t.category==='AUTHENTICATION')return {variables,reason:'Template autentikasi belum didukung.'};
 if(!['POSITIONAL','NAMED'].includes(t.parameter_format))return {variables,reason:'Format variabel belum didukung.'};
 for(const c of t.components) {
  if(seen.has(c.type))return {variables,reason:'Komponen template berulang.'};seen.add(c.type);
  if(c.type==='BODY')bodies++;
  if(['BODY','HEADER','FOOTER'].includes(c.type)) {
   if(c.type==='HEADER'&&c.format!=='TEXT')return {variables,reason:'Header media/lokasi belum didukung pada Phase 3.'};
   if(typeof c.text!=='string'||!c.text)return {variables,reason:'Konten teks tidak lengkap.'};
   const matches=[...c.text.matchAll(/{{\s*([^{}]+?)\s*}}/g)];
   if(c.text.replace(/{{\s*([^{}]+?)\s*}}/g,'').includes('{{')||c.text.replace(/{{\s*([^{}]+?)\s*}}/g,'').includes('}}'))return {variables,reason:'Placeholder template tidak valid.'};
   const tokens=[...new Set(matches.map(m=>m[1]))];
   if(c.type==='FOOTER'&&tokens.length)return {variables,reason:'Variabel footer belum didukung.'};
   if(tokens.some(v=>!(t.parameter_format==='POSITIONAL'?/^[1-9][0-9]*$/:/^[a-z][a-z0-9_]*$/).test(v)))return {variables,reason:'Placeholder tidak sesuai format variabel.'};
   if(t.parameter_format==='POSITIONAL'&&tokens.map(Number).sort((a,b)=>a-b).some((n,i)=>n!==i+1))return {variables,reason:'Urutan placeholder tidak valid.'};
   variables.push(...tokens.map(v=>`${c.type}:${v}`));
  } else if(c.type==='BUTTONS') {
   if(!c.buttons?.length||c.buttons.some(b=>!['QUICK_REPLY','URL','PHONE_NUMBER'].includes(b.type)||!b.text||/({{|}})/.test(JSON.stringify(b))))return {variables,reason:'Tombol dinamis atau jenis tombol ini belum didukung.'};
  } else return {variables,reason:'Jenis komponen ini belum didukung pada Phase 3.'};
 }
 return {variables,reason:bodies!==1?'Template harus memiliki satu body.':variables.length>100?'Terlalu banyak variabel.':''};
}
export function mappingIssues(template:Template,mapping:Mapping):string[] {
 const issues=template.usable?[]:[template.reason||'Template tidak dapat digunakan.'];
 for(const key of template.variables)if(!mapping[key]||(mapping[key].source==='literal'&&!mapping[key].value?.trim()))issues.push(`Isi pemetaan ${key}.`);
 for(const key of Object.keys(mapping))if(!template.variables.includes(key))issues.push(`Pemetaan ${key} sudah tidak ada pada template.`);
 return issues;
}
export function renderMessage(template:Template,mapping:Mapping,contact:{name:string;phone_e164:string}) {
 return template.components.flatMap(c=>c.type==='BUTTONS'?(c.buttons??[]).map(b=>({type:'BUTTON',text:b.text??''})):[{type:c.type,text:(c.text??'').replace(/{{\s*([^{}]+?)\s*}}/g,(_,token:string)=>{const m=mapping[`${c.type}:${token}`];return m?(m.source==='literal'?m.value??'':contact[m.source]):`{{${token}}}`;})}]);
}
