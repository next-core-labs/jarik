import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import type { Decision } from "@/components/owner-dashboard/attention-center";
import { loadOwnerDashboard } from "@/components/owner-dashboard/model";
import {
  OwnerDashboardError,
  OwnerDashboardSkeleton,
  OwnerDashboardView,
} from "@/components/owner-dashboard/view";
import type { RenewalDecisionInput } from "@/components/owner-dashboard/renewals";
import type { RentRequest } from "@/components/owner-dashboard/vacancies";
import {
  decideMaintenanceApproval,
  requestVacantRentChange,
  submitOwnerRenewalDecision,
} from "@/lib/portal-actions.functions";
import { downloadElementAsPdf } from "@/lib/pdf";
import { sar } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/owner-dashboard")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "لوحة المالك — جارك" },
      {
        name: "description",
        content: "عقاراتك ووحداتك ونسبة إشغالها وعائدها، ومدفوعات مستأجريك وفواتيرك، في مكان واحد.",
      },
    ],
  }),
  component: OwnerDashboard,
});

function OwnerDashboard() {
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["owner-dashboard"],
    queryFn: loadOwnerDashboard,
  });

  // Nav links point at sections (#approvals, #finance…). Arriving from another page, the browser
  // looks for the anchor before the data has rendered it, so scroll once the sections exist.
  useEffect(() => {
    if (!data) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [data]);

  const decide = useMutation({
    mutationFn: (payload: Decision) => decideMaintenanceApproval({ data: payload }),
    onSuccess: (_res, vars) => {
      const cost = data?.approvals.find((a) => a.id === vars.requestId)?.cost;
      toast.success(
        vars.approved
          ? `وافقت${cost ? ` على ${sar(cost)}` : ""} — وصل قرارك للمكتب`
          : "رفضت الطلب — وصل قرارك للمكتب",
      );
      queryClient.invalidateQueries({ queryKey: ["owner-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["owner-nav-approvals"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تسجيل القرار")),
  });

  const renewalDecision = useMutation({
    mutationFn: (payload: RenewalDecisionInput) => submitOwnerRenewalDecision({ data: payload }),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.decision === "leave"
          ? "أبلغنا المكتب أنك لا ترغب بالتجديد"
          : vars.decision === "renew_new_rent"
            ? `أرسلنا للمكتب موافقتك على التجديد بـ${sar(vars.proposedRent ?? 0)}`
            : "أرسلنا للمكتب موافقتك على التجديد",
      );
      queryClient.invalidateQueries({ queryKey: ["owner-dashboard"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال قرارك")),
  });

  const rentRequest = useMutation({
    mutationFn: (payload: RentRequest) => requestVacantRentChange({ data: payload }),
    onSuccess: (_res, vars) =>
      toast.success(`أرسلنا للمكتب طلب تعديل الإيجار إلى ${sar(vars.newRent)}`),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الطلب")),
  });

  const exportExcel = async (
    sheets: { name: string; rows: Record<string, string | number>[] }[],
  ) => {
    try {
      // xlsx is large and only needed on click.
      const { exportWorkbook } = await import("@/lib/export-excel");
      exportWorkbook(`كشف-المالك-${data?.finance.today || "اليوم"}.xlsx`, sheets);
      toast.success("نزل ملف Excel");
    } catch {
      toast.error("تعذّر إنشاء ملف Excel");
    }
  };

  const downloadStatement = async (node: HTMLElement) => {
    setDownloading(true);
    try {
      await downloadElementAsPdf(node, "كشف-حساب-المالك.pdf");
      toast.success("نزل كشف الحساب PDF");
    } catch (e) {
      console.error("Owner statement PDF failed", e);
      toast.error("تعذّر إنشاء الملف");
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) return <OwnerDashboardSkeleton />;
  if (isError || !data) {
    return <OwnerDashboardError retrying={isRefetching} onRetry={() => refetch()} />;
  }

  return (
    <OwnerDashboardView
      data={data}
      deciding={decide.isPending ? (decide.variables?.requestId ?? null) : null}
      onDecide={(d) => decide.mutateAsync(d)}
      onRenewalDecision={(d) => renewalDecision.mutateAsync(d)}
      onRequestRent={(r) => rentRequest.mutateAsync(r)}
      downloading={downloading}
      onDownloadStatement={downloadStatement}
      onExportExcel={exportExcel}
    />
  );
}
