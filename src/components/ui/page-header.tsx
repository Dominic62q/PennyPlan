import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="enter flex min-h-12 items-end justify-between gap-3 pt-2">
      <div className="min-w-0">
        <h1 className="truncate text-[1.75rem] font-bold leading-tight tracking-tight">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
