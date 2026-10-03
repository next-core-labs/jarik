import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageCircle, Phone, Plus, SearchX } from "lucide-react";
import { toast } from "sonner";

import { SiteHeader, bandPatternStyle } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { phoneHref, whatsappHref } from "@/lib/market";
import {
  requestBudget,
  requestTitle,
  searchRequests,
  toPublicMarketRequest,
  type PublicMarketRequest,
} from "@/lib/market-requests";
import { submitMarketRequest } from "@/lib/market-requests.functions";
import { PROPERTY_TYPE_GROUPS, type ListingPurpose } from "@/lib/property-types";
import { isStaffRole, useMyRoles } from "@/lib/use-role";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { shortDate } from "@/lib/format";

export const Route = createFileRoute("/requests-market")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "سوق الطلبات — جارك" },
      {
        name: "description",
        content:
          "زوّار يبحثون عن وحدة للإيجار أو الشراء وينشرون طلبهم هنا — يراه كل مكتب ومالك، بلا حصرية لمكتب واحد.",
      },
    ],
  }),
  component: RequestsMarket,
});

function usePublicRequests() {
  return useQuery({
    queryKey: ["market-requests-public"],
    staleTime: 30_000,
    queryFn: async (): Promise<PublicMarketRequest[]> => {
      const { data, error } = await supabase
        .from("market_requests_public")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? [])
        .map(toPublicMarketRequest)
        .filter((r): r is PublicMarketRequest => r !== null);
    },
  });
}

/** بيانات التواصل، للموظفين المسجّلين فقط — استعلام منفصل يمر عبر الجدول الأساسي المقيَّد. */
function useStaffContacts(enabled: boolean) {
  return useQuery({
    queryKey: ["market-requests-staff-contacts"],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, { fullName: string; phone: string }>> => {
      const { data, error } = await supabase
        .from("market_requests")
        .select("id, full_name, phone")
        .eq("status", "open");
      if (error) throw error;
      const map = new Map<string, { fullName: string; phone: string }>();
      for (const row of data ?? []) {
        map.set(row.id, { fullName: row.full_name, phone: row.phone });
      }
      return map;
    },
  });
}

