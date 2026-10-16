import { createFileRoute, Link } from "@tanstack/react-router";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, MessageCircle, Phone, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { ArchEmptyState } from "@/components/public/identity";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { phoneHref, whatsappHref } from "@/lib/market";
import {
  requestBudget,
  searchRequests,
  toPublicMarketRequest,
  type PublicMarketRequest,
} from "@/lib/market-requests";
import { submitMarketRequest } from "@/lib/market-requests.functions";
import { PROPERTY_TYPE_GROUPS, type ListingPurpose } from "@/lib/property-types";
import { parseAmount, parseSaudiMobile } from "@/lib/public-form";
import { isStaffRole, useMyRoles } from "@/lib/use-role";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { arCount, daysLabel } from "@/lib/format";

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
    links: [{ rel: "canonical", href: "https://jarak-ksa.com/requests-market" }],
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

const PURPOSE_OPTIONS = [
  { value: "rent", label: "إيجار" },
  { value: "sale", label: "شراء" },
] as const;

const FILTER_OPTIONS = [{ value: "all", label: "الكل" }, ...PURPOSE_OPTIONS] as const;

/** Native select dressed like the design-system Input (44px, hairline, ink focus). */
/** submitMarketRequest's own ceiling — checked here so the visitor gets a readable message. */
const MAX_BUDGET = 50_000_000;

const SELECT_CLASS =
  "h-11 w-full border border-input bg-card px-3 text-[15px] focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none";

/** «اليوم»، «أمس»، «منذ يومين»، «منذ ٣ أيام»… — requests load client-side, so no SSR drift. */
function postedAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  if (days === 2) return "منذ يومين";
  return `منذ ${daysLabel(days)}`;
}

