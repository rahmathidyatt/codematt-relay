import Papa from 'papaparse';
export function safeCsv(rows:unknown[][]):string {
  return '\uFEFF'+Papa.unparse(rows.map(row=>row.map(value=>{
    const cell=String(value??'');
    return /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(cell)||/^[\t\r\n]/.test(cell)?"'"+cell:cell;
  })),{quotes:true,newline:'\r\n'});
}
export function downloadCsv(filename:string,rows:unknown[][]) {
  const url=URL.createObjectURL(new Blob([safeCsv(rows)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
