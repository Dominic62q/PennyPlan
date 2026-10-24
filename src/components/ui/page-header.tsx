import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

// `back` is for screens that aren't in the bottom bar (Accounts, Bills,
// Categories), so there is always a clear way out.
export function PageHeader({
  title,
  subtitle,
  action,
  back,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  back?: string;
}) {
  return (
    <header className="enter flex flex-col gap-1 pt-1">
      {back && (
        <Link
          href={back}
          aria-label="Back to Home"
          className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-2 transition active:bg-surface-2"
        >
          <ChevronLeft size={26} />
        </Link>
      )}
      <div className="flex min-h-12 items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[2rem] font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="text-[0.95rem] text-ink-2">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}
