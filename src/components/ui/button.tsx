import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Text/icon start from the inline-start edge (the right, in this RTL app) rather than centering
  // — the brand rule for every button with a label. Icon-only buttons re-center below.
  // Focus is a plaster gap + ink ring (never red), so a focused primary doesn't read as "more red".
  "inline-flex items-center justify-start gap-2 whitespace-nowrap rounded-md font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // أحمر جارك — one per screen: the action the screen exists for.
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active disabled:bg-muted disabled:text-subtle-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-muted disabled:text-subtle-foreground",
        outline:
          "border-[1.5px] border-foreground bg-transparent text-foreground hover:bg-muted active:bg-border disabled:opacity-50",
        // Ink — the confident non-primary action (save, confirm in a secondary flow).
        secondary:
          "bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80 disabled:bg-muted disabled:text-subtle-foreground",
        ghost: "text-foreground hover:bg-muted active:bg-border disabled:opacity-50",
        link: "text-foreground underline underline-offset-[5px] hover:text-red-text disabled:opacity-50",
        // Product colour for WhatsApp contact, not a "success" state.
        whatsapp:
          "bg-whatsapp text-whatsapp-foreground hover:bg-whatsapp/90 disabled:bg-muted disabled:text-subtle-foreground",
      },
      size: {
        // 44 is the minimum target; 48 for public pages; 36 only inside dense tables.
        default: "h-11 px-5 text-[15px]",
        sm: "h-9 px-3 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "size-11 justify-center",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
