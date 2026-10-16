import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitDemoRequest } from "@/lib/demo-requests.functions";
import { toLatinDigits } from "@/lib/saudi-id";

const EMPTY = { fullName: "", phone: "", officeName: "", city: "", unitsCount: "", notes: "" };
const NO_TOUCH = { fullName: false, phone: false, unitsCount: false };

// Same rules as submitDemoRequest's validator, so the form explains a refusal before sending.
function problems(form: typeof EMPTY) {
  const phone = toLatinDigits(form.phone.trim());
  const units = toLatinDigits(form.unitsCount.trim());
  return {
    fullName: form.fullName.trim().length < 2 ? "اكتب اسمك (حرفان على الأقل)" : null,
    phone: !phone
      ? "أدخل رقم الجوال"
      : /^[0-9+\s-]{9,15}$/.test(phone)
        ? null
        : "رقم الجوال غير صحيح — مثال: 05XXXXXXXX",
    unitsCount:
      units && !(/^\d+$/.test(units) && Number(units) <= 100_000)
        ? "عدد الوحدات رقم صحيح من 0 فأكثر"
        : null,
  };
}

/** «احجز عرضاً توضيحياً»: a short public form that lands in /hq → المكاتب والسوق. */
export function DemoRequestDialog({ trigger }: { trigger: ReactNode }) {
  const submit = useServerFn(submitDemoRequest);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState(NO_TOUCH);
  const touch = (k: keyof typeof NO_TOUCH) => () => setTouched((t) => ({ ...t, [k]: true }));
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const send = useMutation({
    mutationFn: () =>
      submit({
        data: {
          fullName: form.fullName,
          phone: toLatinDigits(form.phone.trim()),
          officeName: form.officeName || undefined,
          city: form.city || undefined,
          unitsCount: form.unitsCount ? Number(toLatinDigits(form.unitsCount)) : undefined,
          notes: form.notes || undefined,
        },
      }),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الطلب")),
  });

  const errors = problems(form);
  const valid = !errors.fullName && !errors.phone && !errors.unitsCount;
  const shown = (k: keyof typeof NO_TOUCH) => (touched[k] ? errors[k] : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v && send.isSuccess) {
          send.reset();
          setForm(EMPTY);
          setTouched(NO_TOUCH);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-[460px]">
        {send.isSuccess ? (
          <div className="flex flex-col items-start gap-2.5 py-2">
            <span className="grid size-10 place-items-center bg-success text-success-foreground">
              <Check className="size-[22px]" aria-hidden />
            </span>
            <DialogTitle className="text-lg font-bold">وصل طلبك</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              سيتواصل معك فريق جارك خلال يوم عمل لترتيب موعد العرض التوضيحي.
            </DialogDescription>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) {
                setTouched({ fullName: true, phone: true, unitsCount: true });
                return;
              }
              if (!send.isPending) send.mutate();
            }}
          >
            <DialogHeader className="text-start">
              <DialogTitle className="text-xl font-bold">احجز عرضاً توضيحياً</DialogTitle>
              <DialogDescription>
                نعرض لك النظام على وحداتك خلال ٣٠ دقيقة، عن بُعد أو في مكتبك.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="demo-name">الاسم</Label>
              <Input
                id="demo-name"
                value={form.fullName}
                onChange={set("fullName")}
                onBlur={touch("fullName")}
                required
                aria-invalid={shown("fullName") ? true : undefined}
                aria-describedby={shown("fullName") ? "demo-name-error" : undefined}
              />
              {shown("fullName") ? (
                <p id="demo-name-error" className="text-xs text-destructive">
                  {errors.fullName}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="demo-phone">رقم الجوال</Label>
              <Input
                id="demo-phone"
                dir="ltr"
                inputMode="tel"
                placeholder="05XXXXXXXX"
                className="text-end"
                value={form.phone}
                onChange={set("phone")}
                onBlur={touch("phone")}
                required
                aria-invalid={shown("phone") ? true : undefined}
                aria-describedby={shown("phone") ? "demo-phone-error" : undefined}
              />
              {shown("phone") ? (
                <p id="demo-phone-error" className="text-xs text-destructive">
                  {errors.phone}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="demo-office">اسم المكتب</Label>
                <Input id="demo-office" value={form.officeName} onChange={set("officeName")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="demo-city">المدينة</Label>
                <Input id="demo-city" value={form.city} onChange={set("city")} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="demo-units">عدد الوحدات التي تديرها (تقريبًا)</Label>
              <Input
                id="demo-units"
                dir="ltr"
                inputMode="numeric"
                className="text-end"
                value={form.unitsCount}
                onChange={set("unitsCount")}
                onBlur={touch("unitsCount")}
                aria-invalid={shown("unitsCount") ? true : undefined}
                aria-describedby={shown("unitsCount") ? "demo-units-error" : undefined}
              />
              {shown("unitsCount") ? (
                <p id="demo-units-error" className="text-xs text-destructive">
                  {errors.unitsCount}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="demo-notes">
                ملاحظات <span className="font-normal text-muted-foreground">(اختياري)</span>
              </Label>
              <Textarea
                id="demo-notes"
                value={form.notes}
                onChange={set("notes")}
                maxLength={1000}
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={send.isPending}>
              {send.isPending ? "جارٍ الإرسال…" : "أرسل الطلب"}
            </Button>
            <p className="text-xs text-muted-foreground">
              لا نشارك رقمك مع أي جهة، ونستخدمه للتواصل بخصوص العرض فقط.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
