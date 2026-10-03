import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { submitUnitRequest } from "@/lib/office-tools.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { PROPERTY_TYPE_GROUPS, type ListingPurpose } from "@/lib/property-types";

/** نموذج عام للزوار: طلب وحدة بمواصفات معينة — يصل المكتب كإشعار ويتحول لصفقة محتملة. */
export function UnitRequestForm({
  unitType,
  district,
  city,
  officeId,
  purpose = "rent",
}: {
  unitType?: string;
  district?: string | null;
  city?: string | null;
  /** The office whose listing is on screen: the request is delivered to it, not to another office. */
  officeId?: string | null;
  /** Renting or buying — taken from the listing the visitor is looking at. */
  purpose?: ListingPurpose;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [reqType, setReqType] = useState(unitType ?? "");
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [want, setWant] = useState<ListingPurpose>(purpose);
  const [referralCode, setReferralCode] = useState("");

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
      toast.success("وصل طلبك للمكتب — سييتواصلون معك قريبًا");
      setFullName("");
      setPhone("");
      setBudget("");
      setNotes("");
      setReferralCode("");
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر إرسال الطلب"),
  });

  return (
    <Card className="mt-6 shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">لم تجد ما يناسبك؟ اطلب وحدتك ونبحث لك</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>أبحث عن</Label>
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
                  variant={want === o.value ? "default" : "outline"}
                  onClick={() => setWant(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
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
            <Label>نوع الوحدة المطلوبة</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={reqType}
              onChange={(e) => setReqType(e.target.value)}
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
              {want === "sale" ? "الميزانية للشراء (ريال)" : "الميزانية السنوية (ريال)"}
            </Label>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>ملاحظات (الحي المطلوب، عدد الغرف…)</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>رمز إحالة (اختياري)</Label>
          <Input
            dir="ltr"
            className="uppercase"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            placeholder="إن أحالك أحد ملّاكنا أو مستأجرينا"
          />
        </div>
        <Button
          disabled={submit.isPending || fullName.trim().length < 2 || phone.trim().length < 9}
          onClick={() => submit.mutate()}
        >
          <Send className="size-4" />
          {submit.isPending ? "جارٍ الإرسال…" : "أرسل الطلب للمكتب"}
        </Button>
        <p className="text-xs text-muted-foreground">
          يصل طلبك فورًا لموظفي المكتب كإشعار، ويُسجَّل تلقائيًا كعميل محتمل.
        </p>
      </CardContent>
    </Card>
  );
}
