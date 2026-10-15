import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { JarakLogo } from "@/components/jarak-logo";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bandPatternStyle } from "@/components/site-header";
import { supabase } from "@/integrations/supabase/client";
import { resolvePostLoginPath } from "@/lib/portal-routing";
import { portalSignIn } from "@/lib/tenant-portal.functions";
import type { AppRole } from "@/lib/use-role";

/**
 * دخول منفصل تمامًا عن /auth الرئيسية — تُستخدم لكل من المستأجر والمالك بنفس الآلية بالضبط
 * (إيميل وكلمة مرور فقط، بلا SMS ولا OTP، مع قفل مؤقت بعد محاولات فاشلة عبر portalSignIn).
 * الفرق الوحيد بين الاثنين هو إتاحة رابط "سجّل حساب جديد" للمالك فقط — المستأجر لا يسجّل نفسه،
 * يُفعَّل حسابه من رابط دعوة المكتب (/tenant/activate).
 */
export function PortalLoginPage({
  title,
  heroTitle,
  heroBody,
  allowSelfRegister,
}: {
  title: string;
  heroTitle: string;
  heroBody: string;
  allowSelfRegister: boolean;
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<null | "forgot" | "reset">(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { access_token, refresh_token } = await portalSignIn({ data: { email, password } });
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      const { data: userData } = await supabase.auth.getUser();
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user?.id ?? "");
      const roles = (roleRows ?? []).map((r) => r.role as AppRole);
      navigate({ to: resolvePostLoginPath(roles), replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(email);
      // نفس الصياغة سواء كان البريد مسجَّلًا أو لا، حتى لا تُستخدم الصفحة لمعرفة من هو مسجَّل.
      toast.success("إن كان البريد مسجَّلًا فسيصلك رمز لإعادة التعيين");
      setStep("reset");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error: otpError } = await supabase.auth.verifyOtp({
        email,
        token: code.replace(/\D/g, ""),
        type: "recovery",
      });
      if (otpError) {
        toast.error("الرمز غير صحيح أو انتهت صلاحيته");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("تغيّرت كلمة المرور — سجّل دخولك");
      setStep(null);
      setPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر إعادة التعيين");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center p-6 sm:p-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <JarakLogo size="sm" />
          </div>
          <h1 className="font-display text-2xl font-bold">{title}</h1>

          {step === null ? (
            <form onSubmit={signIn} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">البريد الإلكتروني</Label>
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <PasswordField
                id="password"
                label="كلمة المرور"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="text-sm text-foreground underline underline-offset-4 hover:text-red-text"
                onClick={() => setStep("forgot")}
              >
                نسيت كلمة المرور؟
              </button>
              <Button type="submit" className="w-full" disabled={loading}>
                دخول
              </Button>
              {allowSelfRegister ? (
                <p className="text-center text-sm text-muted-foreground">
                  ما عندك حساب؟{" "}
                  <Link
                    to="/auth"
                    search={{ next: "/owner-dashboard" }}
                    className="text-foreground underline underline-offset-4 hover:text-red-text"
                  >
                    سجّل حساب جديد
                  </Link>
                </p>
              ) : null}
            </form>
          ) : step === "forgot" ? (
            <form onSubmit={sendReset} className="mt-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                أدخل بريدك وسيصلك رمز لإعادة تعيين كلمة المرور.
              </p>
              <div className="space-y-2">
                <Label htmlFor="reset-email">البريد الإلكتروني</Label>
                <Input
                  id="reset-email"
                  type="email"
                  dir="ltr"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                أرسل الرمز
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setStep(null)}
              >
                رجوع لتسجيل الدخول
              </button>
            </form>
          ) : (
            <form onSubmit={resetPassword} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-code">رمز التحقق</Label>
                <Input
                  id="reset-code"
                  dir="ltr"
                  inputMode="numeric"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <PasswordField
                id="new-password"
                label="كلمة المرور الجديدة"
                value={newPassword}
                onChange={setNewPassword}
                minLength={6}
                autoComplete="new-password"
              />
              <Button type="submit" className="w-full" disabled={loading}>
                تغيير كلمة المرور
              </Button>
            </form>
          )}
        </div>
      </div>

      <div
        className="relative hidden flex-col justify-between bg-sidebar bg-cover bg-center p-12 text-sidebar-foreground lg:flex"
        style={bandPatternStyle}
      >
        <div className="flex items-center gap-2">
          <JarakLogo />
        </div>
        <div>
          <h2 className="font-display text-3xl leading-snug font-bold">{heroTitle}</h2>
          <p className="mt-4 max-w-md text-sidebar-foreground/70">{heroBody}</p>
        </div>
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-2 text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground"
        >
          رجوع للصفحة الرئيسية
        </Link>
      </div>
    </div>
  );
}
