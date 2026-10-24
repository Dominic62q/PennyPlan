import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// A friendly empty screen: an icon on a soft gold glow, a short line, and one
// clear next step.
export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="enter flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="relative mb-2 flex size-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-gold/20 blur-xl" />
        <span className="relative flex size-20 items-center justify-center rounded-[1.75rem] bg-surface text-gold-strong shadow-card ring-1 ring-line">
          <Icon size={34} strokeWidth={1.8} />
        </span>
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {text && <p className="max-w-xs text-ink-2">{text}</p>}
      {action && <div className="mt-2 w-full max-w-xs">{action}</div>}
    </div>
  );
}
