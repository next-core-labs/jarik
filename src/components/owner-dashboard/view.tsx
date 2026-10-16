import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Building2, RefreshCw } from "lucide-react";

import { ReferralCard } from "@/components/referral-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionCenter, type Decision } from "@/components/owner-dashboard/attention-center";
import { CollectionsChart } from "@/components/owner-dashboard/collections-chart";
import { ExpensesBreakdown } from "@/components/owner-dashboard/expenses";
import { ownerWorkbookSheets } from "@/components/owner-dashboard/export";
import { CashflowForecast } from "@/components/owner-dashboard/forecast";
import { OwnerHero } from "@/components/owner-dashboard/hero";
import { MarketBenchmark } from "@/components/owner-dashboard/market-benchmark";
import { deriveDashboard, type OwnerDashboardData } from "@/components/owner-dashboard/model";
import { Locations } from "@/components/owner-dashboard/locations";
import { OfficesList } from "@/components/owner-dashboard/offices-list";
import { Panel, Section } from "@/components/owner-dashboard/parts";
import { Portfolio } from "@/components/owner-dashboard/portfolio";
import { RecentPayments } from "@/components/owner-dashboard/recent-payments";
import { Renewals, type RenewalDecisionInput } from "@/components/owner-dashboard/renewals";
import { scrollToSection } from "@/components/owner-dashboard/scroll-to-section";
import { SectionNav, type SectionLink } from "@/components/owner-dashboard/section-nav";
import { StatementPdf } from "@/components/owner-dashboard/statement-pdf";
import { Vacancies, type RentRequest } from "@/components/owner-dashboard/vacancies";

/**
 * The owner dashboard, as a pure function of its data — the route owns fetching and mutations.
 *
 * Reading order (and nav anchors): what needs you (#approvals) → money (#finance) → your
 * properties (#units) → where they are and what's around them (#map) → market and offices
 * (#reports). A sticky tab bar under the hero follows the reader through them.
 */
