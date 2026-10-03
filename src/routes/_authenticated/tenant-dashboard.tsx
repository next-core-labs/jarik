import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bell } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { OfficeIdentity } from "@/components/office-identity";
import { QuickMaintenance } from "@/components/quick-maintenance";
import { ReferralCard } from "@/components/referral-card";
import { RenewalDecision } from "@/components/renewal-decision";
import { NextPaymentCard } from "@/components/tenant-dashboard/next-payment-card";
import { ContractCard } from "@/components/tenant-dashboard/contract-card";
import { PaymentsTable } from "@/components/tenant-dashboard/payments-table";
import { MaintenanceTracker } from "@/components/tenant-dashboard/maintenance-tracker";
import { UpdatesRow } from "@/components/tenant-dashboard/updates-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sar, shortDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/tenant-dashboard")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "لوحة المستأجر — جارك" },
      {
        name: "description",
        content: "عقدك ومستحقاتك وفواتيرك وطلبات صيانتك، مع تذكير باستحقاق الدفعة القادمة.",
      },
    ],
  }),
  component: TenantDashboard,
});

function TenantDashboard() {
  const [selectedLeaseId, setSelectedLeaseId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-dashboard"],
    queryFn: async () => {
      const [tenant, leases, invoices, notif] = await Promise.all([
        supabase.from("tenants").select("id, full_name, phone").maybeSingle(),
        supabase
          .from("leases")
          .select(
            "id, start_date, end_date, annual_rent, installments, status, units(id, unit_number, rooms, bathrooms, area, floor_no, furnished, property_id, properties(name, city))",
          )
          .order("end_date", { ascending: false }),
        supabase
          .from("invoices")
          .select("id, invoice_number, issue_date, total, zatca_status")
          .order("issue_date", { ascending: false }),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .is("read_at", null),
      ]);
      return {
        tenant: tenant.data,
        leases: leases.data ?? [],
        invoices: invoices.data ?? [],
        unreadNotif: notif.count ?? 0,
      };
    },
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="لوحة المستأجر" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const currentLease =
    data.leases.find((l) => l.id === selectedLeaseId) ??
    data.leases.find((l) => l.status === "active") ??
    data.leases[0] ??
    null;
  const unitId = currentLease?.units?.id ?? null;
  const propertyId = currentLease?.units?.property_id ?? null;
  const firstName = (data.tenant?.full_name ?? "").split(" ")[0] || "";

  return (
    <>
      <PageHeader
        title={firstName ? `أهلاً ${firstName}` : "أهلاً بك"}
        subtitle="لوحة المستأجر — عقدك ومستحقاتك وطلبات صيانتك، والنظام يلاحق المواعيد نيابةً عنك."
        action={
          <div className="flex items-center gap-2">
            {data.leases.length > 1 ? (
              <Select value={currentLease?.id ?? ""} onValueChange={setSelectedLeaseId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="اختر العقد" />
                </SelectTrigger>
                <SelectContent>
                  {data.leases.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.units?.properties?.name} · وحدة {l.units?.unit_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <div className="relative">
              <Button variant="outline" size="icon" asChild aria-label="الإشعارات">
                <Link to="/notifications">
                  <Bell className="size-4" />
                </Link>
              </Button>
              {data.unreadNotif > 0 ? (
                <span className="absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                  {data.unreadNotif > 9 ? "9+" : data.unreadNotif}
                </span>
              ) : null}
            </div>
          </div>
        }
      />

      <OfficeIdentity />

      {!currentLease ? (
        <Card className="shadow-deed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            لا توجد عقود مرتبطة بحسابك بعد.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <NextPaymentCard leaseId={currentLease.id} unitId={unitId!} />

          <div id="contract">
            <ContractCard leaseId={currentLease.id} />
          </div>

          <div id="payments">
            <PaymentsTable leaseId={currentLease.id} />
          </div>

          <div id="maintenance" className="space-y-6">
            <QuickMaintenance />
            <MaintenanceTracker unitId={unitId!} />
          </div>

          <UpdatesRow unitId={unitId!} propertyId={propertyId!} />

          {data.invoices.length > 0 ? (
            <Card className="shadow-deed">
              <CardHeader>
                <CardTitle className="text-base">فواتيري</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm"
                  >
                    <span dir="ltr">{inv.invoice_number}</span>
                    <span>{shortDate(inv.issue_date)}</span>
                    <span className="font-medium">{sar(inv.total)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <RenewalDecision />

          <ReferralCard />
        </div>
      )}
    </>
  );
}
