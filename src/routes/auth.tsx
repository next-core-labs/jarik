import { JarakLogo } from "@/components/jarak-logo";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PasswordField } from "@/components/password-field";
import { authErrorMessage, emailProblem } from "@/lib/auth-errors";
import { isNativeApp, nativeOAuthSignIn } from "@/lib/native";
import { resolvePostLoginPath } from "@/lib/portal-routing";
import { parseSaudiMobile } from "@/lib/public-form";
import { safeNext } from "@/lib/safe-redirect";
import {
  ACCOUNT_TYPE_LABEL,
  digitsOnly,
  idTypeOf,
  validateFalLicense,
  validateSaudiId,
  type AccountType,
} from "@/lib/saudi-id";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { AppRole } from "@/lib/use-role";

export const Route = createFileRoute("/auth")({
  staticData: { sitemap: false },
  validateSearch: (s: Record<string, unknown>) => {
    const next = safeNext(s["next"]);
    return next ? { next } : {};
  },
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — جارك" },
      { name: "description", content: "الدخول إلى منصة جارك لإدارة الأملاك والعقود والتحصيل." },
      { property: "og:title", content: "تسجيل الدخول — جارك" },
      { property: "og:url", content: "https://jarak-ksa.com/auth" },
      { property: "og:description", content: "الدخول إلى منصة جارك لإدارة الأملاك." },
    ],
    links: [{ rel: "canonical", href: "https://jarak-ksa.com/auth" }],
  }),
  component: AuthPage,
});

const SAVED_EMAIL_KEY = "jarak-saved-email";

// The Google button shows only when the build sets VITE_GOOGLE_AUTH_ENABLED=true. Turn it on after
// enabling the Google provider in Supabase (Authentication → Providers) and listing this site's
// origin under Redirect URLs; with the provider off, Supabase answers the redirect with a raw JSON
// 400 page. A build flag (not a runtime check of /auth/v1/settings) keeps the server and client
// render identical and costs no request on every visit.
const GOOGLE_AUTH_ENABLED = import.meta.env["VITE_GOOGLE_AUTH_ENABLED"] === "true";