export function OwnerDashboardView({
  data,
  deciding,
  onDecide,
  onRenewalDecision,
  onRequestRent,
  downloading,
  onDownloadStatement,
  onExportExcel,
}: {
  data: OwnerDashboardData;
  deciding: string | null;
  onDecide: (d: Decision) => Promise<unknown>;
  onRenewalDecision: (d: RenewalDecisionInput) => Promise<unknown>;
  onRequestRent: (r: RentRequest) => Promise<unknown>;
  downloading: boolean;
  onDownloadStatement: (node: HTMLElement) => void;
  onExportExcel: (sheets: ReturnType<typeof ownerWorkbookSheets>) => void;
}) {
  const model = useMemo(() => deriveDashboard(data), [data]);
  const statementRef = useRef<HTMLDivElement>(null);
  const [mapSelection, setMapSelection] = useState<string | null>(null);

  const links = useMemo<SectionLink[]>(
    () => [
      { id: "approvals", label: "يحتاج انتباهك", count: model.attention.length },
      { id: "finance", label: "المالية" },
      { id: "units", label: "عقاراتي" },
      { id: "map", label: "الخريطة والجوار" },
      { id: "reports", label: "السوق والمكاتب" },
    ],
    [model.attention.length],
  );

  const locate = (propertyId: string) => {
    setMapSelection(propertyId);
    const map = document.getElementById("map");
    if (map) scrollToSection(map);
  };

  // The tab bar is a direct child of the outermost wrapper: a sticky element only sticks within its
  // parent, so nesting it with the hero alone let it scroll away with the hero.
  return (
    <div>
      <OwnerHero
        model={model}
        finance={data.finance}
        offices={data.offices}
        downloading={downloading}
        onDownload={() => statementRef.current && onDownloadStatement(statementRef.current)}
        onExportExcel={() => onExportExcel(ownerWorkbookSheets(data, model))}
      />
      {model.hasUnits ? <SectionNav links={links} /> : null}

      <div className="mt-10 space-y-10">
        {!model.hasUnits ? (
          <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span
              className="grid size-12 place-items-center bg-sidebar text-sidebar-foreground"
              aria-hidden
            >
              <Building2 className="size-6" />
            </span>
            <h2 className="font-display text-lg font-bold">لا توجد وحدات مسجّلة باسمك بعد</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              اطلب من مكتبك ربط وحداتك بحسابك، أو اطلب من مكتب عقاري إدارة أملاكك — وسيظهر هنا دخلك
              وإشغالك وكل ما يحتاج قرارك.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/owner/agreements">المكاتب والاتفاقيات</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/messages">راسل المكتب</Link>
              </Button>
            </div>
          </Panel>
        ) : (
          <>
            <AttentionCenter
              model={model}
              deciding={deciding}
              onDecide={onDecide}
              autoApproveLimit={data.autoApproveLimit}
            />

            <Section
              id="finance"
              title="المالية"
              description="ما حُصّل وما سيُحصَّل، أين ذهبت المصروفات، وما يحين تجديده"
            >
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <div className="min-w-0 lg:col-span-3">
                  <CollectionsChart points={model.chart} total={model.chartTotal} />
                </div>
                <div className="min-w-0 lg:col-span-2">
                  <RecentPayments payments={data.finance.recent} today={data.finance.today} />
                </div>
                {data.forecast ? (
                  <div
                    className={data.expenses ? "min-w-0 lg:col-span-3" : "min-w-0 lg:col-span-5"}
                  >
                    <CashflowForecast
                      points={model.forecast}
                      outstanding={model.forecastOutstanding}
                    />
                  </div>
                ) : null}
                {data.expenses ? (
                  <div
                    className={data.forecast ? "min-w-0 lg:col-span-2" : "min-w-0 lg:col-span-5"}
                  >
                    <ExpensesBreakdown
                      categories={model.expenseCategories}
                      total={model.expensesTotal}
                      rows={data.expenses}
                    />
                  </div>
                ) : null}
                <div className="min-w-0 lg:col-span-5">
                  <Renewals
                    renewals={model.renewals}
                    total={model.renewalsRent}
                    decisions={model.renewalDecisions}
                    onDecide={onRenewalDecision}
                  />
                </div>
              </div>
            </Section>

            <Section
              id="units"
              title="عقاراتي ووحداتي"
              description="الشاغر أولًا، ثم الإشغال والعائد لكل عقار وحالة كل وحدة"
            >
              <div className="space-y-6">
                {data.vacancies ? (
                  <Vacancies vacancies={model.vacancies} onRequestRent={onRequestRent} />
                ) : null}
                <Portfolio
                  properties={model.properties}
                  statusCounts={model.statusCounts}
                  onLocate={locate}
                />
              </div>
            </Section>

            <Locations
              properties={model.properties}
              selectedId={mapSelection}
              onSelect={setMapSelection}
            />

            <Section
              id="reports"
              title="السوق والمكاتب"
              description="إيجارك مقارنة بأحيائك، ومن يدير أملاكك"
            >
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MarketBenchmark benchmarks={model.benchmarks} />
                {data.offices.length > 0 ? <OfficesList offices={data.offices} /> : null}
              </div>
            </Section>
          </>
        )}

        <ReferralCard />

        {model.hasUnits ? <StatementPdf ref={statementRef} data={data} model={model} /> : null}
      </div>
    </div>
  );
}

/** Mirrors the real layout so nothing jumps when data arrives. */
export function OwnerDashboardSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="جارٍ تحميل لوحة المالك">
      <div>
        <div className="h-80 animate-pulse bg-sidebar/90" />
        <div className="h-12 border-b border-border" />
      </div>
      <Skeleton className="h-72" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Skeleton className="h-80 lg:col-span-3" />
        <Skeleton className="h-80 lg:col-span-2" />
      </div>
    </div>
  );
}

export function OwnerDashboardError({
  retrying,
  onRetry,
}: {
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <h1 className="font-display text-lg font-bold">تعذّر تحميل بيانات لوحتك</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        لم نعرض أرقامًا ناقصة حتى لا تكون مضلِّلة. تحقّق من الاتصال ثم أعد المحاولة.
      </p>
      <Button variant="outline" disabled={retrying} onClick={onRetry}>
        <RefreshCw className={retrying ? "animate-spin" : undefined} aria-hidden />
        إعادة المحاولة
      </Button>
    </Panel>
  );
}
