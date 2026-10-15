import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[88px] w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-base placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-subtle-foreground aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive md:text-[15px]",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