function RequestsMarket() {
  useTrackSiteVisit("/requests-market");
  const requests = usePublicRequests();
  const roles = useMyRoles();
  const isStaff = isStaffRole(roles.data?.roles);
  const contacts = useStaffContacts(isStaff);
  const [text, setText] = useState("");
  const [purposeFilter, setPurposeFilter] = useState<ListingPurpose | "all">("all");
  const [formOpen, setFormOpen] = useState(false);

  const shown = useMemo(() => {
    const base = requests.data ?? [];
    const byPurpose =
      purposeFilter === "all" ? base : base.filter((r) => r.purpose === purposeFilter);
    return searchRequests(byPurpose, text);
  }, [requests.data, purposeFilter, text]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section
        className="relative bg-sidebar bg-cover bg-center text-sidebar-foreground"
        style={bandPatternStyle}
      >
        <div className="bg-sidebar/60">
          <div className="mx-auto max-w-6xl px-4 py-10 md:py-14">
            <h1 className="font-display text-3xl font-bold md:text-4xl">سوق الطلبات</h1>
            <p className="mt-2 max-w-2xl text-sidebar-foreground/85">
              عملاء يبحثون عن وحدة للإيجار أو الشراء — انشر طلبك ليراه كل مكاتب وملّاك «جارك»، أو
              تصفّح الطلبات إن كنت مكتبًا لديه ما يناسبها.
            </p>
            <div className="mt-5">
              <RequestFormDialog open={formOpen} onOpenChange={setFormOpen} />
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-1 rounded-md border border-border bg-card p-1">
            {(
              [
                { value: "all", label: "الكل" },
                { value: "rent", label: "إيجار" },
                { value: "sale", label: "شراء" },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setPurposeFilter(o.value)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  purposeFilter === o.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Input
            className="sm:max-w-xs"
            placeholder="ابحث بالحي أو النوع…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="بحث في الطلبات"
          />
          <span className="text-sm text-muted-foreground sm:mr-auto">
            {shown.length.toLocaleString("ar-SA")} طلب
          </span>
        </div>

        {!isStaff && !roles.isLoading ? (
          <p className="mb-4 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            بيانات التواصل (الاسم والجوال) تظهر لموظفي المكاتب المسجَّلين فقط.{" "}
            <a href="/auth" className="font-medium text-primary hover:underline">
              سجّل دخولك كمكتب
            </a>{" "}
            لعرضها والتواصل المباشر.
          </p>
        ) : null}

        {requests.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg border border-border bg-card" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
            <SearchX className="size-10 opacity-50" aria-hidden />
            <p className="font-medium text-foreground">
              {(requests.data ?? []).length === 0
                ? "لا توجد طلبات منشورة حاليًا"
                : "لا توجد طلبات مطابقة"}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                contact={isStaff ? contacts.data?.get(r.id) : undefined}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function RequestCard({
  request: r,
  contact,
}: {
  request: PublicMarketRequest;
  contact?: { fullName: string; phone: string } | undefined;
}) {
  const budget = requestBudget(r);
  const tel = contact ? phoneHref(contact.phone) : null;
  const wa = contact
    ? whatsappHref(contact.phone, `مرحبًا ${contact.fullName}، بخصوص طلبك في سوق طلبات جارك`)
    : null;

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-deed">
      <div className="flex items-start justify-between gap-2">
        {/* Red is reserved for price/primary action/available, same as the listing purpose badge —
            rent and sale read the same neutral ink here, distinguished by text only. */}
        <Badge className="bg-brass text-brass-foreground hover:bg-brass">
          {r.purpose === "sale" ? "شراء" : "إيجار"}
        </Badge>
        <span className="text-xs text-muted-foreground">{shortDate(r.createdAt)}</span>
      </div>

      <h3 className="font-bold leading-snug">{requestTitle(r)}</h3>
      {budget ? <p className="text-sm font-medium text-primary">{budget}</p> : null}
      {r.notes ? <p className="line-clamp-2 text-sm text-muted-foreground">{r.notes}</p> : null}

      {contact ? (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <span className="truncate text-sm font-medium">{contact.fullName}</span>
          <div className="flex gap-2">
            {tel ? (
              <Button size="sm" variant="outline" asChild>
                <a href={tel}>
                  <Phone className="size-4" aria-hidden />
                  اتصال
                </a>
              </Button>
            ) : null}
            {wa ? (
              <Button size="sm" variant="outline" asChild className="text-success">
                <a href={wa} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" aria-hidden />
                  واتساب
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function RequestFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState<ListingPurpose>("rent");
  const [unitType, setUnitType] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setFullName("");
    setPhone("");
    setUnitType("");
    setCity("");
    setDistrict("");
    setBudgetMax("");
    setNotes("");
  };

  const submit = useMutation({
    mutationFn: () =>
      submitMarketRequest({
        data: {
          fullName,
          phone: phone.trim(),
          purpose,
          unitType: unitType || undefined,
          city: city || undefined,
          district: district || undefined,
          budgetMax: budgetMax ? Number(budgetMax) : undefined,
          notes: notes || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("نُشر طلبك — راح يشوفه المكاتب والملّاك في السوق");
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر نشر الطلب"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="lg">
          <Plus className="size-4" />
          أضف طلبك
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ماذا تبحث عنه؟</DialogTitle>
          <DialogDescription>
            ينشر طلبك في سوق الطلبات العام — يراه كل مكاتب وملّاك «جارك»، وليس مكتبًا واحدًا فقط.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            {(
              [
                { value: "rent", label: "إيجار" },
                { value: "sale", label: "شراء" },
              ] as const
            ).map((o) => (
              <Button
                key={o.value}
                type="button"
                size="sm"
                variant={purpose === o.value ? "default" : "outline"}
                onClick={() => setPurpose(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>الاسم</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>رقم الجوال</Label>
              <Input
                dir="ltr"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>نوع الوحدة</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={unitType}
                onChange={(e) => setUnitType(e.target.value)}
              >
                <option value="">اختر النوع</option>
                {PROPERTY_TYPE_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {purpose === "sale" ? "أقصى ميزانية للشراء (ريال)" : "أقصى إيجار سنوي (ريال)"}
              </Label>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={budgetMax}
                onChange={(e) => setBudgetMax(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>المدينة</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>الحي المفضّل</Label>
              <Input value={district} onChange={(e) => setDistrict(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>تفاصيل إضافية (عدد الغرف، المواصفات…)</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={submit.isPending || fullName.trim().length < 2 || phone.trim().length < 9}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "جارٍ النشر…" : "انشر الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
