import {parseFile} from './import-parser.ts';
self.onmessage=async(event:MessageEvent<{name:string;buffer:ArrayBuffer}>)=>{
  try{self.postMessage({ok:true,sheets:await parseFile(event.data.name,event.data.buffer)});}
  catch(e){self.postMessage({ok:false,message:e instanceof Error?e.message:'File tidak dapat dibaca.'});}
};
