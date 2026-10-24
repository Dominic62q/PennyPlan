"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, CircleDollarSign, PencilLine, Plus, Target, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { BudgetRow } from "@/components/budget-row";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { CategoryBadge, IconTile } from "@/components/ui/category-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MonthSwitcher } from "@/components/ui/month-switcher";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Ring } from "@/components/ui/ring";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { currentMonthKey } from "@/lib/dates";
import { useCategories } from "@/lib/ledger/hooks";
import { removeBudget, saveBudget } from "@/lib/ledger/mutations";
import { categoryIcon } from "@/lib/ledger/presentation";
import {
  budgetStatus,
  daysLeftInMonth,
  projectMonthEnd,
  type BudgetProgress,
} from "@/lib/ledger/reports";
import type { Category } from "@/lib/ledger/types";
import { useLedgerAction } from "@/lib/ledger/use-action";
import { DEFAULT_CURRENCY, formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { budgetsQuery } from "@/lib/queries";
import { inputClass } from "@/lib/ui";

type Editing = { kind: "new" } | { kind: "edit"; budget: BudgetProgress };

export function BudgetsScreen() {
  const run = useLedgerAction();
  const [month, setMonth] = useState(currentMonthKey);
  const [editing, setEditing] = useState<Editing | null>(null);
  const budgets = useQuery(budgetsQuery(month));
  const categories = useCategories();

  const byId = useMemo(
    () => new Map<string, Category>((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  );

  const rows = useMemo(() => budgets.data ?? [], [budgets.data]);
  const overall = rows.find((b) => b.categoryId === null);
  const perCategory = rows
    .filter((b) => b.categoryId !== null)
    .sort((a, b) => b.spent / b.amount - a.spent / a.amount);

  const pickable = useMemo(() => {
    const taken = new Set(rows.map((b) => b.categoryId));
    return (categories.data ?? []).filter(
      (c) => c.kind === "expense" && !c.archivedAt && !taken.has(c.id),
    );
  }, [categories.data, rows]);

  const currency = rows[0]?.currency ?? DEFAULT_CURRENCY;

  return (
    <>
      <PageHeader
        title="Budgets"
        subtitle="Your monthly limits"
        action={
          <Button size="sm" icon={<Plus size={18} />} onClick={() => setEditing({ kind: "new" })}>
            Add
          </Button>
        }
      />

      <div className="enter" style={{ "--i": 1 } as React.CSSProperties}>
        <MonthSwitcher month={month} onChange={setMonth} />
      </div>

      <QueryState
        isPending={budgets.isPending}
        error={budgets.error}
        retry={() => void budgets.refetch()}
        skeleton={<Skeleton className="h-64 !rounded-3xl" />}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No budgets yet"
            text="Set a limit for the whole month, or for the things you spend on most, and watch it fill as you go."
            action={
              <Button
                full
                size="lg"
                icon={<Plus size={20} />}
                onClick={() => setEditing({ kind: "new" })}
              >
                Set a budget
              </Button>
            }
          />
        ) : (
          <>
            {overall ? (
              <OverallCard
                budget={overall}
                month={month}
                onEdit={() => setEditing({ kind: "edit", budget: overall })}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing({ kind: "new" })}
                className="enter flex items-center gap-4 rounded-[1.75rem] bg-surface p-5 text-left transition active:scale-[0.99]"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gold/20 text-gold-strong">
                  <CircleDollarSign size={24} />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold">Set a limit for the whole month</span>
                  <span className="block text-sm text-ink-2">
                    One number covering everything you spend.
                  </span>
                </span>
              </button>
            )}

            {perCategory.length > 0 && (
              <section aria-label="Category budgets">
                <h2 className="mb-3 px-1 text-lg font-bold tracking-tight">By category</h2>
                <ul className="flex flex-col gap-5 rounded-[1.75rem] bg-surface p-5 shadow-card">
                  {perCategory.map((b, i) => {
                    const c = b.categoryId ? byId.get(b.categoryId) : undefined;
                    return (
                      <li
                        key={b.id}
                        className="enter"
                        style={{ "--i": i + 2 } as React.CSSProperties}
                      >
                        <BudgetRow
                          id={b.categoryId ?? b.id}
                          name={c?.name ?? "Category"}
                          icon={c?.icon ?? null}
                          color={c?.color ?? null}
                          spent={b.spent}
                          amount={b.amount}
                          currency={b.currency}
                          onClick={() => setEditing({ kind: "edit", budget: b })}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </QueryState>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.kind === "edit" ? "Edit budget" : "New budget"}
      >
        {editing && (
          <BudgetForm
            key={editing.kind === "edit" ? editing.budget.id : "new"}
            budget={editing.kind === "edit" ? editing.budget : undefined}
            category={
              editing.kind === "edit" && editing.budget.categoryId
                ? byId.get(editing.budget.categoryId)
                : undefined
            }
            options={pickable}
            canPickOverall={!overall}
            currency={currency}
            onSave={async (categoryId, amount) => {
              const ok = await run(() => saveBudget({ categoryId, amount }), "Budget saved");
              if (ok) setEditing(null);
              return ok;
            }}
            onRemove={
              editing.kind === "edit"
                ? async () => {
                    const id = editing.budget.id;
                    if (await run(() => removeBudget(id), "Budget removed")) setEditing(null);
                  }
                : undefined
            }
          />
        )}
      </Sheet>
    </>
  );
}

function OverallCard({
  budget,
  month,
  onEdit,
}: {
  budget: BudgetProgress;
  month: string;
  onEdit: () => void;
}) {
  const { spent, amount, currency } = budget;
  const ratio = amount > 0 ? spent / amount : 0;
  const left = amount - spent;
  const status = budgetStatus(spent, amount);
  const current = month === currentMonthKey();
  const daysLeft = daysLeftInMonth(month);
  const projected = projectMonthEnd(spent, month);

  let tone: "good" | "bad" = "good";
  let message: string;
  if (status === "over") {
    tone = "bad";
    message = `Over budget by ${formatMoney(-left, currency)}.`;
  } else if (!current) {
    message = `Finished ${formatMoney(left, currency)} under budget.`;
  } else if (projected > amount) {
    tone = "bad";
    message = `At this pace you'll spend ${formatMoney(projected, currency)}, which is ${formatMoney(projected - amount, currency)} over.`;
  } else if (daysLeft > 0) {
    message = `On track. You can spend about ${formatMoney(Math.floor(left / daysLeft), currency)} a day for ${daysLeft} more ${daysLeft === 1 ? "day" : "days"}.`;
  } else {
    message = `${formatMoney(left, currency)} left.`;
  }

  return (
    <section
      aria-label="Overall budget"
      className="enter rounded-[1.75rem] bg-surface p-5 shadow-card"
      style={{ "--i": 2 } as React.CSSProperties}
    >
      <div className="flex items-center gap-5">
        <Ring ratio={ratio} size={128} thickness={12} label="Overall monthly budget used">
          <span className="text-3xl font-bold tabular-nums">{Math.round(ratio * 100)}%</span>
          <span className="text-xs text-ink-3">used</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-2">{left >= 0 ? "Left this month" : "Over by"}</p>
          <Money
            minor={Math.abs(left)}
            currency={currency}
            size="xl"
            animated
            className={status === "over" ? "text-expense" : ""}
          />
          <p className="mt-2 text-sm text-ink-3">
            Spent {formatMoney(spent, currency)} of {formatMoney(amount, currency)}
          </p>
        </div>
      </div>

      <p
        className={`mt-5 flex items-start gap-2.5 rounded-2xl p-3.5 text-sm font-medium ${
          tone === "bad" ? "bg-expense-soft text-expense" : "bg-surface-2 text-ink"
        }`}
      >
        {tone === "bad" ? (
          <TriangleAlert size={18} className="mt-0.5 shrink-0" />
        ) : (
          <Check size={18} className="mt-0.5 shrink-0 text-income" strokeWidth={2.6} />
        )}
        {message}
      </p>

      <Button variant="ghost" full className="mt-2" icon={<PencilLine size={16} />} onClick={onEdit}>
        Change limit
      </Button>
    </section>
  );
}

function BudgetForm({
  budget,
  category,
  options,
  canPickOverall,
  currency,
  onSave,
  onRemove,
}: {
  budget?: BudgetProgress;
  category?: Category;
  options: Category[];
  canPickOverall: boolean;
  currency: string;
  onSave: (categoryId: string | null, amount: number) => Promise<boolean>;
  onRemove?: () => Promise<void>;
}) {
  const editing = budget !== undefined;
  const [target, setTarget] = useState<string | null | undefined>(
    editing ? budget.categoryId : canPickOverall ? null : undefined,
  );
  const [amount, setAmount] = useState(budget ? minorToInput(budget.amount, currency) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (target === undefined) {
      setError("Choose what this budget is for.");
      return;
    }
    const minor = parseMoney(amount, currency);
    if (minor === null || minor <= 0) {
      setError("Enter an amount above zero, like 500 or 500.50.");
      return;
    }
    setBusy(true);
    const ok = await onSave(target, minor);
    setBusy(false);
    if (!ok) setError("Could not save the budget. Try again.");
  }

  const nothingToPick = !editing && !canPickOverall && options.length === 0;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-2" noValidate>
      {editing ? (
        <div className="flex items-center gap-4 rounded-3xl bg-surface-2 p-4">
          {category ? (
            <CategoryBadge id={category.id} icon={category.icon} color={category.color} size="lg" />
          ) : (
            <IconTile icon={categoryIcon("wallet")} color="#f08c00" size="lg" />
          )}
          <div className="min-w-0">
            <p className="text-sm text-ink-2">Monthly limit for</p>
            <p className="truncate text-lg font-semibold">
              {budget.categoryId === null ? "Everything" : (category?.name ?? "Category")}
            </p>
          </div>
        </div>
      ) : nothingToPick ? (
        <p className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
          Everything already has a budget. Change one from the list, or add a spending category
          first.
        </p>
      ) : (
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">What is it for?</legend>
          <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
            {canPickOverall && (
              <TargetChip
                selected={target === null}
                onSelect={() => setTarget(null)}
                label="Whole month"
                icon={<IconTile icon={categoryIcon("wallet")} color="#f08c00" size="sm" />}
              />
            )}
            {options.map((c) => (
              <TargetChip
                key={c.id}
                selected={target === c.id}
                onSelect={() => setTarget(c.id)}
                label={c.name}
                icon={<CategoryBadge id={c.id} icon={c.icon} color={c.color} size="sm" />}
              />
            ))}
          </div>
        </fieldset>
      )}

      {!nothingToPick && (
        <label className="flex flex-col gap-2 text-sm font-semibold">
          Limit per month ({currency})
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            autoComplete="off"
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} text-xl font-semibold tabular-nums`}
          />
        </label>
      )}

      {error && (
        <p role="alert" className="rounded-2xl bg-expense-soft px-4 py-3 text-sm font-medium text-expense">
          {error}
        </p>
      )}

      {!nothingToPick && (
        <Button type="submit" size="lg" full loading={busy}>
          {editing ? "Save changes" : "Set budget"}
        </Button>
      )}

      {onRemove && (
        <Button
          variant="danger"
          size="lg"
          full
          icon={<Trash2 size={18} />}
          onClick={() => void onRemove()}
        >
          Remove budget
        </Button>
      )}
    </form>
  );
}

function TargetChip({
  selected,
  onSelect,
  label,
  icon,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-12 items-center gap-2 rounded-2xl border-2 py-1.5 pl-1.5 pr-3 text-sm font-medium transition active:scale-95 ${
        selected ? "border-gold bg-gold/10" : "border-transparent bg-surface-2"
      }`}
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
    </button>
  );
}
