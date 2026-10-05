import {describe,it,expect} from 'vitest';
import {zipSync,strToU8} from 'fflate';
import {readFileSync} from 'node:fs';
import {parseCsv,autoMap,mapRows,parseFile,inspectXlsx} from '../src/features/contacts/import-parser';
import {safeCsv} from '../src/features/contacts/csv';
describe('CSV and spreadsheet import',()=>{
  it('handles BOM, semicolon delimiters, quoted delimiters and embedded newlines',()=>{
    const sheet=parseCsv('\uFEFFNama;No WhatsApp;Tag\r\n"Anna; A";081234567890;"training\nleader"')[0];
    expect(sheet.rows[1]).toEqual(['Anna; A','081234567890','training\nleader']);
    expect(autoMap(sheet.rows[0]).phone).toBe(1);
  });
  it('rejects unmatched quotes and excessive columns',()=>{
    expect(()=>parseCsv('Name,Phone\n"broken,081234567890')).toThrow();expect(()=>parseCsv(Array(41).fill('column').join(','))).toThrow('kolom');
  });
  it('requires unique mapping and reports invalid, duplicate and missing-consent rows',()=>{
    const rows=[['Nama','No WhatsApp','Consent','Sumber Consent','Tanggal Consent'],['Anna','081234567890','active','Form','2026-01-01'],['Anna again','+6281234567890','unknown','',''],['Budi','081234567891','unknown','',''],['Invalid','x','unknown','',''],['No evidence','081234567892','active','','']];
    const mapping=autoMap(rows[0]);expect(mapRows(rows,mapping).map(r=>r.kind)).toEqual(['valid','duplicate','missing','invalid','invalid']);
    expect(()=>mapRows(rows,{...mapping,name:mapping.phone})).toThrow('Satu kolom');
  });
  it('neutralizes spreadsheet formulas, quotes and international numbers in exports',()=>{
    const csv=safeCsv([['Nama','No WhatsApp'],[' =HYPERLINK("evil")','+6281234567890']]);
    const parsed=parseCsv(csv)[0];expect(parsed.rows[1][0]).toBe("' =HYPERLINK(\"evil\")");expect(parsed.rows[1][1]).toBe("'+6281234567890");
    const mapped=mapRows(parsed.rows,autoMap(parsed.rows[0]));expect(mapped[0].kind).toBe('missing');expect(mapped[0].data.phone).toBe('+6281234567890');
  });
  it('parses a real multi-sheet XLSX and maps the selected sheet',async()=>{
    const file=readFileSync('examples/kontak-contoh.xlsx');const sheets=await parseFile('test.xlsx',Uint8Array.from(file).buffer);
    expect(sheets).toHaveLength(2);expect(sheets[0].name).toBe('Kontak');const result=mapRows(sheets[0].rows,autoMap(sheets[0].rows[0]));expect(result).toHaveLength(4);expect(result[0].kind).toBe('missing');
  });
  it('rejects unsupported files, formulas, malformed ZIPs and decompression bombs',async()=>{
    await expect(parseFile('bad.xls',new ArrayBuffer(4))).rejects.toThrow('.xlsx');expect(()=>inspectXlsx(new Uint8Array([1,2,3]))).toThrow();
    const formulas=zipSync({'xl/workbook.xml':strToU8('<workbook/>'),'xl/worksheets/sheet1.xml':strToU8('<worksheet><f>WEBSERVICE("evil")</f></worksheet>')});expect(()=>inspectXlsx(formulas)).toThrow('formula');
    const bomb=zipSync({'xl/workbook.xml':strToU8('x'.repeat(21*1024*1024))});expect(()=>inspectXlsx(bomb)).toThrow('besar');
  });
});
