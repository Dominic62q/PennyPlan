import { Check, TriangleAlert } from "lucide-react";
import { CategoryBadge } from "@/components/ui/category-badge";
import { Meter } from "@/components/ui/meter";
import { budgetStatus } from "@/lib/ledger/reports";
import { formatMoney } from "@/lib/money";

// One budget: name, spent of limit, a meter and a plain-words status. The
// status always carries an icon and text, never colour alone.
export function BudgetRow({
  id,
  name,
  icon,
  color,
  spent,
  amount,
  currency,
  onClick,
}: {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  spent: number;
  amount: number;
  currency: string;
  onClick?: () => void;
}) {
  const ratio = amount > 0 ? spent / amount : 0;
  const status = budgetStatus(spent, amount);
  const left = amount - spent;

  const statusText =
    status === "over"
      ? `Over by ${formatMoney(-left, currency)}`
      : `${formatMoney(left, currency)} left`;
  const StatusIcon = status === "ok" ? Check : TriangleAlert;
  const statusTone =
    status === "over" ? "text-expense" : status === "warn" ? "text-warning" : "text-income";

  const body = (
    <>
      <CategoryBadge id={id} icon={icon} color={color} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate font-semibold">{name}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {formatMoney(spent, currency)}
          </span>
        </span>
        <Meter ratio={ratio} label={`${name} budget`} className="mt-2" />
        <span className="mt-1.5 flex items-center justify-between gap-3 text-xs">
          <span className={`flex items-center gap-1 font-medium ${statusTone}`}>
            <StatusIcon size={13} strokeWidth={2.6} />
            {statusText}
          </span>
          <span className="shrink-0 tabular-nums text-ink-3">
            of {formatMoney(amount, currency)}
          </span>
        </span>
      </span>
    </>
  );

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-3 text-left"
    >
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3">{body}</div>
  );
}
