import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  ExternalLink,
  ImageOff,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { userErrorMessage } from "@/lib/auth-errors";
import { dailyListingStatus } from "@/lib/daily-listings";
import { sar } from "@/lib/format";
import { mediaUrl } from "@/lib/unit-photos";

import { LISTINGS_KEY, unitLabel, type DailyListing } from "./model";

/** إعلانات الحجز اليومي: ما هو منشور، وما ينقص غير المنشور، ورخصة كل إعلان. */
export function ListingsTab({
  listings,
  onAdd,
  onEdit,
}: {
  listings: DailyListing[];
  onAdd: () => void;
  onEdit: (listing: DailyListing) => void;
}) {
  const queryClient = useQueryClient();

  const setEnabled = useMutation({
    mutationFn: async (input: { unitId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("unit_booking_settings")
        .update({ enabled: input.enabled })
        .eq("unit_id", input.unitId);
      if (error) throw error;
      return input;
    },
    onSuccess: async (input) => {
      toast.success(
        input.enabled
          ? "عاد الإعلان لاستقبال الحجوزات"
          : "أُوقف الإعلان — لن يظهر في سوق الحجز اليومي",
      );
      await queryClient.invalidateQueries({ queryKey: LISTINGS_KEY });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث الإعلان")),
  });

  if (listings.length === 0) {
    return (
      <Card className="shadow-deed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Megaphone className="size-10 text-muted-foreground opacity-50" aria-hidden />
          <p className="max-w-md text-sm text-muted-foreground">
            لا إعلانات بعد. أضف شاليهك أو استراحتك أو وحدتك المفروشة هنا مباشرة: الصور، سعر الليلة،
            ورقم رخصة الإيواء السياحي — بلا عقود ولا إيجار سنوي.
          </p>
          <Button size="sm" onClick={onAdd}>
            <Plus className="size-4" />
            إعلان جديد
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd}>
          <Plus className="size-4" />
          إعلان جديد
        </Button>
      </div>

      {listings.map((l) => {
        const status = dailyListingStatus({
          live: l.live,
          enabled: l.settings.enabled,
          nightly_rate: l.settings.nightly_rate,
          tourism_license_no: l.settings.tourism_license_no,
          market_listed: l.market_listed,
          unit_status: l.status,
        });
        const place = [l.unit_type, l.district ? `حي ${l.district}` : null, l.property?.city]
          .filter(Boolean)
          .join(" · ");
        return (
          <Card key={l.unit_id} className="shadow-deed">
            <CardContent className="flex gap-4 p-4">
              <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-sm bg-muted sm:size-24">
                {l.cover_path ? (
                  <img
                    src={mediaUrl(l.cover_path)}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <ImageOff className="size-6 text-muted-foreground opacity-50" aria-hidden />
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{unitLabel(l)}</p>
                    <p className="text-xs text-muted-foreground">{place}</p>
                  </div>
                  <Badge variant={status.state === "live" ? "default" : "secondary"}>
                    {status.label}
                  </Badge>
                </div>

                <p className="text-sm tabular-nums">
                  {l.settings.nightly_rate ? (
                    <>
                      <span className="font-semibold">{sar(l.settings.nightly_rate)}</span>
                      <span className="text-muted-foreground"> / الليلة</span>
                      {l.settings.weekend_rate &&
                      l.settings.weekend_rate !== l.settings.nightly_rate ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · نهاية الأسبوع {sar(l.settings.weekend_rate)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">بلا سعر ليلة</span>
                  )}
                </p>

                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
                  {l.settings.tourism_license_no?.trim() ? (
                    <>
                      رخصة الإيواء: <span dir="ltr">{l.settings.tourism_license_no}</span>
                    </>
                  ) : (
                    "بلا رقم رخصة إيواء"
                  )}
                </p>

                {status.hint ? (
                  <p className="rounded-sm border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {status.hint}
                  </p>
                ) : null}
                {!l.dailyOnly ? (
                  <p className="text-xs text-muted-foreground">
                    تُؤجَّر سنويًا أيضًا — مواصفاتها وصورها من «الأملاك والوحدات».
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(l)}>
                    <Pencil className="size-4" />
                    تعديل
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setEnabled.isPending}
                    onClick={() =>
                      // التشغيل من نافذة التعديل حين ينقص سعر أو رخصة: هناك تُقال النواقص وتُكمَل.
                      !l.settings.enabled && status.state === "paused" && !canResume(l)
                        ? onEdit(l)
                        : setEnabled.mutate({ unitId: l.unit_id, enabled: !l.settings.enabled })
                    }
                  >
                    {l.settings.enabled ? (
                      <>
                        <Pause className="size-4" />
                        إيقاف
                      </>
                    ) : (
                      <>
                        <Play className="size-4" />
                        تشغيل
                      </>
                    )}
                  </Button>
                  {l.live ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/unit/$unitId" params={{ unitId: l.unit_id }} target="_blank">
                        <ExternalLink className="size-4" />
                        صفحة الإعلان
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** إعلان متوقف يعود بضغطة واحدة فقط إن كان مكتملًا: سعر ليلة ورخصة. */
function canResume(l: DailyListing): boolean {
  return Number(l.settings.nightly_rate) > 0 && Boolean(l.settings.tourism_license_no?.trim());
}
