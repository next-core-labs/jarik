import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { tf } from "@/components/listing-detail/format";
import { submitUnitRequest } from "@/lib/office-tools.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { PROPERTY_TYPE_GROUPS, type ListingPurpose } from "@/lib/property-types";

/** نموذج عام للزوار: طلب وحدة بمواصفات معينة — يصل المكتب كإشعار ويتحول لصفقة محتملة. */
export function UnitRequestForm({
  unitType,
  district,
  city,
  officeId,
  officeName,
  purpose = "rent",
  locale = "ar",
}: {
  unitType?: string;
  district?: string | null;
  city?: string | null;
  /** The office whose listing is on screen: the request is delivered to it, not to another office. */
  officeId?: string | null;
  /** Shown in the confirmation once the request has been delivered. */
  officeName?: string | null;
  /** Renting or buying — taken from the listing the visitor is looking at. */
  purpose?: ListingPurpose;
  locale?: Locale;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [reqType, setReqType] = useState(unitType ?? "");
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [want, setWant] = useState<ListingPurpose>(purpose);
  const [referralCode, setReferralCode] = useState("");
  const [sent, setSent] = useState(false);
  const id = useId();
  const t = (key: Parameters<typeof tf>[1], vars?: Record<string, string | number>) =>
    tf(locale, key, vars);

  const submit = useMutation({
    mutationFn: () =>
      submitUnitRequest({
        data: {
          fullName,
          phone: phone.trim(),
          city: city ?? undefined,
          district: district ?? undefined,
          unitType: reqType || undefined,
          budget: budget ? Number(budget) : undefined,
          notes: notes || undefined,
          officeId: officeId ?? undefined,
          purpose: want,
          referralCode: referralCode.trim() || undefined,
        },
      }),
    onSuccess: () => {
      setSent(true);
      setFullName("");
      setPhone("");
      setBudget("");
      setNotes("");
      setReferralCode("");
    },
    onError: (e: Error) => toast.error(e.message || t("ld_req_error")),
  });

  if (sent) {
    return (
      <div className="flex flex-col items-start gap-2.5" role="status">
        <span className="grid size-10 place-items-center bg-success text-success-foreground">
          <Check className="size-[22px]" aria-hidden />
        </span>
        <p className="text-lg font-bold">
          {t("ld_req_sent_title", {
            office: officeName || (locale === "en" ? "the office" : "المكتب"),
          })}
        </p>
        <p className="text-sm leading-[1.7] text-muted-foreground">{t("ld_req_sent_body")}</p>
        <Button variant="link" className="h-auto px-0 text-sm" onClick={() => setSent(false)}>
          {t("ld_req_send_another")}
        </Button>
      </div>
    );
  }

  const field = (name: string) => `${id}-${name}`;

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      <h2 className="text-lg font-bold">{t("ld_request_title")}</h2>

      <div
        role="radiogroup"
        aria-label={t("ld_req_looking_for")}
        className="flex shadow-[inset_0_0_0_1.5px_var(--color-foreground)]"
      >
        {(
          [
            { value: "rent", label: t("ld_req_rent") },
            { value: "sale", label: t("ld_req_buy") },
          ] as const
        ).map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={want === o.value}
            onClick={() => setWant(o.value)}
            className={cn(
              "flex h-[42px] flex-1 cursor-pointer items-center justify-center text-[15px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
              want === o.value ? "bg-foreground text-background" : "text-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={field("name")}>{t("ld_req_name")}</Label>
        <Input
          id={field("name")}
          autoComplete="name"
          placeholder={t("ld_req_name_ph")}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={field("phone")}>{t("ld_req_phone")}</Label>
        <Input
          id={field("phone")}
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          placeholder="05XXXXXXXX"
          className="text-end"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={field("type")}>{t("ld_req_type")}</Label>
        <select
          id={field("type")}
          className="h-11 w-full cursor-pointer border border-input bg-card px-3 text-base focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none md:text-[15px]"
          value={reqType}
          onChange={(e) => setReqType(e.target.value)}
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
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={field("budget")}>
          {want === "sale" ? t("ld_req_budget_sale") : t("ld_req_budget_rent")}
        </Label>
        <Input
          id={field("budget")}
          dir="ltr"
          inputMode="numeric"
          className="text-end tabular-nums"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={field("notes")}>{t("ld_req_notes")}</Label>
        <Textarea
          id={field("notes")}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={field("referral")}>
          {t("ld_req_referral")}{" "}
          <span className="font-normal text-muted-foreground">{t("ld_req_optional")}</span>
        </Label>
        <Input
          id={field("referral")}
          dir="ltr"
          className="text-end uppercase placeholder:normal-case"
          value={referralCode}
          onChange={(e) => setReferralCode(e.target.value)}
          placeholder={t("ld_req_referral_ph")}
        />
      </div>
      <Button
        type="submit"
        size="lg"
        className="w-full justify-center"
        disabled={submit.isPending || fullName.trim().length < 2 || phone.trim().length < 9}
      >
        {submit.isPending ? t("ld_req_sending") : t("ld_req_submit")}
      </Button>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("ld_req_privacy")}</p>
    </form>
  );
}
