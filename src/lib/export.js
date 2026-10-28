import ExcelJS from 'exceljs';

/** report: { title, farm, from, to, currency, columns:[{key,label,type:'text'|'date'|'number'|'money',width}], rows:[], totals:{key:number}, summary:[{label,value}] }
 *  Totals in files are computed from the same rows shown in the app, so exports always match the screen. */
export async function exportExcel(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.farm; wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 6 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const cols = report.columns, last = cols.length;
  ws.mergeCells(1, 1, 1, last); ws.getCell(1, 1).value = report.farm; ws.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF0F3A28' } };
  ws.mergeCells(2, 1, 2, last); ws.getCell(2, 1).value = report.title; ws.getCell(2, 1).font = { bold: true, size: 13 };
  ws.mergeCells(3, 1, 3, last); ws.getCell(3, 1).value = `الفترة: ${report.from || '—'} إلى ${report.to || '—'}   |   العملة: ${report.currency || 'كل العملات منفصلة'}`;
  ws.mergeCells(4, 1, 4, last); ws.getCell(4, 1).value = `تاريخ الإنشاء: ${new Date().toLocaleString('en-GB')}`;
  const head = ws.getRow(6);
  cols.forEach((c, i) => { const cell = head.getCell(i + 1); cell.value = c.label; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3A28' } }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; ws.getColumn(i + 1).width = c.width || 16; });
  report.rows.forEach((r, ri) => {
    const row = ws.getRow(7 + ri);
    cols.forEach((c, i) => { const cell = row.getCell(i + 1); cell.value = r[c.key] ?? null; if (c.type === 'money' || c.type === 'number') cell.numFmt = '#,##0.00'; if (c.type === 'date') cell.numFmt = 'yyyy-mm-dd'; cell.border = { bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } } }; });
  });
  const first = 7, lastRow = 6 + report.rows.length;
  if (report.rows.length) ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: lastRow, column: last } };
  if (report.totals) {
    const tr = ws.getRow(lastRow + 1); tr.getCell(1).value = 'الإجمالي';
    cols.forEach((c, i) => { if (report.totals[c.key] !== undefined) { const L = ws.getColumn(i + 1).letter; tr.getCell(i + 1).value = { formula: `SUM(${L}${first}:${L}${lastRow})`, result: report.totals[c.key] }; tr.getCell(i + 1).numFmt = '#,##0.00'; } });
    tr.font = { bold: true }; tr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F7F0' } }; c.border = { top: { style: 'medium' } }; });
  }
  (report.summary || []).forEach((s, i) => { const r = ws.getRow(lastRow + 3 + i); r.getCell(1).value = s.label; r.getCell(2).value = s.value; r.getCell(1).font = { bold: true }; if (typeof s.value === 'number') r.getCell(2).numFmt = '#,##0.00'; });
  ws.headerFooter.oddFooter = '&C&P / &N';
  ws.pageSetup.printTitlesRow = '6:6';
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `${report.title}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cell = (c, v) => (c.type === 'money' || c.type === 'number') && typeof v === 'number' ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) : esc(v);
/** PDF = print-ready RTL document opened in a new window (browser "Save as PDF"). This keeps Arabic shaping correct and
 *  gives page numbers through CSS paged media; embedding Arabic fonts in a JS PDF library is unreliable. */
export function exportPdf(report) {
  const w = window.open('', '_blank'); if (!w) { alert('اسمح بالنوافذ المنبثقة لتصدير PDF'); return; }
  const th = report.columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = report.rows.map((r) => `<tr>${report.columns.map((c) => `<td class="${c.type === 'money' || c.type === 'number' ? 'n' : ''}">${cell(c, r[c.key])}</td>`).join('')}</tr>`).join('');
  const tot = report.totals ? `<tr class="t"><td>الإجمالي</td>${report.columns.slice(1).map((c) => `<td class="n">${report.totals[c.key] !== undefined ? cell(c, report.totals[c.key]) : ''}</td>`).join('')}</tr>` : '';
  const sum = (report.summary || []).map((s) => `<tr><td><b>${esc(s.label)}</b></td><td class="n">${cell({ type: 'money' }, s.value)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(report.title)}</title><style>
  @page{size:A4 landscape;margin:14mm 10mm 16mm;@bottom-center{content:"صفحة " counter(page) " من " counter(pages)}}
  body{font-family:Tajawal,Arial,sans-serif;color:#111}h1{margin:0;color:#0f3a28}h2{margin:2px 0 6px}
  .m{color:#555;font-size:12px;margin-bottom:10px}table{border-collapse:collapse;width:100%;font-size:12px}
  th{background:#0f3a28;color:#fff;padding:6px}td{padding:5px 6px;border-bottom:1px solid #ddd}.n{text-align:left;direction:ltr}
  .t td{font-weight:800;background:#e8f7f0;border-top:2px solid #0f3a28}thead{display:table-header-group}tr{page-break-inside:avoid}</style></head><body>
  <h1>${esc(report.farm)}</h1><h2>${esc(report.title)}</h2>
  <div class="m">الفترة: ${esc(report.from || '—')} إلى ${esc(report.to || '—')} | العملة: ${esc(report.currency || 'منفصلة لكل عملة')} | تاريخ الإنشاء: ${new Date().toLocaleString('en-GB')}</div>
  <table><thead><tr>${th}</tr></thead><tbody>${body}${tot}</tbody></table>${sum ? `<table style="margin-top:14px;width:50%">${sum}</table>` : ''}
  <script>document.fonts.ready.then(()=>setTimeout(()=>print(),300))</script></body></html>`);
  w.document.close();
}
