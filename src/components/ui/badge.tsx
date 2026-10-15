import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Status pills: square corners, semantic tint + darker text. Red never marks a status — "default"
// is ink (e.g. مؤجر), and errors/overdue use pomegranate ("destructive").
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background",
        secondary: "border-transparent bg-muted text-muted-foreground",
        destructive: "border-transparent bg-destructive-tint text-destructive-tint-foreground",
        outline: "border-input bg-card text-foreground",
        success: "border-transparent bg-success-tint text-success-tint-foreground",
        warning: "border-transparent bg-warning-tint text-warning-tint-foreground",
        info: "border-transparent bg-info-tint text-info-tint-foreground",
        // Urgent: the one solid semantic fill, for things that need action today.
        urgent: "border-transparent bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
