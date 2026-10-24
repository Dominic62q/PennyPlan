import type { LucideIcon } from "lucide-react";
import { categoryColor, categoryIcon } from "@/lib/ledger/presentation";

const SIZES = {
  sm: { box: "size-8 rounded-full", icon: 16 },
  md: { box: "size-11 rounded-full", icon: 19 },
  lg: { box: "size-14 rounded-full", icon: 23 },
} as const;

// A small tile with the category's icon. Calm by default: a neutral tile and a
// thin grey icon, so lists don't turn into a wall of colour. `tinted` shows the
// category's own colour, for when picking or previewing one.
export function IconTile({
  icon: Icon,
  color,
  size = "md",
  tinted = false,
  className = "",
}: {
  icon: LucideIcon;
  color: string;
  size?: keyof typeof SIZES;
  tinted?: boolean;
  className?: string;
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
      <Icon size={s.icon} strokeWidth={tinted ? 2.2 : 1.8} />
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
}: {
  id: string;
  icon: string | null | undefined;
  color: string | null | undefined;
  size?: keyof typeof SIZES;
  tinted?: boolean;
  className?: string;
}) {
  return (
    <IconTile
      icon={categoryIcon(icon)}
      color={categoryColor(color, id)}
      size={size}
      tinted={tinted}
      className={className}
    />
  );
}
