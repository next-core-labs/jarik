import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { shortDate } from "@/lib/format";

/** صف تحديثات المستأجر: آخر رسائل المكتب، إعلانات المبنى، والمستندات المتاحة. */
export function UpdatesRow({ unitId, propertyId }: { unitId: string; propertyId: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <MessagesCard unitId={unitId} />
      <AnnouncementsCard propertyId={propertyId} />
      <DocumentsCard propertyId={propertyId} />
    </div>
  );
}

function MessagesCard({ unitId }: { unitId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["tenant-updates-messages", unitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_messages")
        .select("id, body, sender_name, sender_role, created_at")
        .eq("unit_id", unitId)
        .eq("sender_role", "staff")
        .order("created_at", { ascending: false })
        .limit(2);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">آخر الرسائل</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : isError || !data ? (
          <p className="text-sm text-destructive">تعذّر تحميل الرسائل.</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا رسائل من المكتب بعد.</p>
        ) : (
          <div className="space-y-2">
            {data.map((m) => (
              <div
                key={m.id}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <p className="line-clamp-2">{m.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{shortDate(m.created_at)}</p>
              </div>
            ))}
          </div>
        )}
        <Button size="sm" variant="outline" asChild>
          <Link to="/messages">
            <MessageCircle className="size-4" />
            فتح المحادثات
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function AnnouncementsCard({ propertyId }: { propertyId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["tenant-updates-announcements", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("building_announcements")
        .select("id, title, body, created_at")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">إعلانات المبنى</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : isError || !data ? (
          <p className="text-sm text-destructive">تعذّر تحميل الإعلانات.</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا إعلانات حاليًا.</p>
        ) : (
          data.map((a) => (
            <div
              key={a.id}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <p className="font-medium">{a.title}</p>
              {a.body ? (
                <p className="line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">{shortDate(a.created_at)}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function DocumentsCard({ propertyId }: { propertyId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["tenant-updates-documents", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_documents")
        .select("id, title, kind, file_path, expires_at")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data ?? [];
    },
  });

  const openFile = async (path: string) => {
    const { data: signed, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(path, 300);
    if (error || !signed) {
      toast.error("تعذّر فتح الملف");
      return;
    }
    window.open(signed.signedUrl, "_blank", "noopener");
  };

  const docs = (data ?? []).filter((d): d is typeof d & { file_path: string } =>
    Boolean(d.file_path),
  );

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">المستندات</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : isError || !data ? (
          <p className="text-sm text-destructive">تعذّر تحميل المستندات.</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا مستندات محفوظة بعد.</p>
        ) : (
          <div className="space-y-2">
            {docs.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <span className="line-clamp-1">{d.title}</span>
                <Button size="sm" variant="outline" onClick={() => openFile(d.file_path)}>
                  <FileText className="size-4" />
                  فتح
                </Button>
              </div>
            ))}
          </div>
        )}
        <Button size="sm" variant="outline" asChild>
          <Link to="/documents">كل المستندات</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
