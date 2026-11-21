import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { userErrorMessage } from "@/lib/auth-errors";
import { cn } from "@/lib/utils";

/**
 * تقييم الحجز المنتهي، بالاتجاهين: الضيف يقيّم الوحدة (guest_to_unit) والمكتب يقيّم الضيف
 * (host_to_guest). القاعدة هي من يتحقق من صاحب الحق ومن أن الحجز انتهى (submit_booking_review)،
 * والتقييم مرة واحدة لا يُعدَّل — فالنموذج يقول ذلك قبل الإرسال.
 */
export type ReviewDirection = "guest_to_unit" | "host_to_guest";

const RATING_WORD = ["", "سيئ", "مقبول", "جيد", "جيد جدًا", "ممتاز"] as const;

/** نجوم للعرض فقط. */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={`${value} من 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            "size-4",
            n <= Math.round(value) ? "fill-brass text-brass" : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}

/** تقييم سبق إرساله: النجوم والتعليق. */
export function ReviewShown({
  label,
  rating,
  comment,
}: {
  label: string;
  rating: number;
  comment: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        <Stars value={rating} />
      </div>
      {comment ? (
        <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
          {comment}
        </p>
      ) : null}
    </div>
  );
}

export function ReviewForm({
  bookingId,
  direction,
  onDone,
}: {
  bookingId: string;
  direction: ReviewDirection;
  onDone: () => void | Promise<void>;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const guest = direction === "guest_to_unit";

  const send = useMutation({
    mutationFn: async () => {
      const text = comment.trim();
      const { error } = await supabase.rpc("submit_booking_review", {
        _booking_id: bookingId,
        _direction: direction,
        _rating: rating,
        ...(text ? { _comment: text } : {}),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(guest ? "شكرًا — نُشر تقييمك للوحدة" : "سُجّل تقييمك للضيف");
      await onDone();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال التقييم")),
  });

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-brass bg-brass/5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (rating > 0) send.mutate();
      }}
    >
      <p className="text-sm font-semibold">{guest ? "قيّم إقامتك في الوحدة" : "قيّم الضيف"}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center" role="radiogroup" aria-label="التقييم من 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} من 5 — ${RATING_WORD[n]}`}
              onClick={() => setRating(n)}
              // مساحة لمس مريحة على الجوال: النجمة 28 والزر 40.
              className="flex size-10 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Star
                aria-hidden
                className={cn(
                  "size-7 transition-colors",
                  n <= rating ? "fill-brass text-brass" : "text-muted-foreground/50",
                )}
              />
            </button>
          ))}
        </div>
        {rating > 0 ? <span className="text-sm font-medium">{RATING_WORD[rating]}</span> : null}
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={600}
        rows={3}
        aria-label="تعليق (اختياري)"
        placeholder={
          guest
            ? "ما الذي أعجبك أو لم يعجبك؟ (اختياري)"
            : "كيف كان التزام الضيف بالوحدة وشروطها؟ (اختياري)"
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {guest
            ? "يظهر تقييمك علنًا على صفحة الوحدة باسمك الأول، ولا يُعدَّل بعد الإرسال."
            : "يراه الضيف في حجوزاته ولا يُنشر علنًا، ولا يُعدَّل بعد الإرسال."}
        </p>
        <Button type="submit" size="sm" disabled={rating === 0 || send.isPending}>
          {send.isPending ? "جارٍ الإرسال…" : "أرسل التقييم"}
        </Button>
      </div>
    </form>
  );
}

/**
 * تقييمات حجوزات المكتب (RLS: مكتبه وحده) مفهرسة بالحجز — لشاشة طلبات الحجز: من قيّم ومن لم يقيّم.
 * استعلام مستقل عن استعلام الحجوزات، فخطؤه يُخفي التقييمات ولا يُسقط قائمة الحجوزات.
 */
const OFFICE_REVIEWS_KEY = ["office-booking-reviews"] as const;

type OfficeReview = { rating: number; comment: string | null };
export type OfficeReviews = Map<string, { guest?: OfficeReview; host?: OfficeReview }>;

export function useOfficeReviews(): { reviews: OfficeReviews; loaded: boolean } {
  const query = useQuery({
    queryKey: OFFICE_REVIEWS_KEY,
    queryFn: async (): Promise<OfficeReviews> => {
      const { data, error } = await supabase
        .from("booking_reviews")
        .select("booking_id, direction, rating, comment")
        .limit(1000);
      if (error) throw error;
      const map: OfficeReviews = new Map();
      for (const r of data ?? []) {
        const entry = map.get(r.booking_id) ?? {};
        const review = { rating: r.rating, comment: r.comment };
        if (r.direction === "guest_to_unit") entry.guest = review;
        else if (r.direction === "host_to_guest") entry.host = review;
        map.set(r.booking_id, entry);
      }
      return map;
    },
  });
  return { reviews: query.data ?? new Map(), loaded: query.isSuccess };
}

/** على بطاقة حجز منتهٍ في شاشة المكتب: تقييم الضيف للوحدة إن وُجد، وتقييم المكتب للضيف أو نموذجه. */
export function OfficeBookingReviews({
  bookingId,
  reviews,
}: {
  bookingId: string;
  reviews: OfficeReviews;
}) {
  const queryClient = useQueryClient();
  const entry = reviews.get(bookingId);
  return (
    <div className="flex flex-col gap-2">
      {entry?.guest ? (
        <ReviewShown
          label="تقييم الضيف للوحدة"
          rating={entry.guest.rating}
          comment={entry.guest.comment}
        />
      ) : null}
      {entry?.host ? (
        <ReviewShown label="تقييمك للضيف" rating={entry.host.rating} comment={entry.host.comment} />
      ) : (
        <ReviewForm
          bookingId={bookingId}
          direction="host_to_guest"
          onDone={() => queryClient.invalidateQueries({ queryKey: OFFICE_REVIEWS_KEY })}
        />
      )}
    </div>
  );
}
