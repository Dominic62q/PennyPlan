"use client";

import { CalendarClock, Check, Clock, Repeat, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/category-badge";
import { Money } from "@/components/ui/money";
import { Sheet } from "@/components/ui/sheet";
import { useCategoryLookup } from "@/lib/ledger/hooks";
import { payRecurring, skipRecurring } from "@/lib/ledger/mutations";
import { categoryColor, categoryIcon } from "@/lib/ledger/presentation";
import { dueStatus, scheduleLabel, type DueTone } from "@/lib/ledger/recurring";
import type { RecurringRule } from "@/lib/ledger/types";
import { useLedgerAction } from "@/lib/ledger/use-action";
import { minorToInput, parseMoney } from "@/lib/money";
import { inputClass } from "@/lib/ui";

const TONE: Record<DueTone, { text: string; icon: typeof Clock }> = {
  overdue: { text: "text-expense", icon: TriangleAlert },
  today: { text: "text-warning", icon: Clock },
  soon: { text: "text-ink-2", icon: CalendarClock },
  later: { text: "text-ink-3", icon: CalendarClock },
};

// The tile for a rule: its category's icon, or a sensible default.
function useRuleTile(rule: RecurringRule) {
  const { byId } = useCategoryLookup();
  const category = rule.categoryId ? byId.get(rule.categoryId) : undefined;
  return {
    icon: categoryIcon(category?.icon ?? (rule.kind === "income" ? "briefcase" : "receipt")),
    color: categoryColor(
      category?.color ?? (rule.kind === "income" ? "#0ca678" : "#7048e8"),
      rule.categoryId ?? rule.id,
    ),
    categoryName: category?.name ?? null,
  };
}

function DueLine({ nextDue }: { nextDue: string }) {
  const { tone, label } = dueStatus(nextDue);
  const { text, icon: Icon } = TONE[tone];
  return (
    <span className={`flex items-center gap-1.5 text-sm font-medium ${text}`}>
      <Icon size={14} className="shrink-0" />
      {label}
    </span>
  );
}

export function AutoChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[0.7rem] font-semibold text-ink-2">
      <Repeat size={11} /> Auto
    </span>
  );
}

// One scheduled item that is not due yet. Tapping opens it for editing.
export function UpcomingRow({
  rule,
  onOpen,
}: {
  rule: RecurringRule;
  onOpen?: () => void;
}) {
  const tile = useRuleTile(rule);
  const body = (
    <>
      <IconTile icon={tile.icon} color={tile.color} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{rule.name}</span>
          {rule.autoPost && <AutoChip />}
        </span>
        <span className="block text-sm text-ink-2">{scheduleLabel(rule)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <Money
          minor={rule.amount}
          currency={rule.currency}
          size="md"
          signed={rule.kind === "income"}
          className={rule.kind === "income" ? "text-income" : ""}
        />
        <DueLine nextDue={rule.nextDue} />
      </span>
    </>
  );
  const cls = "flex w-full items-center gap-3 p-4 text-left";
  return onOpen ? (
    <button type="button" onClick={onOpen} className={`${cls} transition active:bg-surface-2`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// An item that has fallen due and is waiting for a tap.
export function DueCard({
  rule,
  onOpen,
}: {
  rule: RecurringRule;
  onOpen?: () => void;
}) {
  const run = useLedgerAction();
  const tile = useRuleTile(rule);
  const [busy, setBusy] = useState<"pay" | "skip" | null>(null);
  const [other, setOther] = useState(false);
  const income = rule.kind === "income";
  const { tone } = dueStatus(rule.nextDue);

  async function act(kind: "pay" | "skip") {
    setBusy(kind);
    await run(
      () =>
        kind === "pay"
          ? payRecurring(rule.id, rule.nextDue)
          : skipRecurring(rule.id, rule.nextDue),
      kind === "pay" ? (income ? "Marked as received" : "Marked as paid") : "Skipped this one",
    );
    setBusy(null);
  }

  return (
    <div
      className={`overflow-hidden rounded-[1.75rem] ${
        tone === "overdue" ? "bg-expense-soft" : "bg-surface"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex w-full items-center gap-3 p-4 pb-3 text-left"
      >
        <IconTile icon={tile.icon} color={tile.color} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{rule.name}</span>
          <DueLine nextDue={rule.nextDue} />
        </span>
        <Money
          minor={rule.amount}
          currency={rule.currency}
          size="lg"
          signed={income}
          className={income ? "text-income" : ""}
        />
      </button>
      <div className="flex items-center gap-2 px-4 pb-4">
        <Button
          size="sm"
          className="flex-1"
          icon={<Check size={18} strokeWidth={2.6} />}
          loading={busy === "pay"}
          disabled={busy !== null}
          onClick={() => void act("pay")}
        >
          {income ? "Received" : "Paid"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="whitespace-nowrap"
          disabled={busy !== null}
          onClick={() => setOther(true)}
        >
          Other amount
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={busy === "skip"}
          disabled={busy !== null}
          onClick={() => void act("skip")}
        >
          Skip
        </Button>
      </div>

      <Sheet open={other} onClose={() => setOther(false)} title={income ? "Amount received" : "Amount paid"}>
        {other && (
          <AmountForm
            rule={rule}
            onSubmit={async (minor) => {
              const ok = await run(
                () => payRecurring(rule.id, rule.nextDue, minor),
                income ? "Marked as received" : "Marked as paid",
              );
              if (ok) setOther(false);
              return ok;
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function AmountForm({
  rule,
  onSubmit,
}: {
  rule: RecurringRule;
  onSubmit: (minor: number) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState(minorToInput(rule.amount, rule.currency));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const minor = parseMoney(amount, rule.currency);
    if (minor === null || minor <= 0) {
      setError("Enter an amount above zero, like 180 or 180.50.");
      return;
    }
    setBusy(true);
    const ok = await onSubmit(minor);
    setBusy(false);
    if (!ok) setError("Could not save it. Try again.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-2" noValidate>
      <p className="text-sm text-ink-2">
        {rule.name} is usually the amount below. Change it if this time was different, like a
        bill that varies.
      </p>
      <label className="flex flex-col gap-2 text-sm font-semibold">
        Amount ({rule.currency})
        <input
          inputMode="decimal"
          value={amount}
          autoComplete="off"
          onChange={(e) => setAmount(e.target.value)}
          className={`${inputClass} text-xl font-semibold tabular-nums`}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-2xl bg-expense-soft px-4 py-3 text-sm font-medium text-expense">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" full loading={busy}>
        {rule.kind === "income" ? "Mark as received" : "Mark as paid"}
      </Button>
    </form>
  );
}
