import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UNIT_PHOTOS,
  validateImageFile,
  type PhotoItem,
} from "@/lib/unit-photos";

const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
};

/**
 * Photo picker for a unit: add several photos, remove, re-order, and choose the cover (the first
 * one is what the offers market shows). New files stay local until the unit is saved.
 */
export function UnitPhotosEditor({
  items,
  onChange,
  disabled = false,
}: {
  items: PhotoItem[];
  onChange: (items: PhotoItem[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Release the object URLs of unsaved previews when the editor goes away.
  useEffect(
    () => () => {
      for (const it of itemsRef.current) if (it.file) URL.revokeObjectURL(it.preview);
    },
    [],
  );

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_UNIT_PHOTOS - items.length;
    const added: PhotoItem[] = [];
    for (const file of Array.from(files)) {
      const problem = validateImageFile(file);
      if (problem) {
        toast.error(`${file.name}: ${problem}`);
        continue;
      }
      if (added.length >= room) {
        toast.warning(`الحد الأقصى ${MAX_UNIT_PHOTOS} صور لكل وحدة`);
        break;
      }
      added.push({
        key: crypto.randomUUID(),
        id: null,
        path: null,
        file,
        preview: URL.createObjectURL(file),
      });
    }
    if (added.length > 0) onChange([...items, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = (i: number) => {
    const item = items[i];
    if (item?.file) URL.revokeObjectURL(item.preview);
    onChange(items.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((it, i) => (
          <div
            key={it.key}
            className="group relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted"
          >
            <img src={it.preview} alt={`صورة ${i + 1}`} className="size-full object-cover" />
            {i === 0 ? (
              <span className="absolute start-1 top-1 rounded bg-brass px-1.5 py-0.5 text-[10px] font-bold text-brass-foreground">
                الرئيسية
              </span>
            ) : null}
            {!disabled ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/60 p-1 text-white opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <div className="flex">
                  <IconButton
                    label="تقديم الصورة"
                    onClick={() => onChange(move(items, i, i - 1))}
                    disabled={i === 0}
                  >
                    <ChevronRight className="size-4" />
                  </IconButton>
                  <IconButton
                    label="تأخير الصورة"
                    onClick={() => onChange(move(items, i, i + 1))}
                    disabled={i === items.length - 1}
                  >
                    <ChevronLeft className="size-4" />
                  </IconButton>
                  {i > 0 ? (
                    <IconButton
                      label="اجعلها الصورة الرئيسية"
                      onClick={() => onChange(move(items, i, 0))}
                    >
                      <Star className="size-4" />
                    </IconButton>
                  ) : null}
                </div>
                <IconButton label="حذف الصورة" onClick={() => remove(i)}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            ) : null}
          </div>
        ))}

        {items.length < MAX_UNIT_PHOTOS && !disabled ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <ImagePlus className="size-6" aria-hidden />
            أضف صورًا
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {items.length} من {MAX_UNIT_PHOTOS} صور — الصورة الأولى هي التي تظهر في سوق العروض.
          تُصغَّر الصور تلقائيًا قبل الرفع.
        </p>
        {items.length === 0 && !disabled ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus className="size-4" />
            اختر الصور
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded hover:bg-white/25 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
