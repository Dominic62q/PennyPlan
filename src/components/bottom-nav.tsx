"use client";

import { ChartColumn, House, ListFilter, Plus, Target } from "lucide-react";
import * as m from "motion/react-m";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Home", icon: House, match: (p: string) => p === "/" },
  {
    href: "/transactions",
    label: "Activity",
    icon: ListFilter,
    match: (p: string) => p.startsWith("/transactions"),
  },
  { href: "/add", label: "Add", icon: Plus, match: () => false },
  {
    href: "/budgets",
    label: "Budgets",
    icon: Target,
    match: (p: string) => p.startsWith("/budgets"),
  },
  {
    href: "/reports",
    label: "Reports",
    icon: ChartColumn,
    match: (p: string) => p.startsWith("/reports"),
  },
] as const;

// A floating pill, padded for the iPhone home indicator. The middle button is
// the one thing people do most, so it is raised and gold.
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <ul className="pointer-events-auto mx-auto grid h-16 max-w-md grid-cols-5 items-center rounded-full bg-[var(--nav-bg)] px-2 shadow-pop ring-1 ring-line backdrop-blur-xl">
        {ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;

          if (item.label === "Add") {
            return (
              <li key={item.href} className="flex justify-center">
                <Link
                  href={item.href}
                  aria-label="Add entry"
                  data-tour="add"
                  className="-mt-5 flex size-14 items-center justify-center rounded-full bg-gold text-on-gold ring-[5px] ring-bg transition active:scale-90"
                >
                  <Plus size={26} strokeWidth={2.4} />
                </Link>
              </li>
            );
          }

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-0.5 text-[0.675rem] font-medium transition-colors ${
                  active ? "text-ink" : "text-ink-3"
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                {item.label}
                {active && (
                  <m.span
                    layoutId="nav-pill"
                    transition={{ type: "spring", stiffness: 500, damping: 36 }}
                    className="absolute inset-x-0.5 inset-y-2 -z-10 rounded-full bg-surface-3"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
