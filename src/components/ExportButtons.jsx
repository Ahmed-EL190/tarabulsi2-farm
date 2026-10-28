import { FileSpreadsheet, FileDown } from 'lucide-react';
import { exportExcel, exportPdf } from '../lib/export';
export default function ExportButtons({ report }) {
  return (
    <div className="no-print flex gap-2">
      <button className="btn btn-ghost" onClick={() => exportExcel(report)}><FileSpreadsheet size={16} />Excel</button>
      <button className="btn btn-ghost" onClick={() => exportPdf(report)}><FileDown size={16} />PDF</button>
    </div>
  );
}
