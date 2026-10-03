import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { HelpCircle, Star } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  rating: "تقييم الموقع",
  suggestion: "اقتراح",
  complaint: "شكوى",
};

/** خانة "المساعدة" — موجودة في كل لوحة تحكم (مكتب/مالك/مستأجر) لتقييم الموقع أو إرسال اقتراح/شكوى. */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("suggestion");
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("submit_feedback", {
        _category: category,
        _message: message.trim(),
        // الدالة تقبل NULL فعليًا، لكن الأنواع المولّدة تفرض number — نمرّر null عند غير "تقييم".
        _rating: (category === "rating" ? rating : null) as unknown as number,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("وصلتنا رسالتك، شكرًا لك");
      setOpen(false);
      setMessage("");
      setRating(0);
      setCategory("suggestion");
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر الإرسال"),
  });

  const canSubmit =
    message.trim().length > 0 && (category !== "rating" || rating > 0) && !submit.isPending;

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        className="justify-start text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
      >
        <HelpCircle className="size-4" />
        المساعدة
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">المساعدة</DialogTitle>
            <DialogDescription>
              قيّم الموقع أو أرسل اقتراحًا أو شكوى — تصل لفريقنا مباشرة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>النوع</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {category === "rating" ? (
              <div className="space-y-1.5">
                <Label>التقييم</Label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`${n} من 5`}
                      onClick={() => setRating(n)}
                    >
                      <Star
                        className={cn(
                          "size-6",
                          n <= rating ? "fill-brass text-brass" : "text-muted-foreground",
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="feedback-message">
                {category === "rating" ? "ملاحظات" : "الرسالة"}
              </Label>
              <Textarea
                id="feedback-message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!canSubmit} onClick={() => submit.mutate()}>
              {submit.isPending ? "جارٍ الإرسال..." : "إرسال"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
