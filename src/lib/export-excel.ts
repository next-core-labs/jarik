import * as XLSX from "xlsx";

/** يصدّر صفوف البيانات إلى ملف Excel حقيقي (.xlsx) بأعمدة عربية جاهزة للمحاسب. */
export function exportToExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, string | number>[],
) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 28) || "تقرير");
  XLSX.writeFile(wb, filename);
}

/** ملف Excel بعدة أوراق (مثال: الدفعات والمصروفات والمستأجرون في ملف واحد). */
export function exportWorkbook(
  filename: string,
  sheets: { name: string; rows: Record<string, string | number>[] }[],
) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(
      sheet.rows.length ? sheet.rows : [{ "لا توجد بيانات": "" }],
    );
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 28) || "ورقة");
  }
  XLSX.writeFile(wb, filename);
}