function passwordProblem(password: string): string | null {
  if (!password) return "أدخل كلمة المرور";
  if (password.length < 6) return "كلمة المرور 6 أحرف على الأقل";
  return null;
}

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch() as { next?: string };
  const next = safeNext(search.next);
  const [loading, setLoading] = useState(false);
  // Until React has hydrated, a click would submit the bare form as a browser GET (no handler yet).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("office");
  const [nationalId, setNationalId] = useState("");
  const [falLicense, setFalLicense] = useState("");
  const [rememberEmail, setRememberEmail] = useState(true);

  /** null = the ordinary forms; otherwise the step we are standing on. */
  const [step, setStep] = useState<null | "verify" | "forgot" | "reset">(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_EMAIL_KEY);
      if (saved) setEmail(saved);
      else setRememberEmail(false);
    } catch {
      /* private browsing: no saved email, no harm */
    }
  }, []);

  function rememberOrForget() {
    try {
      if (rememberEmail) localStorage.setItem(SAVED_EMAIL_KEY, email);
      else localStorage.removeItem(SAVED_EMAIL_KEY);
    } catch {
      /* storage unavailable: the session still works */
    }
  }

  /** Each account goes straight to its own home: super-admins to /hq, a new office signup with no
   * role yet to /register-office, everyone else by role (office, owner, tenant, technician, or the
   * choice screen when the account has more than one), so nobody detours through /dashboard. */
  async function roleBasedDestination(): Promise<string> {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return "/dashboard";
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows ?? []).map((r) => r.role as AppRole);
    if (roles.includes("super_admin")) return "/hq";
    const accountType = (user.user_metadata as { account_type?: string } | null)?.account_type;
    if (roles.length === 0 && accountType === "office") return "/register-office";
    return resolvePostLoginPath(roles);
  }

  async function goNext() {
    if (next) {
      window.location.href = next;
      return;
    }
    navigate({ to: await roleBasedDestination(), replace: true });
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      if (next) {
        window.location.href = next;
        return;
      }
      navigate({ to: await roleBasedDestination(), replace: true });
    });
  }, [navigate, next]);

  /** Shows the first problem as a toast; the forms use noValidate, so these replace the browser's
   * English bubbles. */
  function blocked(problem: string | null): boolean {
    if (problem) toast.error(problem);
    return !!problem;
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (blocked(emailProblem(email) ?? (password ? null : "أدخل كلمة المرور"))) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      // Supabase says "Email not confirmed" when the address was never verified.
      if (/confirm/i.test(error.message)) {
        toast.error("لم يُفعَّل بريدك بعد — أرسلنا لك رمزًا جديدًا");
        await resendCode();
        return;
      }
      toast.error(authErrorMessage(error, "تعذّر الدخول: تحقّق من البريد وكلمة المرور"));
      return;
    }
    rememberOrForget();
    await goNext();
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (blocked(fullName.trim() ? null : "اكتب الاسم")) return;
    // Optional, but when given it must be a Saudi mobile; it is stored as 05XXXXXXXX.
    const mobile = phone.trim() ? parseSaudiMobile(phone) : null;
    if (blocked(phone.trim() && !mobile ? "رقم الجوال غير صحيح — مثال: 05xxxxxxxx" : null)) return;
    const idProblem = validateSaudiId(nationalId, accountType);
    if (idProblem) {
      toast.error(idProblem);
      return;
    }
    if (accountType === "office") {
      const falProblem = validateFalLicense(falLicense);
      if (falProblem) {
        toast.error(falProblem);
        return;
      }
    }
    if (blocked(emailProblem(email) ?? passwordProblem(password))) return;

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${next ?? "/dashboard"}`,
        data: {
          full_name: fullName,
          phone: mobile,
          account_type: accountType,
          national_id: digitsOnly(nationalId),
          id_type: accountType === "office" ? "national" : idTypeOf(nationalId),
          fal_license_no: accountType === "office" ? digitsOnly(falLicense) : null,
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(
        authErrorMessage(
          error,
          /already registered/i.test(error.message)
            ? "هذا البريد مسجَّل من قبل — سجّل الدخول أو استعد كلمة المرور"
            : "تعذّر إنشاء الحساب — حاول مرة أخرى",
        ),
      );
      return;
    }
    rememberOrForget();
    // A project with email confirmation on returns a user with no session: the account exists but
    // cannot sign in until the address is verified.
    if (data.session) {
      toast.success("تم إنشاء حسابك");
      await goNext();
      return;
    }
    setStep("verify");
    toast.success("أرسلنا رمز التفعيل إلى بريدك");
  }

  async function resendCode() {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) {
      toast.error(authErrorMessage(error, "تعذّر إرسال الرمز — حاول بعد قليل"));
      return;
    }
    setStep("verify");
    toast.success("أرسلنا رمزًا جديدًا إلى بريدك");
  }

  async function verifyEmail(e: React.FormEvent) {
    e.preventDefault();
    if (blocked(digitsOnly(code) ? null : "أدخل رمز التفعيل")) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: digitsOnly(code),
      type: "signup",
    });
    setLoading(false);
    if (error) {
      toast.error(authErrorMessage(error, "الرمز غير صحيح أو انتهت صلاحيته"));
      return;
    }
    toast.success("فُعِّل حسابك");
    await goNext();
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    if (blocked(emailProblem(email))) return;
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) {
      toast.error(authErrorMessage(error, "تعذّر إرسال الرمز — حاول بعد قليل"));
      return;
    }
    setStep("reset");
    // Always the same wording, so this cannot be used to learn which addresses are registered.
    toast.success("إن كان البريد مسجَّلًا فسيصلك رمز لإعادة التعيين");
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (blocked(digitsOnly(code) ? null : "أدخل رمز إعادة التعيين")) return;
    if (blocked(passwordProblem(newPassword))) return;
    setLoading(true);
    const { error: otpError } = await supabase.auth.verifyOtp({
      email,
      token: digitsOnly(code),
      type: "recovery",
    });
    if (otpError) {
      setLoading(false);
      toast.error(authErrorMessage(otpError, "الرمز غير صحيح أو انتهت صلاحيته"));
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      toast.error(authErrorMessage(error, "تعذّر تغيير كلمة المرور — حاول مرة أخرى"));
      return;
    }
    rememberOrForget();
    toast.success("تم تغيير كلمة المرور");
    await goNext();
  }

  // Supabase's own Google provider (enable it under Authentication → Providers, and list this
  // site's origin under Authentication → URL Configuration → Redirect URLs).
  async function google() {
    if (isNativeApp()) {
      const { error } = await nativeOAuthSignIn("google", next);
      if (error) toast.error("تعذّر الدخول عبر Google");
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${next ?? ""}` },
    });
    if (error) toast.error("تعذّر الدخول عبر Google");
  }

  const rememberBox = (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <Checkbox
        checked={rememberEmail}
        onCheckedChange={(v) => setRememberEmail(v === true)}
        aria-label="حفظ معلوماتي"
      />
      حفظ بريدي على هذا الجهاز
    </label>
  );

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <JarakLogo />
        </div>
        <div>
          <h2 className="font-display text-3xl leading-snug font-bold">
            نظام يلاحق التحصيل والصيانة والعقود بدلاً عن الموظف.
          </h2>
          <p className="mt-4 max-w-md text-sidebar-foreground/70">
            أملاك ووحدات وعدادات، عقود ودفعات، صيانة، فواتير إلكترونية، وبوابات للمالك والمستأجر
            والفني.
          </p>
        </div>
        <Link to="/" className="text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground">
          <ArrowLeft className="ms-1 inline size-4" /> رجوع للصفحة الرئيسية
        </Link>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* The side panel with the home link is hidden on phones, so they get their own. */}
          <div className="mb-8 flex items-center justify-between gap-4 lg:hidden">
            <Link to="/" aria-label="جارك — الصفحة الرئيسية">
              <JarakLogo size="sm" />
            </Link>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              رجوع للصفحة الرئيسية
            </Link>
          </div>
          {step === "verify" ? (
            <>
              <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
                <MailCheck className="size-6 text-primary" />
                فعِّل حسابك
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                أرسلنا رمزًا من 6 أرقام إلى <span dir="ltr">{email}</span>.
              </p>
              <form onSubmit={verifyEmail} noValidate className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">رمز التفعيل</Label>
                  <Input
                    id="code"
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="text-center text-lg tracking-[0.4em]"
                    placeholder="000000"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading || !hydrated}>
                  تفعيل الحساب
                </Button>
              </form>
              <div className="mt-4 flex justify-between text-sm">
                <button
                  type="button"
                  className="text-foreground underline underline-offset-4 hover:text-red-text"
                  onClick={resendCode}
                >
                  إعادة إرسال الرمز
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={() => setStep(null)}
                >
                  رجوع
                </button>
              </div>
            </>
          ) : step === "forgot" ? (
            <>
              <h1 className="font-display text-2xl font-bold">نسيت كلمة المرور</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                اكتب بريدك ونرسل لك رمزًا لإعادة التعيين.
              </p>
              <form onSubmit={sendReset} noValidate className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">البريد الإلكتروني</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    dir="ltr"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading || !hydrated}>
                  أرسل الرمز
                </Button>
              </form>
              <button
                type="button"
                className="mt-4 text-sm text-muted-foreground hover:underline"
                onClick={() => setStep(null)}
              >
                رجوع لتسجيل الدخول
              </button>
            </>
          ) : step === "reset" ? (
            <>
              <h1 className="font-display text-2xl font-bold">كلمة مرور جديدة</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                اكتب الرمز الذي وصل إلى <span dir="ltr">{email}</span> وكلمة المرور الجديدة.
              </p>
              <form onSubmit={resetPassword} noValidate className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-code">رمز إعادة التعيين</Label>
                  <Input
                    id="reset-code"
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="text-center text-lg tracking-[0.4em]"
                    placeholder="000000"
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
                <Button type="submit" className="w-full" disabled={loading || !hydrated}>
                  حفظ كلمة المرور
                </Button>
              </form>
              <button
                type="button"
                className="mt-4 text-sm text-muted-foreground hover:underline"
                onClick={() => setStep("forgot")}
              >
                لم يصلني الرمز
              </button>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold">مرحبًا بك</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                سجّل الدخول للوصول إلى لوحة الإدارة.
              </p>

              <Tabs defaultValue="signin" className="mt-6">
                <TabsList className="w-full">
                  <TabsTrigger value="signin" className="flex-1">
                    دخول
                  </TabsTrigger>
                  <TabsTrigger value="signup" className="flex-1">
                    حساب جديد
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="signin">
                  <form onSubmit={signIn} noValidate className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">البريد الإلكتروني</Label>
                      <Input
                        id="email"
                        type="email"
                        dir="ltr"
                        required
                        autoComplete="email"
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
                    <div className="flex items-center justify-between">
                      {rememberBox}
                      <button
                        type="button"
                        className="text-sm text-foreground underline underline-offset-4 hover:text-red-text"
                        onClick={() => setStep("forgot")}
                      >
                        نسيت كلمة المرور؟
                      </button>
                    </div>
                    <Button type="submit" className="w-full" disabled={loading || !hydrated}>
                      دخول
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup">
                  <form onSubmit={signUp} noValidate className="space-y-4">
                    <div className="space-y-2">
                      <Label>نوع الحساب</Label>
                      {/* المستأجر لم يعد يسجّل نفسه من هنا — يُدعى من المكتب على عقده ويفعّل حسابه
                          من رابط الدعوة (/tenant/activate)، أو يدخل مباشرة من /tenant/login بعد
                          التفعيل. */}
                      <div className="grid grid-cols-2 gap-2">
                        {(["office", "owner"] as const).map((t) => (
                          <Button
                            key={t}
                            type="button"
                            size="sm"
                            variant={accountType === t ? "default" : "outline"}
                            onClick={() => setAccountType(t)}
                          >
                            {ACCOUNT_TYPE_LABEL[t]}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="name">
                        {accountType === "office" ? "اسم المسؤول" : "الاسم الكامل"}
                      </Label>
                      <Input
                        id="name"
                        required
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="national-id">
                        {accountType === "office" ? "رقم الهوية الوطنية" : "رقم الهوية أو الإقامة"}
                      </Label>
                      <Input
                        id="national-id"
                        dir="ltr"
                        inputMode="numeric"
                        maxLength={10}
                        required
                        placeholder={
                          accountType === "office" ? "1xxxxxxxxx" : "1xxxxxxxxx أو 2xxxxxxxxx"
                        }
                        value={nationalId}
                        onChange={(e) => setNationalId(digitsOnly(e.target.value))}
                      />
                      <p className="text-xs text-muted-foreground">
                        {accountType === "office"
                          ? "حساب المكتب يحتاج هوية وطنية (تبدأ بـ1)."
                          : "الهوية الوطنية تبدأ بـ1 والإقامة تبدأ بـ2."}
                      </p>
                    </div>

                    {accountType === "office" ? (
                      <div className="space-y-2">
                        <Label htmlFor="fal">رقم رخصة فال</Label>
                        <Input
                          id="fal"
                          dir="ltr"
                          inputMode="numeric"
                          required
                          placeholder="1200012345"
                          value={falLicense}
                          onChange={(e) => setFalLicense(digitsOnly(e.target.value))}
                        />
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <Label htmlFor="phone">رقم الجوال</Label>
                      <Input
                        id="phone"
                        dir="ltr"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="05xxxxxxxx"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email2">البريد الإلكتروني</Label>
                      <Input
                        id="email2"
                        type="email"
                        dir="ltr"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <PasswordField
                      id="password2"
                      label="كلمة المرور"
                      value={password}
                      onChange={setPassword}
                      minLength={6}
                      autoComplete="new-password"
                    />
                    {rememberBox}
                    <Button type="submit" className="w-full" disabled={loading || !hydrated}>
                      إنشاء الحساب
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      بعد الإنشاء يصلك رمز من 6 أرقام على بريدك لتفعيل الحساب.
                    </p>
                  </form>
                </TabsContent>
              </Tabs>

              {GOOGLE_AUTH_ENABLED ? (
                <>
                  <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" /> أو{" "}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <Button variant="outline" className="w-full" onClick={google}>
                    المتابعة عبر Google
                  </Button>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
