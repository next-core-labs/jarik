import { forwardRef } from "react";

import { sar, shortDate, unitStatusLabel } from "@/lib/format";
import { useBrandingLogo } from "@/lib/use-org-branding";
import type { DashboardModel, OwnerDashboardData } from "@/components/owner-dashboard/model";

/**
 * The owner's 12-month account statement, rendered off-screen and captured to PDF by
 * downloadElementAsPdf. Plain black-on-white for print, independent of the app theme.
 */
export const StatementPdf = forwardRef<
  HTMLDivElement,
  { data: OwnerDashboardData; model: DashboardModel }
>(function StatementPdf({ data, model }, ref) {
  const { finance, offices, returns, units } = data;
  const office = offices.length === 1 ? offices[0]! : null;
  const logo = useBrandingLogo(office?.logo_url ?? null);
  return (
    <div
      ref={ref}
      dir="rtl"
      aria-hidden="true"
      className="pointer-events-none fixed -left-[10000px] top-0 w-[700px] bg-white p-8 text-black"
    >
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          {office && logo ? <img src={logo} alt="" className="size-12 object-contain" /> : null}
          <div>
            <p className="text-lg font-bold">{office?.company_name ?? "منصة جارك"}</p>
            {office?.fal_license_no ? (
              <p className="text-xs text-gray-500">ترخيص فال: {office.fal_license_no}</p>
            ) : null}
            {offices.length > 1 ? (
              <p className="text-xs text-gray-500">
                المكاتب المديرة: {offices.map((o) => o.company_name).join("، ")}
              </p>
            ) : null}
          </div>
        </div>
        <p className="text-sm text-gray-500">تاريخ الإصدار: {shortDate(finance.today)}</p>
      </div>

      <h2 className="mt-6 text-xl font-bold">كشف حساب المالك</h2>
      <p className="mt-1 text-sm text-gray-500">
        الفترة: آخر 12 شهرًا حتى {shortDate(finance.today)}
      </p>

      <table className="mt-4 w-full border-collapse text-sm">
        <tbody>
          <Row label="المحصّل" value={sar(finance.collected_12m)} />
          <Row label="المصروفات" value={sar(finance.expenses_12m)} />
          <Row label="الصافي" value={sar(model.net12m)} bold />
          <Row
            label="المتأخرات حتى تاريخه"
            value={`${sar(finance.overdue_total)} (${finance.overdue_count} دفعة)`}
          />
          <Row label="الإيجار السنوي حسب العقود السارية" value={sar(model.contractedRent)} />
          <Row label="نسبة الإشغال" value={`${model.occupancyPct}%`} />
        </tbody>
      </table>

      <h3 className="mt-6 font-bold">حسب العقار</h3>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-right text-gray-600">
            <th className="py-2">العقار</th>
            <th className="py-2">الوحدات</th>
            <th className="py-2">المحصّل</th>
            <th className="py-2">المصروفات</th>
            <th className="py-2">الصافي</th>
          </tr>
        </thead>
        <tbody>
          {returns.map((r) => (
            <tr key={r.property_id} className="border-b">
              <td className="py-2">{r.property_name}</td>
              <td className="py-2">{r.units_count}</td>
              <td className="py-2">{sar(r.collected_12m)}</td>
              <td className="py-2">{sar(r.expenses_12m)}</td>
              <td className="py-2">{sar(r.net_12m)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mt-6 font-bold">الوحدات</h3>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-right text-gray-600">
            <th className="py-2">الوحدة</th>
            <th className="py-2">العقار</th>
            <th className="py-2">النوع</th>
            <th className="py-2">الحالة</th>
            <th className="py-2">الإيجار السنوي</th>
            <th className="py-2">نهاية العقد</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.unit_id} className="border-b">
              <td className="py-2">{u.unit_number}</td>
              <td className="py-2">{u.property_name}</td>
              <td className="py-2">{u.unit_type}</td>
              <td className="py-2">{unitStatusLabel[u.status] ?? u.status}</td>
              <td className="py-2">{sar(u.lease_annual_rent ?? u.annual_rent)}</td>
              <td className="py-2">{u.lease_end_date ? shortDate(u.lease_end_date) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 text-xs text-gray-400">صادر تلقائيًا من منصة جارك</p>
    </div>
  );
});

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr className={bold ? "border-b font-bold" : "border-b"}>
      <td className="py-2">{label}</td>
      <td className="py-2 text-left">{value}</td>
    </tr>
  );
}
