import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          // Ink toast on e2; the state lives in the icon colour (dark-mode semantic tones, since
          // the toast itself is dark), never in a red or green background.
          toast:
            "group toast group-[.toaster]:rounded-none group-[.toaster]:bg-foreground group-[.toaster]:text-background group-[.toaster]:border-transparent group-[.toaster]:shadow-e2 group-[.toaster]:text-[15px] data-[type=success]:[&_[data-icon]]:text-[#4cc28a] data-[type=error]:[&_[data-icon]]:text-[#f0739f] data-[type=warning]:[&_[data-icon]]:text-[#e5a93a] data-[type=info]:[&_[data-icon]]:text-[#74a9e6]",
          description: "group-[.toast]:text-background/75",
          actionButton:
            "group-[.toast]:bg-transparent group-[.toast]:text-background group-[.toast]:font-semibold group-[.toast]:underline group-[.toast]:underline-offset-4",
          cancelButton: "group-[.toast]:bg-transparent group-[.toast]:text-background/75",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