function RequestsMarket() {
  useTrackSiteVisit("/requests-market");
  const requests = usePublicRequests();
  const roles = useMyRoles();
  const isStaff = isStaffRole(roles.data?.roles);
  const contacts = useStaffContacts(isStaff);
  const [text, setText] = useState("");
  const [purposeFilter, setPurposeFilter] = useState<ListingPurpose | "all">("all");

  const shown = useMemo(() => {
    const base = requests.data ?? [];
    const byPurpose =
      purposeFilter === "all" ? base : base.filter((r) => r.purpose === purposeFilter);
    return searchRequests(byPurpose, text);
  }, [requests.data, purposeFilter, text]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main className="mx-auto grid w-full max-w-[1240px] items-start gap-7 px-5 pt-9 pb-16 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] leading-tight font-bold">سوق الطلبات</h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              ما يبحث عنه الناس الآن. تُعرض الطلبات المفتوحة لآخر ٤٥ يومًا بدون أسماء أو أرقام،
              والتواصل متاح للمكاتب المسجّلة فقط.
              {!isStaff && !roles.isLoading ? (
                <>
                  {" "}
                  <Link
                    to="/auth"
                    className="font-semibold text-foreground underline underline-offset-4 hover:text-red-text"
                  >
                    سجّل دخولك كمكتب
                  </Link>
                </>
              ) : null}
            </p>
          </div>

          {/* On a phone the form sits under the list — this jumps straight to it. */}
          <Button variant="outline" asChild className="w-fit lg:hidden">
            <a href="#add-request">
              <Plus aria-hidden />
              أضف طلبك
            </a>
          </Button>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div
              role="group"
              aria-label="نوع الطلب"
              className="flex border-[1.5px] border-foreground"
            >
              {FILTER_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={purposeFilter === o.value}
                  onClick={() => setPurposeFilter(o.value)}
                  className={`h-10 flex-1 cursor-pointer px-4 text-sm font-semibold transition-colors sm:flex-none ${
                    purposeFilter === o.value
                      ? "bg-foreground text-background"
                      : "bg-card text-foreground hover:bg-muted"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="relative sm:max-w-xs sm:flex-1">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="ps-9"
                placeholder="ابحث بالحي أو النوع…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="بحث في الطلبات"
              />
            </div>
            {requests.data ? (
              <span className="text-sm text-muted-foreground sm:ms-auto">
                {shown.length === 0
                  ? "لا طلبات"
                  : arCount(shown.length, {
                      one: "طلب واحد",
                      two: "طلبان",
                      few: "طلبات",
                      many: "طلبًا",
                    })}
              </span>
            ) : null}
          </div>

          {requests.isLoading ? (
            <div className="flex flex-col gap-3" aria-busy>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[76px] animate-pulse border border-border bg-card" />
              ))}
            </div>
          ) : requests.isError ? (
            <ArchEmptyState title="تعذّر تحميل الطلبات" hint="تحقّق من الاتصال ثم أعد المحاولة.">
              <Button variant="outline" onClick={() => requests.refetch()}>
                إعادة المحاولة
              </Button>
            </ArchEmptyState>
          ) : shown.length === 0 ? (
            <ArchEmptyState
              title={
                (requests.data ?? []).length === 0
                  ? "لا توجد طلبات منشورة حاليًا"
                  : "لا توجد طلبات مطابقة"
              }
              hint={
                (requests.data ?? []).length === 0
                  ? "كن أول من ينشر طلبه — تراه كل المكاتب والملّاك في جارك."
                  : "جرّب كلمة أخرى أو نوع طلب مختلف."
              }
            >
              {text || purposeFilter !== "all" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setText("");
                    setPurposeFilter("all");
                  }}
                >
                  مسح التصفية
                </Button>
              ) : null}
            </ArchEmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((r) => (
                <li key={r.id}>
                  <RequestRow
                    request={r}
                    staff={isStaff}
                    contact={isStaff ? contacts.data?.get(r.id) : undefined}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside
          id="add-request"
          className="scroll-mt-4 border border-border bg-card p-[22px] lg:sticky lg:top-4"
        >
          <RequestForm />
        </aside>
      </main>
    </div>
  );
}

function RequestRow({
  request: r,
  staff,
  contact,
}: {
  request: PublicMarketRequest;
  staff: boolean;
  contact?: { fullName: string; phone: string } | undefined;
}) {
  const budget = requestBudget(r);
  const where = [r.district, r.city].filter(Boolean).join("، ") || "أي حي";
  const tel = contact ? phoneHref(contact.phone) : null;
  const wa = contact
    ? whatsappHref(contact.phone, `مرحبًا ${contact.fullName}، بخصوص طلبك في سوق طلبات جارك`)
    : null;

  return (
    <article className="flex flex-wrap items-center gap-x-4 gap-y-3 border border-border bg-card px-[18px] py-4">
      {/* Same pill language as the listing badges: ink for rent, outlined for sale. */}
      <Badge
        variant={r.purpose === "sale" ? "outline" : "default"}
        className="h-7 shrink-0 px-2.5 text-[13px]"
      >
        {r.purpose === "sale" ? "شراء" : "إيجار"}
      </Badge>

      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <h2 className="text-base font-semibold">
          {r.unitType ?? (r.purpose === "sale" ? "عقار للشراء" : "عقار للإيجار")}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {where} · {postedAgo(r.createdAt)}
        </p>
        {r.notes ? (
          <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{r.notes}</p>
        ) : null}
      </div>

      {budget ? <span className="text-[15px] font-bold tabular-nums">{budget}</span> : null}

      {contact ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="max-w-40 truncate text-sm font-medium">{contact.fullName}</span>
          {wa ? (
            <Button size="sm" variant="whatsapp" asChild>
              <a href={wa} target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden />
                واتساب
              </a>
            </Button>
          ) : null}
          {tel ? (
            <Button size="sm" variant="outline" asChild>
              <a href={tel}>
                <Phone aria-hidden />
                اتصال
              </a>
            </Button>
          ) : null}
        </div>
      ) : staff ? null : (
        <Link
          to="/auth"
          title="بيانات التواصل تظهر لموظفي المكاتب المسجَّلين فقط"
          className="flex h-9 items-center gap-1.5 border border-border px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
        >
          <Lock className="size-3.5" aria-hidden />
          للمكاتب فقط
        </Link>
      )}
    </article>
  );
}

/** «أضف طلبك» — public, no sign-in; the server function enforces validation and the rate limit. */
function RequestForm() {
  const id = useId();
  const queryClient = useQueryClient();
  const [sent, setSent] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState<ListingPurpose>("rent");
  const [unitType, setUnitType] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState({ phone: false, budget: false });

  const mobile = parseSaudiMobile(phone);
  const budgetValue = parseAmount(budgetMax);
  const phoneError = mobile ? null : "أدخل رقم جوال سعودي صحيح، مثل 0501234567";
  const budgetError =
    budgetValue === null
      ? "اكتب الميزانية بالأرقام فقط"
      : budgetValue !== undefined && budgetValue > MAX_BUDGET
        ? "الميزانية أكبر من الحد المسموح"
        : null;
  const showPhoneError = touched.phone && phone.trim() !== "" && phoneError;
  const showBudgetError = touched.budget && budgetError;

  const reset = () => {
    setFullName("");
    setPhone("");
    setUnitType("");
    setCity("");
    setDistrict("");
    setBudgetMax("");
    setNotes("");
    setTouched({ phone: false, budget: false });
  };

  const submit = useMutation({
    mutationFn: () =>
      submitMarketRequest({
        data: {
          fullName,
          phone: mobile ?? phone.trim(),
          purpose,
          unitType: unitType || undefined,
          city: city || undefined,
          district: district || undefined,
          budgetMax: budgetValue ?? undefined,
          notes: notes || undefined,
        },
      }),
    onSuccess: () => {
      reset();
      setSent(true);
      void queryClient.invalidateQueries({ queryKey: ["market-requests-public"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر نشر الطلب")),
  });

  if (sent) {
    return (
      <div className="flex flex-col gap-2.5" role="status">
        <span className="grid size-10 place-items-center bg-success text-success-foreground">
          <Check className="size-[22px]" aria-hidden />
        </span>
        <p className="text-lg font-bold">نُشر طلبك</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          سيبقى مفتوحًا ٤٥ يومًا في السوق، وتتواصل معك المكاتب والملّاك المهتمون مباشرة.
        </p>
        <Button variant="link" className="h-auto w-fit px-0" onClick={() => setSent(false)}>
          أضف طلبًا آخر
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched({ phone: true, budget: true });
        if (phoneError || budgetError) return;
        submit.mutate();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-bold">أضف طلبك</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          بدون تسجيل. يراه كل مكاتب وملّاك «جارك»، وليس مكتبًا واحدًا فقط.
        </p>
      </div>

      <div role="radiogroup" aria-label="أبحث عن" className="flex border-[1.5px] border-foreground">
        {PURPOSE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={purpose === o.value}
            onClick={() => setPurpose(o.value)}
            className={`h-[42px] flex-1 cursor-pointer text-[15px] font-semibold transition-colors ${
              purpose === o.value
                ? "bg-foreground text-background"
                : "bg-card text-foreground hover:bg-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <Field id={`${id}-name`} label="الاسم">
        <Input
          id={`${id}-name`}
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </Field>
      <Field id={`${id}-phone`} label="رقم الجوال">
        <Input
          id={`${id}-phone`}
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          placeholder="05XXXXXXXX"
          className="text-end"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => setTouched((v) => ({ ...v, phone: true }))}
          aria-invalid={showPhoneError ? true : undefined}
          aria-describedby={showPhoneError ? `${id}-phone-error` : undefined}
        />
        {showPhoneError ? (
          <p id={`${id}-phone-error`} className="text-xs text-destructive">
            {phoneError}
          </p>
        ) : null}
      </Field>
      <Field id={`${id}-type`} label="نوع الوحدة">
        <select
          id={`${id}-type`}
          className={SELECT_CLASS}
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
      </Field>
      <Field
        id={`${id}-budget`}
        label={purpose === "sale" ? "أقصى ميزانية للشراء (ريال)" : "أقصى إيجار سنوي (ريال)"}
      >
        <Input
          id={`${id}-budget`}
          dir="ltr"
          inputMode="numeric"
          className="text-end tabular-nums"
          value={budgetMax}
          onChange={(e) => setBudgetMax(e.target.value)}
          onBlur={() => setTouched((v) => ({ ...v, budget: true }))}
          aria-invalid={showBudgetError ? true : undefined}
          aria-describedby={showBudgetError ? `${id}-budget-error` : undefined}
        />
        {showBudgetError ? (
          <p id={`${id}-budget-error`} className="text-xs text-destructive">
            {budgetError}
          </p>
        ) : null}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${id}-city`} label="المدينة">
          <Input id={`${id}-city`} value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field id={`${id}-district`} label="الحي المفضّل">
          <Input
            id={`${id}-district`}
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
          />
        </Field>
      </div>
      <Field id={`${id}-notes`} label="تفاصيل إضافية (عدد الغرف، المواصفات…)">
        <Textarea
          id={`${id}-notes`}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <Button
        type="submit"
        size="lg"
        className="mt-1 w-full"
        disabled={submit.isPending || fullName.trim().length < 2 || !phone.trim()}
      >
        {submit.isPending ? "جارٍ النشر…" : "نشر الطلب"}
      </Button>
      <p className="text-xs text-muted-foreground">
        لا يظهر اسمك أو رقمك للعموم — تراه المكاتب المسجّلة فقط. حد أقصى ٣ طلبات في الساعة لكل رقم.
      </p>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {children}
    </div>
  );
}
