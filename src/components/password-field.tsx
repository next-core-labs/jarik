import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** كلمة المرور مع زر إظهارها — الخطأ في كلمة لا تُرى هو أكثر أسباب فشل الدخول.
 *
 * مستخرج من auth.tsx (كان محليًا هناك) ليُعاد استخدامه في صفحات الدخول الأخرى (المستأجر/المالك)
 * بدل إعادة كتابة نفس المنطق — بما فيه إصلاح خلل حقيقي كان موجودًا: بدون z-10/pointer-events-none
 * كانت الأيقونة تبتلع نقرة المستخدم فلا يتبدّل ظهور كلمة المرور فعليًا. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  minLength,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
  autoComplete?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          dir="ltr"
          required
          minLength={minLength}
          autoComplete={autoComplete}
          className="pe-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
          aria-pressed={shown}
          // z-10: without it the input paints over the button and a real click lands on the field
          // instead of the eye, so the password never reveals.
          className="absolute end-2 top-1/2 z-10 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          {/* pointer-events-none: the click must land on the button itself. Landing on the icon's
              <path> loses the event when React swaps the icon on the same interaction. */}
          {shown ? (
            <EyeOff className="pointer-events-none size-4" />
          ) : (
            <Eye className="pointer-events-none size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
