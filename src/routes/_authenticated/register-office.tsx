import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/register-office")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "تسجيل مكتب عقاري — جارك" },
      {
        name: "description",
        content: "سجّل مكتبك في جارك: أضف عقاراتك ووحداتك وعروضك وأدر عملاءك في مساحة خاصة بمكتبك.",
      },
    ],
  }),
  component: RegisterOffice,
});

function RegisterOffice() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [fal, setFal] = useState("");
  const [phone, setPhone] = useState("");

  // An account belongs to at most one office: if it already does, there is nothing to register.
  const myOffice = useQuery({
    queryKey: ["my-org-id"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_org_id");
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  const register = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 3) throw new Error("اكتب اسم المكتب (3 أحرف على الأقل)");
      const { data, error } = await supabase.rpc("register_office", {
        _name: name.trim(),
        _city: city.trim(),
        _district: district.trim(),
        _fal: fal.trim(),
        _phone: phone.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.success("تم تسجيل مكتبك — يمكنك البدء بإضافة عقاراتك الآن");
      // The account just became office staff: refresh what the shell and screens know about it.
      await queryClient.invalidateQueries();
      navigate({ to: "/dashboard", replace: true });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر تسجيل المكتب"),
  });

  if (myOffice.isLoading) {
    return (
      <>
        <PageHeader title="تسجيل مكتب عقاري" />
        <Skeleton className="h-64" />
      </>
    );
  }

  if (myOffice.data) {
    return (
      <>
        <PageHeader title="تسجيل مكتب عقاري" />
        <Card className="shadow-deed">
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-muted-foreground">
              حسابك تابع لمكتب بالفعل، ولا يمكن تسجيل مكتب ثانٍ بالحساب نفسه.
            </p>
            <Button asChild>
              <Link to="/dashboard">الذهاب للوحة المؤشرات</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="تسجيل مكتب عقاري"
        subtitle="أنشئ مساحة مكتبك: عقاراتك ووحداتك وعقودك وعروضك ومحاصيلك، ولا يراها أي مكتب آخر."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="shadow-deed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4" />
              بيانات المكتب
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                register.mutate();
              }}
            >
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="office-name">اسم المكتب</Label>
                <Input
                  id="office-name"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: مكتب النخبة العقاري"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="office-city">المدينة</Label>
                <Input
                  id="office-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="الرياض"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="office-district">الحي</Label>
                <Input
                  id="office-district"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  placeholder="الملقا"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="office-fal">رقم رخصة فال</Label>
                <Input
                  id="office-fal"
                  dir="ltr"
                  value={fal}
                  onChange={(e) => setFal(e.target.value)}
                  placeholder="1234567890"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="office-phone">رقم الجوال</Label>
                <Input
                  id="office-phone"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="05xxxxxxxx"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={register.isPending}>
                  {register.isPending ? "جارٍ التسجيل…" : "سجّل مكتبي"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="h-fit shadow-deed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              ماذا يحدث بعد التسجيل؟
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>تصبح مدير المكتب وتضيف موظفيك وتربط ملاّكك ومستأجريك من شاشة «فريق المكتب».</p>
            <p>بيانات مكتبك معزولة تمامًا عن بقية المكاتب.</p>
            <p>
              تظهر عروض مكتبك في سوق العروض للجميع بعد أن تراجع إدارة المنصة بياناتك وتوثّق المكتب.
              إلى ذلك الحين يعمل مكتبك بالكامل داخليًا.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
