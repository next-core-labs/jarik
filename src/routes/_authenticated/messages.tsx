import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MessagesSquare } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { UnitChat } from "@/components/unit-chat";
import { DirectMessagesTab } from "@/components/direct-messages-tab";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMyRoles, isStaffRole } from "@/lib/use-role";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/messages")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "المحادثات — جارك" },
      {
        name: "description",
        content: "محادثة لكل وحدة بين المكتب والمالك والمستأجر، ومحادثات مباشرة بين أي حسابين.",
      },
      { property: "og:title", content: "المحادثات — جارك" },
      { property: "og:description", content: "المكتب والمالك والمستأجر في محادثة واحدة لكل وحدة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MessagesPage,
});

/** "وحدة 12 — برج الملقا", without a dangling dash when the property name isn't readable. */
function unitLabel(u: {
  unit_name: string | null;
  unit_number: string;
  properties: { name: string } | null;
}) {
  const name = u.unit_name || `وحدة ${u.unit_number}`;
  return u.properties?.name ? `${name} — ${u.properties.name}` : name;
}

function MessagesPage() {
  const { data: me } = useMyRoles();
  const roles = me?.roles ?? [];
  const staff = isStaffRole(roles);
  // Unit threads are for the office, owner and tenant (unit_messages RLS); a technician-only
  // account can read its job units but not their threads, so it gets direct chats only and
  // reaches the tenant from the job card on /portal.
  const technicianOnly =
    roles.includes("technician") && !staff && !roles.includes("owner") && !roles.includes("tenant");
  const myRole = staff
    ? "staff"
    : roles.includes("owner")
      ? "owner"
      : roles.includes("tenant")
        ? "tenant"
        : "unknown";
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDirect, setSelectedDirect] = useState<string | null>(null);

  const profile = useQuery({
    queryKey: ["my-profile-name"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", auth.user.id)
        .maybeSingle();
      return data?.full_name ?? auth.user.email ?? "مشارك";
    },
  });

  const units = useQuery({
    queryKey: ["chat-units"],
    enabled: !!me && !technicianOnly,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("id, unit_number, unit_name, status, properties(name)")
        .order("unit_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const list = units.data ?? [];
  const active = selected ?? list[0]?.id ?? null;

  return (
    <>
      <PageHeader
        title="المحادثات"
        subtitle={
          technicianOnly
            ? "محادثات مباشرة بينك وبين أي حساب آخر برقمه التعريفي."
            : "محادثة لكل وحدة يشارك فيها المكتب والمالك والمستأجر، ومحادثات مباشرة بين أي حسابين."
        }
      />

      {technicianOnly ? (
        <p className="mb-4 text-sm text-muted-foreground">
          للتواصل مع مستأجر عمل مسند لك استخدم زر الاتصال في بطاقة العمل في صفحتي.
        </p>
      ) : null}

      <Tabs
        key={technicianOnly ? "direct" : "units"}
        defaultValue={technicianOnly ? "direct" : "units"}
      >
        <TabsList className="mb-4">
          {technicianOnly ? null : <TabsTrigger value="units">محادثات الوحدات</TabsTrigger>}
          <TabsTrigger value="direct">محادثات مباشرة</TabsTrigger>
        </TabsList>

        <TabsContent value="units">
          <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
            <Card className="shadow-deed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessagesSquare className="size-4 text-brass" />
                  الوحدات
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {units.isLoading || !me ? (
                  <Skeleton className="h-32" />
                ) : list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد وحدات مرتبطة بحسابك.</p>
                ) : (
                  list.map((u) => (
                    <Button
                      key={u.id}
                      variant="ghost"
                      onClick={() => setSelected(u.id)}
                      className={cn(
                        "w-full justify-start",
                        active === u.id && "bg-secondary text-secondary-foreground",
                      )}
                    >
                      <span className="truncate">{unitLabel(u)}</span>
                    </Button>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="shadow-deed">
              <CardHeader>
                <CardTitle className="text-base">
                  {(() => {
                    const u = active ? list.find((x) => x.id === active) : null;
                    return u ? unitLabel(u) : "المحادثة";
                  })()}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {active ? (
                  <UnitChat unitId={active} myRole={myRole} myName={profile.data ?? "مشارك"} />
                ) : (
                  <p className="text-sm text-muted-foreground">اختر وحدة لبدء المحادثة.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="direct">
          <DirectMessagesTab
            myName={profile.data ?? "مشارك"}
            selected={selectedDirect}
            onSelect={setSelectedDirect}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
