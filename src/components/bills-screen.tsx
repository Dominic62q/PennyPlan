"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChevronDown, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { DueCard, UpcomingRow } from "@/components/bill-items";
import { QueryState } from "@/components/query-state";
import { RecurringForm } from "@/components/recurring-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/lib/ledger/hooks";
import {
  addRecurring,
  removeRecurring,
  setRecurringPaused,
  updateRecurring,
} from "@/lib/ledger/mutations";
import { groupRules, monthlyEquivalent } from "@/lib/ledger/recurring";
import type { RecurringRule } from "@/lib/ledger/types";
import { useLedgerAction } from "@/lib/ledger/use-action";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { recurringQuery } from "@/lib/queries";

type Editing = { kind: "new" } | { kind: "edit"; rule: RecurringRule };

export function BillsScreen() {
  const run = useLedgerAction();
  const rules = useQuery(recurringQuery());
  const accounts = useAccounts();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const all = useMemo(() => rules.data ?? [], [rules.data]);
  const groups = useMemo(() => groupRules(all), [all]);
  const live = useMemo(() => [...groups.due, ...groups.upcoming], [groups]);
  const hasAccount = (accounts.data ?? []).some((a) => !a.archivedAt);

  const currency = live[0]?.currency ?? DEFAULT_CURRENCY;
  const monthly = useMemo(() => {
    let out = 0;
    let inn = 0;
    for (const r of live) {
      if (r.currency !== currency) continue;
      if (r.kind === "income") inn += monthlyEquivalent(r);
      else out += monthlyEquivalent(r);
    }
    return { out, inn };
  }, [live, currency]);

  const inactive = [...groups.paused, ...groups.ended];

  return (
    <>
      <PageHeader
        title="Bills"
        subtitle="Rent, subscriptions and pay"
        action={
          hasAccount ? (
            <Button size="sm" icon={<Plus size={18} />} onClick={() => setEditing({ kind: "new" })}>
              New
            </Button>
          ) : undefined
        }
      />

      <QueryState
        isPending={rules.isPending || accounts.isPending}
        error={rules.error ?? accounts.error}
        retry={() => {
          void rules.refetch();
          void accounts.refetch();
        }}
        skeleton={<Skeleton className="h-48 !rounded-3xl" />}
      >
        {all.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing scheduled yet"
            text={
              hasAccount
                ? "Add rent, a subscription or your salary once. We'll remind you, or record it for you, every time it comes round."
                : "Add an account first, then come back to schedule rent, subscriptions or your salary."
            }
            action={
              hasAccount ? (
                <Button full size="lg" icon={<Plus size={20} />} onClick={() => setEditing({ kind: "new" })}>
                  Add a bill or income
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {live.length > 0 && (
              <section
                aria-label="Each month"
                className="enter grid grid-cols-2 gap-3"
                style={{ "--i": 1 } as React.CSSProperties}
              >
                <MonthlyTile
                  label="Goes out"
                  sub="about, each month"
                  minor={monthly.out}
                  currency={currency}
                  tone="expense"
                />
                <MonthlyTile
                  label="Comes in"
                  sub="about, each month"
                  minor={monthly.inn}
                  currency={currency}
                  tone="income"
                />
              </section>
            )}

            {groups.due.length > 0 && (
              <section aria-label="Due now">
                <h2 className="mb-3 px-1 text-lg font-bold tracking-tight">Due now</h2>
                <ul className="flex flex-col gap-3">
                  {groups.due.map((r, i) => (
                    <li key={r.id} className="enter" style={{ "--i": i + 2 } as React.CSSProperties}>
                      <DueCard rule={r} onOpen={() => setEditing({ kind: "edit", rule: r })} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {groups.upcoming.length > 0 && (
              <section aria-label="Coming up">
                <h2 className="mb-3 px-1 text-lg font-bold tracking-tight">Coming up</h2>
                <ul className="enter divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
                  {groups.upcoming.map((r) => (
                    <li key={r.id}>
                      <UpcomingRow rule={r} onOpen={() => setEditing({ kind: "edit", rule: r })} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {inactive.length > 0 && (
              <section aria-label="Paused and finished">
                <button
                  type="button"
                  onClick={() => setShowInactive((v) => !v)}
                  aria-expanded={showInactive}
                  className="flex min-h-11 items-center gap-2 px-1 text-sm font-semibold text-ink-2"
                >
                  <ChevronDown
                    size={16}
                    className={`transition-transform ${showInactive ? "rotate-180" : ""}`}
                  />
                  Paused and finished ({inactive.length})
                </button>
                {showInactive && (
                  <ul className="mt-2 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface opacity-80">
                    {inactive.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setEditing({ kind: "edit", rule: r })}
                          className="flex w-full items-center justify-between gap-3 p-4 text-left active:bg-surface-2"
                        >
                          <span className="min-w-0 truncate font-semibold">{r.name}</span>
                          <span className="shrink-0 text-sm text-ink-2">
                            {groups.paused.includes(r) ? "Paused" : "Finished"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </QueryState>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.kind === "edit" ? "Edit" : "New bill or income"}
      >
        {editing && (
          <RecurringForm
            key={editing.kind === "edit" ? editing.rule.id : "new"}
            rule={editing.kind === "edit" ? editing.rule : undefined}
            onSave={async (input) => {
              const ok =
                editing.kind === "edit"
                  ? await run(() => updateRecurring(input), "Saved")
                  : await run(() => addRecurring(input), "Added");
              if (ok) setEditing(null);
              return ok;
            }}
            onPause={
              editing.kind === "edit"
                ? async () => {
                    const { id, paused } = editing.rule;
                    if (
                      await run(
                        () => setRecurringPaused(id, !paused),
                        paused ? "Resumed" : "Paused",
                      )
                    ) {
                      setEditing(null);
                    }
                  }
                : undefined
            }
            onRemove={
              editing.kind === "edit"
                ? async () => {
                    const id = editing.rule.id;
                    if (await run(() => removeRecurring(id), "Removed")) setEditing(null);
                  }
                : undefined
            }
          />
        )}
      </Sheet>
    </>
  );
}

function MonthlyTile({
  label,
  sub,
  minor,
  currency,
  tone,
}: {
  label: string;
  sub: string;
  minor: number;
  currency: string;
  tone: "expense" | "income";
}) {
  const Icon = tone === "income" ? ArrowDownLeft : ArrowUpRight;
  return (
    <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-2">
        <span
          className={`flex size-6 items-center justify-center rounded-full ${
            tone === "income" ? "bg-income-soft text-income" : "bg-expense-soft text-expense"
          }`}
        >
          <Icon size={13} strokeWidth={3} />
        </span>
        {label}
      </p>
      <Money minor={minor} currency={currency} size="lg" className="mt-2" />
      <p className="text-xs text-ink-3">{sub}</p>
    </div>
  );
}
