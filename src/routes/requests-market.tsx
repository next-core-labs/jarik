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
  searchRequests,
  toPublicMarketRequest,
  type PublicMarketRequest,
} from "@/lib/market-requests";
import { submitMarketRequest } from "@/lib/market-requests.functions";
import { PROPERTY_TYPE_GROUPS, type ListingPurpose } from "@/lib/property-types";
import { parseAmount, parseSaudiMobile } from "@/lib/public-form";
import { isStaffRole, useMyRoles } from "@/lib/use-role";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { tf } from "@/components/listing-detail/format";
import { publicCount, publicNum } from "@/lib/format";
import { localeFromSearch, useLocale, type Locale, type TranslationKey } from "@/lib/i18n";

export const Route = createFileRoute("/requests-market")({
  staticData: { sitemap: true, publicLocale: true },
  head: ({ match }) => {
    const locale = localeFromSearch(match.search);
    const title = tf(locale, "meta_requests_title");
    const description = tf(locale, "meta_requests_desc");
    const url = "https://jarak-ksa.com/requests-market";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
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
  { value: "rent", key: "rq_rent" },
  { value: "sale", key: "rq_buy" },
] as const;

const FILTER_OPTIONS = [{ value: "all", key: "tab_all" }, ...PURPOSE_OPTIONS] as const;

/** submitMarketRequest's own ceiling — checked here so the visitor gets a readable message. */
const MAX_BUDGET = 50_000_000;

/** Native select dressed like the design-system Input (44px, hairline, ink focus). */
const SELECT_CLASS =
  "h-11 w-full border border-input bg-card px-3 text-[15px] focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none";

/** «اليوم»، «أمس»، «منذ يومين»، «منذ 3 أيام»… — requests load client-side, so no SSR drift. */
function postedAgo(iso: string, locale: Locale): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return tf(locale, "rq_today");
  if (days === 1) return tf(locale, "rq_yesterday");
  if (days === 2) return tf(locale, "rq_two_days");
  return tf(locale, "rq_days_ago", {
    n: publicCount(
      days,
      locale,
      { one: "يوم واحد", two: "يومان", few: "أيام", many: "يومًا" },
      { one: "day", many: "days" },
    ),
  });
}

/** The budget line, in the public site's Western digits: «حتى 60,000 ر.س سنويًا». */
function budgetText(r: PublicMarketRequest, locale: Locale): string | null {
  const unit = tf(locale, r.purpose === "rent" ? "price_rent_unit" : "price_sale_unit");
  if (r.budgetMin && r.budgetMax) {
    return `${publicNum(r.budgetMin)} – ${publicNum(r.budgetMax)} ${unit}`;
  }
  if (r.budgetMax) return `${tf(locale, "rq_budget_upto", { v: publicNum(r.budgetMax) })} ${unit}`;
  if (r.budgetMin) return `${tf(locale, "rq_budget_from", { v: publicNum(r.budgetMin) })} ${unit}`;
  return null;
}

function RequestsMarket() {
  useTrackSiteVisit("/requests-market");
  const [locale] = useLocale();
  const t = (key: TranslationKey) => tf(locale, key);
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
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader />

      <main className="mx-auto grid w-full max-w-[1240px] items-start gap-7 px-5 pt-9 pb-16 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] leading-tight font-bold">{t("rq_title")}</h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              {t("rq_intro")}
              {!isStaff && !roles.isLoading ? (
                <>
                  {" "}
                  <Link
                    to="/auth"
                    className="font-semibold text-foreground underline underline-offset-4 hover:text-red-text"
                  >
                    {t("rq_signin")}
                  </Link>
                </>
              ) : null}
            </p>
          </div>

          {/* On a phone the form sits under the list — this jumps straight to it. */}
          <Button variant="outline" asChild className="w-fit lg:hidden">
            <a href="#add-request">
              <Plus aria-hidden />
              {t("rq_add")}
            </a>
          </Button>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div
              role="group"
              aria-label={t("rq_filter_aria")}
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
                  {t(o.key)}
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
                placeholder={t("rq_search_ph")}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label={t("rq_search_aria")}
              />
            </div>
            {requests.data ? (
              <span className="text-sm text-muted-foreground sm:ms-auto">
                {shown.length === 0
                  ? t("rq_none")
                  : publicCount(
                      shown.length,
                      locale,
                      { one: "طلب واحد", two: "طلبان", few: "طلبات", many: "طلبًا" },
                      { one: "request", many: "requests" },
                    )}
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
            <ArchEmptyState title={t("rq_error")} hint={t("results_error_body")}>
              <Button variant="outline" onClick={() => requests.refetch()}>
                {t("results_retry")}
              </Button>
            </ArchEmptyState>
          ) : shown.length === 0 ? (
            <ArchEmptyState
              title={t((requests.data ?? []).length === 0 ? "rq_empty_all" : "rq_empty_match")}
              hint={t(
                (requests.data ?? []).length === 0 ? "rq_empty_all_hint" : "rq_empty_match_hint",
              )}
            >
              {text || purposeFilter !== "all" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setText("");
                    setPurposeFilter("all");
                  }}
                >
                  {t("results_clear")}
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
                    locale={locale}
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
          <RequestForm locale={locale} />
        </aside>
      </main>
    </div>
  );
}

function RequestRow({
  request: r,
  staff,
  contact,
  locale,
}: {
  request: PublicMarketRequest;
  staff: boolean;
  contact?: { fullName: string; phone: string } | undefined;
  locale: Locale;
}) {
  const t = (key: TranslationKey) => tf(locale, key);
  const budget = budgetText(r, locale);
  const where =
    [r.district, r.city].filter(Boolean).join(locale === "en" ? ", " : "، ") ||
    t("rq_any_district");
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
        {t(r.purpose === "sale" ? "rq_buy" : "rq_rent")}
      </Badge>

      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <h2 className="text-base font-semibold">
          {r.unitType ?? t(r.purpose === "sale" ? "rq_any_sale" : "rq_any_rent")}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {where} · {postedAgo(r.createdAt, locale)}
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
                {t("card_whatsapp")}
              </a>
            </Button>
          ) : null}
          {tel ? (
            <Button size="sm" variant="outline" asChild>
              <a href={tel}>
                <Phone aria-hidden />
                {t("card_call")}
              </a>
            </Button>
          ) : null}
        </div>
      ) : staff ? null : (
        <Link
          to="/auth"
          title={t("rq_offices_only_hint")}
          className="flex h-9 items-center gap-1.5 border border-border px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
        >
          <Lock className="size-3.5" aria-hidden />
          {t("rq_offices_only")}
        </Link>
      )}
    </article>
  );
}

