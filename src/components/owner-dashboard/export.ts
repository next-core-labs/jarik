import { effectiveStatus } from "@/lib/dates";
import { paymentStatusLabel, unitStatusLabel } from "@/lib/format";
import {
  UNCATEGORISED,
  type DashboardModel,
  type OwnerDashboardData,
} from "@/components/owner-dashboard/model";

type Row = Record<string, string | number>;

/**
 * The owner's statement as an Excel workbook — the same figures as the dashboard and the PDF, one
 * sheet per table, with Arabic column names ready for an accountant. Amounts stay numbers so they
 * can be summed; dates stay ISO (YYYY-MM-DD) so Excel sorts them.
 */
export function ownerWorkbookSheets(
  data: OwnerDashboardData,
  model: DashboardModel,
): { name: string; rows: Row[] }[] {
  const { finance } = data;
  const summary: Row[] = [
    { البند: "تاريخ الإصدار", القيمة: finance.today },
    { البند: "المحصّل — آخر ١٢ شهرًا", القيمة: finance.collected_12m },
    { البند: "المصروفات — آخر ١٢ شهرًا", القيمة: finance.expenses_12m },
    { البند: "الصافي — آخر ١٢ شهرًا", القيمة: model.net12m },
    { البند: "المتأخرات حتى تاريخه", القيمة: finance.overdue_total },
    { البند: "عدد الدفعات المتأخرة", القيمة: finance.overdue_count },
    { البند: "مستحق خلال ٣٠ يومًا", القيمة: finance.upcoming_30_total },
    { البند: "الإيجار السنوي حسب العقود السارية", القيمة: model.contractedRent },
    { البند: "نسبة الإشغال ٪", القيمة: model.occupancyPct },
  ];

  const units: Row[] = data.units.map((u) => ({
    العقار: u.property_name,
    الوحدة: u.unit_number,
    النوع: u.unit_type,
    الحي: u.district ?? "",
    الحالة: unitStatusLabel[u.status] ?? u.status,
    "الإيجار السنوي": Number(u.lease_id ? (u.lease_annual_rent ?? 0) : u.annual_rent),
    "نوع الإيجار": u.lease_id ? "حسب العقد" : "مطلوب",
    "نهاية العقد": u.lease_end_date ?? "",
  }));

  const returns: Row[] = data.returns.map((r) => ({
    العقار: r.property_name,
    الوحدات: Number(r.units_count),
    "الإيجار السنوي": Number(r.annual_rent),
    "المحصّل ١٢ شهرًا": Number(r.collected_12m),
    "المصروفات ١٢ شهرًا": Number(r.expenses_12m),
    "الصافي ١٢ شهرًا": Number(r.net_12m),
    "الصافي من الإيجار ٪": Number(r.net_pct),
  }));

  const payments: Row[] = finance.recent.map((p) => {
    const status = effectiveStatus(p, finance.today || undefined);
    return {
      العقار: p.property_name,
      الوحدة: p.unit_number,
      المبلغ: Number(p.amount),
      الاستحقاق: p.due_date,
      السداد: p.paid_date ?? "",
      الحالة: paymentStatusLabel[status] ?? status,
    };
  });

  const expenses: Row[] = (data.expenses ?? []).map((e) => ({
    التاريخ: e.expense_date,
    البند: e.title,
    التصنيف: e.category ?? UNCATEGORISED,
    العقار: e.property_name ?? "",
    الوحدة: e.unit_number ?? "",
    المبلغ: e.amount,
  }));

  const forecast: Row[] = model.forecast.map((p) => ({
    الشهر: p.key,
    المستحق: p.due,
    المحصّل: p.paid,
    المتبقي: Math.max(0, p.due - p.paid),
  }));

  return [
    { name: "الملخص", rows: summary },
    { name: "الوحدات", rows: units },
    { name: "العائد حسب العقار", rows: returns },
    { name: "آخر المدفوعات", rows: payments },
    { name: "المصروفات ١٢ شهرًا", rows: expenses },
    { name: "التدفق المتوقع", rows: forecast },
  ];
}
