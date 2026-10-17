import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FURNISHING_LABEL,
  FURNISHING_OPTIONS,
  FURNITURE_CATALOGUE,
  type Furnishing,
  type FurnitureItem,
} from "@/lib/furniture";

const CATALOGUE_NAMES = new Set(FURNITURE_CATALOGUE.flatMap((g) => g.items));

/**
 * مستوى التأثيث + قائمة الأثاث بكمياتها. Unfurnished hides the list (the database also empties it),
 * so a unit cannot be «غير مؤثثة» with furniture still listed.
 */
export function FurnitureEditor({
  furnishing,
  items,
  notes,
  onChange,
  disabled = false,
}: {
  furnishing: Furnishing;
  items: FurnitureItem[];
  notes: string;
  onChange: (next: { furnishing: Furnishing; items: FurnitureItem[]; notes: string }) => void;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState("");
  const emit = (
    patch: Partial<{ furnishing: Furnishing; items: FurnitureItem[]; notes: string }>,
  ) => onChange({ furnishing, items, notes, ...patch });

  const qtyOf = (name: string) => items.find((i) => i.name === name)?.qty ?? 0;
  const setQty = (name: string, qty: number) => {
    const clamped = Math.max(0, Math.min(99, qty));
    const rest = items.filter((i) => i.name !== name);
    emit({ items: clamped === 0 ? rest : [...rest, { name, qty: clamped }] });
  };
  const toggle = (name: string) => setQty(name, qtyOf(name) > 0 ? 0 : 1);

  const addCustom = () => {
    const name = custom.trim().slice(0, 60);
    if (!name) return;
    if (qtyOf(name) === 0) setQty(name, 1);
    setCustom("");
  };
  const customItems = items.filter((i) => !CATALOGUE_NAMES.has(i.name));
  const total = items.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">التأثيث</Label>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="مستوى التأثيث">
          {FURNISHING_OPTIONS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={furnishing === f}
              disabled={disabled}
              onClick={() => emit({ furnishing: f })}
              className={`border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                furnishing === f
                  ? "border-foreground bg-foreground text-background"
                  : "border-input hover:bg-muted"
              }`}
            >
              {FURNISHING_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {furnishing === "none" ? null : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">ما الأثاث الموجود؟</p>
            <p className="text-xs text-muted-foreground">
              {total > 0 ? `${items.length} صنف · ${total} قطعة` : "اختر القطع وحدّد العدد"}
            </p>
          </div>
          {FURNITURE_CATALOGUE.map((g) => (
            <div key={g.room} className="space-y-2">
              <p className="text-xs text-muted-foreground">{g.room}</p>
              <div className="flex flex-wrap gap-2">
                {g.items.map((name) => (
                  <ItemChip
                    key={name}
                    name={name}
                    qty={qtyOf(name)}
                    disabled={disabled}
                    onToggle={() => toggle(name)}
                    onQty={(q) => setQty(name, q)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">قطع أخرى</p>
            {customItems.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {customItems.map((i) => (
                  <ItemChip
                    key={i.name}
                    name={i.name}
                    qty={i.qty}
                    disabled={disabled}
                    removable
                    onToggle={() => setQty(i.name, 0)}
                    onQty={(q) => setQty(i.name, q)}
                  />
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Input
                value={custom}
                maxLength={60}
                disabled={disabled}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                placeholder="مثال: بيانو، جهاز رياضي"
                aria-label="اسم قطعة أثاث أخرى"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addCustom}
                disabled={disabled || !custom.trim()}
              >
                <Plus className="size-4" />
                إضافة
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">حالة الأثاث وملاحظات (اختياري)</Label>
            <Textarea
              rows={2}
              maxLength={2000}
              value={notes}
              disabled={disabled}
              onChange={(e) => emit({ notes: e.target.value })}
              placeholder="مثال: الأثاث جديد ٢٠٢٥، المكيفات بضمان سنتين"
            />
          </div>
        </>
      )}
    </div>
  );
}

function ItemChip({
  name,
  qty,
  disabled,
  removable = false,
  onToggle,
  onQty,
}: {
  name: string;
  qty: number;
  disabled: boolean;
  removable?: boolean;
  onToggle: () => void;
  onQty: (qty: number) => void;
}) {
  if (qty === 0) {
    return (
      <button
        type="button"
        aria-pressed={false}
        disabled={disabled}
        onClick={onToggle}
        className="border border-input px-3 py-1 text-xs transition-colors hover:bg-muted disabled:opacity-50"
      >
        {name}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center border border-foreground bg-foreground text-xs text-background">
      <button
        type="button"
        aria-pressed
        disabled={disabled}
        onClick={onToggle}
        className="inline-flex items-center gap-1 px-3 py-1"
        aria-label={`إزالة ${name}`}
      >
        {removable ? <X className="size-3" /> : null}
        {name}
      </button>
      <span className="flex items-center border-s border-background/30">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onQty(qty - 1)}
          className="px-1.5 py-1 hover:bg-background/15"
          aria-label={`إنقاص عدد ${name}`}
        >
          <Minus className="size-3" />
        </button>
        <span className="min-w-4 text-center tabular-nums" aria-label={`عدد ${name}`}>
          {qty}
        </span>
        <button
          type="button"
          disabled={disabled || qty >= 99}
          onClick={() => onQty(qty + 1)}
          className="px-1.5 py-1 hover:bg-background/15"
          aria-label={`زيادة عدد ${name}`}
        >
          <Plus className="size-3" />
        </button>
      </span>
    </span>
  );
}
