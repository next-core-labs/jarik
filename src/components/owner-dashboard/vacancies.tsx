import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { DoorOpen, ExternalLink, EyeOff, ImageOff, TrendingDown, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { arNum, arPct, daysLabel, sar } from "@/lib/format";
import { toLatinDigits } from "@/lib/saudi-id";
import { cn } from "@/lib/utils";
import type { VacancyInsight } from "@/components/owner-dashboard/model";
import { Panel } from "@/components/owner-dashboard/parts";

export type RentRequest = { unitId: string; newRent: number; note?: string | undefined };

/**
 * Every vacant unit: how long it has been empty, its asking rent against similar units (same type,
 * district and office), a suggested rent, and whether the public can actually see its listing —
 * with a link to the listing exactly as a tenant sees it.
 */
export function Vacancies({
  vacancies,
  onRequestRent,
}: {
  vacancies: VacancyInsight[];
  onRequestRent: (r: RentRequest) => Promise<unknown>;
}) {
  const [dialog, setDialog] = useState<VacancyInsight | null>(null);
  if (vacancies.length === 0) return null;

  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-3 px-5 pt-5">
        <span className="grid size-10 shrink-0 place-items-center bg-background" aria-hidden>
          <DoorOpen className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-bold">وحداتك الشاغرة</h3>
          <p className="text-sm text-muted-foreground">
            كم مضى عليها، وكيف يقارن سعرها بالوحدات المماثلة، وهل يراها المستأجرون
          </p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {vacancies.map((v) => (
          <VacancyRow key={v.unit.unit_id} v={v} onAsk={() => setDialog(v)} />
        ))}
      </ul>

      <RentDialog
        key={dialog?.unit.unit_id ?? "closed"}
        vacancy={dialog}
        onClose={() => setDialog(null)}
        onSubmit={async (r) => {
          try {
            await onRequestRent(r);
            setDialog(null);
          } catch {
            // The page shows the error; keep the dialog so nothing typed is lost.
          }
        }}
      />
    </Panel>
  );
}

function VacancyRow({ v, onAsk }: { v: VacancyInsight; onAsk: () => void }) {
  const u = v.unit;
  const asking = Number(u.annual_rent);
  return (
    <li className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="font-medium">
          {u.property_name} · وحدة {u.unit_number}
          <span className="text-muted-foreground"> · {u.unit_type}</span>
        </p>
        <p
          className={cn(
            "text-sm",
            (v.daysVacant ?? 0) >= 60 ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {v.daysVacant === null
            ? "شاغرة"
            : v.daysVacant === 0
              ? "شغرت اليوم"
              : `شاغرة منذ ${daysLabel(v.daysVacant)}`}
          {v.daysVacant !== null && v.daysVacant > 0 && asking > 0
            ? ` — فات عليك نحو ${sar(Math.round(((asking / 365) * v.daysVacant) / 100) * 100)}`
            : ""}
        </p>
      </div>

      <div className="min-w-0 text-sm">
        <p>
          تطلب <span className="font-semibold tabular-nums">{sar(asking)}</span>
          {v.peerAvgRent ? (
            <>
              <span className="text-muted-foreground"> · المماثلة </span>
              <span className="font-semibold tabular-nums">{sar(v.peerAvgRent)}</span>
              <span className="text-muted-foreground">
                {" "}
                ({arNum(v.peerUnits)} وحدة)
                {v.deltaPct
                  ? ` · ${v.deltaPct > 0 ? "أعلى" : "أقل"} بـ${arPct(Math.abs(v.deltaPct))}`
                  : ""}
              </span>
            </>
          ) : null}
        </p>
        <Advice v={v} />
      </div>

      <div className="flex flex-wrap gap-2 md:justify-end">
        {v.publiclyListed ? (
          <Button size="sm" variant="outline" asChild>
            <Link to="/unit/$unitId" params={{ unitId: u.unit_id }} target="_blank">
              <ExternalLink aria-hidden />
              شاهد إعلانك
            </Link>
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {v.photos === 0 ? (
              <ImageOff className="size-4" aria-hidden />
            ) : (
              <EyeOff className="size-4" aria-hidden />
            )}
            {!v.marketListed
              ? "الإعلان متوقف"
              : v.photos === 0
                ? "غير معروضة — بلا صور"
                : "غير معروضة للعموم"}
          </span>
        )}
        {v.advice.kind === "lower" || v.advice.kind === "raise" ? (
          <Button size="sm" onClick={onAsk}>
            اطلب التعديل
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onAsk} className="text-muted-foreground">
            اقترح سعرًا
          </Button>
        )}
      </div>
    </li>
  );
}

function Advice({ v }: { v: VacancyInsight }) {
  const a = v.advice;
  if (a.kind === "lower") {
    return (
      <p className="mt-1 flex items-center gap-1.5 font-medium">
        <TrendingDown className="size-4 shrink-0" aria-hidden />
        اقتراح: خفّضه إلى {sar(a.target)} ليقترب من المماثلة
      </p>
    );
  }
  if (a.kind === "raise") {
    return (
      <p className="mt-1 flex items-center gap-1.5 font-medium">
        <TrendingUp className="size-4 shrink-0" aria-hidden />
        اقتراح: يمكن رفعه إلى {sar(a.target)} — سعرك دون المماثلة
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {a.kind === "hold"
        ? "سعرك ضمن نطاق الوحدات المماثلة."
        : "لا توجد وحدات مماثلة كافية في الحي للمقارنة."}
    </p>
  );
}

function RentDialog({
  vacancy,
  onClose,
  onSubmit,
}: {
  vacancy: VacancyInsight | null;
  onClose: () => void;
  onSubmit: (r: RentRequest) => Promise<void>;
}) {
  const suggested =
    vacancy && (vacancy.advice.kind === "lower" || vacancy.advice.kind === "raise")
      ? vacancy.advice.target
      : Number(vacancy?.unit.annual_rent ?? 0);
  const [rent, setRent] = useState(suggested ? String(suggested) : "");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const value = Number(rent);
  const valid = Number.isFinite(value) && value > 0;

  return (
    <Dialog open={!!vacancy} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>اطلب من المكتب تعديل الإيجار</DialogTitle>
          <DialogDescription>
            {vacancy
              ? `${vacancy.unit.property_name} · وحدة ${vacancy.unit.unit_number} — الإيجار الحالي ${sar(Number(vacancy.unit.annual_rent))} سنويًا`
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="new-rent" className="text-sm text-muted-foreground">
            الإيجار السنوي الجديد (ر.س)
          </label>
          <Input
            id="new-rent"
            inputMode="numeric"
            dir="ltr"
            value={rent}
            onChange={(e) => setRent(toLatinDigits(e.target.value).replace(/\D/g, ""))}
          />
          {vacancy?.peerAvgRent ? (
            <p className="text-xs text-muted-foreground">
              متوسط الوحدات المماثلة {sar(vacancy.peerAvgRent)}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label htmlFor="rent-note" className="text-sm text-muted-foreground">
            ملاحظة للمكتب (اختياري)
          </label>
          <Textarea
            id="rent-note"
            rows={2}
            maxLength={400}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button
            disabled={!valid || pending || !vacancy}
            onClick={async () => {
              if (!vacancy) return;
              setPending(true);
              await onSubmit({
                unitId: vacancy.unit.unit_id,
                newRent: value,
                note: note.trim() || undefined,
              });
              setPending(false);
            }}
          >
            {pending ? "جارٍ الإرسال…" : valid ? `أرسل ${sar(value)} للمكتب` : "أرسل للمكتب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
