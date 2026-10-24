import { CategoryBadge } from "@/components/ui/category-badge";
import { categoryColor } from "@/lib/ledger/presentation";
import { formatMoney } from "@/lib/money";

export type BarItem = {
  id: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  amount: number;
};

// Where the money went: one labelled row per category, bar length against the
// biggest. Every row is named and valued, so colour is never the only cue.
export function CategoryBars({
  items,
  total,
  currency,
  onSelect,
}: {
  items: BarItem[];
  total: number;
  currency: string;
  onSelect?: (item: BarItem) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item, i) => {
        const color = categoryColor(item.color, item.id ?? "uncategorised");
        const share = total > 0 ? Math.round((item.amount / total) * 100) : 0;
        const body = (
          <>
            <CategoryBadge id={item.id ?? "uncategorised"} icon={item.icon} color={item.color} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate font-semibold">{item.name}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatMoney(item.amount, currency)}
                </span>
              </span>
              <span className="mt-1.5 flex items-center gap-2">
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(item.amount / max) * 100}%`,
                      background: color,
                      transformOrigin: "left",
                      animation: `bar-grow 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 60}ms both`,
                    }}
                  />
                </span>
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-3">
                  {share}%
                </span>
              </span>
            </span>
          </>
        );
        return (
          <li key={item.id ?? "uncategorised"}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="flex min-h-11 w-full items-center gap-3 text-left"
              >
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