/** «أضف طلبك» — public, no sign-in; the server function enforces validation and the rate limit. */
function RequestForm({ locale }: { locale: Locale }) {
  const t = (key: TranslationKey) => tf(locale, key);
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
  const [touched, setTouched] = useState({ name: false, phone: false, budget: false });

  const mobile = parseSaudiMobile(phone);
  const budgetValue = parseAmount(budgetMax);
  const nameError = fullName.trim().length < 2 ? t("req_name_short") : null;
  const phoneError = mobile ? null : t("ld_req_phone_invalid");
  const budgetError =
    budgetValue === null
      ? t("ld_req_budget_invalid")
      : budgetValue !== undefined && budgetValue > MAX_BUDGET
        ? t("ld_req_budget_max")
        : null;
  const showNameError = touched.name && fullName.trim() !== "" && nameError;
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
    setTouched({ name: false, phone: false, budget: false });
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
    onError: (e: Error) => toast.error(userErrorMessage(e, t("rq_send_error"))),
  });

  if (sent) {
    return (
      <div className="flex flex-col gap-2.5" role="status">
        <span className="grid size-10 place-items-center bg-success text-success-foreground">
          <Check className="size-[22px]" aria-hidden />
        </span>
        <p className="text-lg font-bold">{t("rq_sent_title")}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("rq_sent_body")}</p>
        <Button variant="link" className="h-auto w-fit px-0" onClick={() => setSent(false)}>
          {t("rq_send_another")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched({ name: true, phone: true, budget: true });
        if (nameError || phoneError || budgetError) return;
        submit.mutate();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-bold">{t("rq_add")}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("rq_form_hint")}</p>
      </div>

      <div
        role="radiogroup"
        aria-label={t("ld_req_looking_for")}
        className="flex border-[1.5px] border-foreground"
      >
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
            {t(o.key)}
          </button>
        ))}
      </div>

      <Field id={`${id}-name`} label={t("rq_name")}>
        <Input
          id={`${id}-name`}
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          onBlur={() => setTouched((v) => ({ ...v, name: true }))}
          aria-invalid={showNameError ? true : undefined}
          aria-describedby={showNameError ? `${id}-name-error` : undefined}
        />
        {showNameError ? (
          <p id={`${id}-name-error`} className="text-xs text-destructive">
            {nameError}
          </p>
        ) : null}
      </Field>
      <Field id={`${id}-phone`} label={t("ld_req_phone")}>
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
      <Field id={`${id}-type`} label={t("rq_type")}>
        <select
          id={`${id}-type`}
          className={SELECT_CLASS}
          value={unitType}
          onChange={(e) => setUnitType(e.target.value)}
        >
          <option value="">{t("ld_req_type_ph")}</option>
          {PROPERTY_TYPE_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field
        id={`${id}-budget`}
        label={t(purpose === "sale" ? "rq_budget_sale" : "rq_budget_rent")}
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
        <Field id={`${id}-city`} label={t("rq_city")}>
          <Input id={`${id}-city`} value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field id={`${id}-district`} label={t("rq_district")}>
          <Input
            id={`${id}-district`}
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
          />
        </Field>
      </div>
      <Field id={`${id}-notes`} label={t("rq_notes")}>
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
        disabled={submit.isPending || !fullName.trim() || !phone.trim()}
      >
        {t(submit.isPending ? "rq_submitting" : "rq_submit")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("rq_privacy")}</p>
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
