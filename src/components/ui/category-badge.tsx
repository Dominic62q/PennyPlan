"use client";

import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import type { Logo } from "@/lib/ledger/logo";
import { categoryColor, categoryIcon } from "@/lib/ledger/presentation";
import { categoriesQuery } from "@/lib/queries";

const SIZES = {
  sm: { box: "size-8 rounded-full", icon: 16 },
  md: { box: "size-11 rounded-full", icon: 19 },
  lg: { box: "size-14 rounded-full", icon: 23 },
} as const;

// A brand mark inside a tile: a one-colour glyph that takes the tile's colour, or a
// small website icon for brands the glyph set lacks.
function LogoMark({ logo, size }: { logo: Logo; size: number }) {
  if (logo.path) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" role="img" aria-label={logo.title}>
        <path d={logo.path} />
      </svg>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logo.image} alt={logo.title} width={size + 2} height={size + 2} className="rounded-[4px] object-contain" />;
}

// A small tile with the category's icon. Calm by default: a neutral tile and a
// thin grey icon, so lists don't turn into a wall of colour. `tinted` shows the
// category's own colour, for when picking or previewing one. A brand `logo`, when
// there is one, takes the icon's place.
export function IconTile({
  icon: Icon,
  color,
  size = "md",
  tinted = false,
  className = "",
  logo = null,
}: {
  icon: LucideIcon;
  color: string;
  size?: keyof typeof SIZES;
  tinted?: boolean;
  className?: string;
  logo?: Logo | null;
}) {
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center ${s.box} ${tinted ? "" : "bg-surface-2 text-ink-2"} ${className}`}
      style={
        tinted
          ? { background: `color-mix(in srgb, ${color} 16%, transparent)`, color }
          : undefined
      }
    >
      {logo ? <LogoMark logo={logo} size={s.icon} /> : <Icon size={s.icon} strokeWidth={tinted ? 2.2 : 1.8} />}
    </span>
  );
}

export function CategoryBadge({
  id,
  icon,
  color,
  size,
  tinted,
  className,
  logo: given,
}: {
  id: string;
  icon: string | null | undefined;
  color: string | null | undefined;
  size?: keyof typeof SIZES;
  tinted?: boolean;
  className?: string;
  // Pass one to show it as it is (a preview); otherwise the category's own is used.
  logo?: Logo | null;
}) {
  // Most places only know the category's id, so its logo is read from the cache.
  const { data: own } = useQuery({
    ...categoriesQuery(),
    select: (all) => all.find((c) => c.id === id)?.logo ?? null,
    enabled: given === undefined,
  });
  return (
    <IconTile
      logo={given === undefined ? own : given}
      icon={categoryIcon(icon)}
      color={categoryColor(color, id)}
      size={size}
      tinted={tinted}
      className={className}
    />
  );
}
