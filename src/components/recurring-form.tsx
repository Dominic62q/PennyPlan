"use client";

import { Pause, Play, Trash2, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { todayKey } from "@/lib/dates";
import { useAccounts, useCategories } from "@/lib/ledger/hooks";
import type { RecurringInput } from "@/lib/ledger/schemas";
import {
  type CategoryKind,
  type RecurringFrequency,
  type RecurringRule,
} from "@/lib/ledger/types";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { inputClass } from "@/lib/ui";

const FREQUENCY_OPTIONS: { value: RecurringFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

// How often, within a frequency: [repeat count, wording].
const EVERY: Record<RecurringFrequency, [number, string][]> = {
  weekly: [
    [1, "Every week"],
    [2, "Every 2 weeks"],
  ],
  monthly: [
    [1, "Every month"],
    [2, "Every 2 months"],
    [3, "Every 3 months"],
    [6, "Every 6 months"],
  ],
  yearly: [[1, "Every year"]],
};

type Props = {
  rule?: RecurringRule;
  onSave: (input: RecurringInput) => Promise<boolean>;
  onPause?: () => Promise<void>;
  onRemove?: () => Promise<void>;
};

export function RecurringForm({ rule, onSave, onPause, onRemove }: Props) {
  const accountsQ = useAccounts();
  const categoriesQ = useCategories();
  const accounts = useMemo(
    () => (accountsQ.data ?? []).filter((a) => !a.archivedAt || a.id === rule?.accountId),
    [accountsQ.data, rule?.accountId],
  );

  const [kind, setKind] = useState<CategoryKind>(rule?.kind ?? "expense");
  const [name, setName] = useState(rule?.name ?? "");
  const [amount, setAmount] = useState(rule ? minorToInput(rule.amount, rule.currency) : "");
  const [accountId, setAccountId] = useState(rule?.accountId ?? "");
  const [categoryId, setCategoryId] = useState<string>(rule?.categoryId ?? "");
  const [frequency, setFrequency] = useState<RecurringFrequency>(rule?.frequency ?? "monthly");
  const [every, setEvery] = useState(rule?.repeatEvery ?? 1);
  const [nextDue, setNextDue] = useState(rule?.nextDue ?? todayKey());
  const [endDate, setEndDate] = useState(rule?.endDate ?? "");
  const [autoPost, setAutoPost] = useState(rule?.autoPost ?? kind === "income");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const account = accounts.find((a) => a.id === (accountId || accounts[0]?.id));
  const categories = (categoriesQ.data ?? []).filter(
    (c) => c.kind === kind && (!c.archivedAt || c.id === rule?.categoryId),
  );
  const income = kind === "income";
  const everyOptions = EVERY[frequency];
  const pastDate = nextDue < todayKey();

  function chooseKind(next: CategoryKind) {
    setKind(next);
    setCategoryId("");
    if (!rule) setAutoPost(next === "income");
  }

  function chooseFrequency(next: RecurringFrequency) {
    setFrequency(next);
    if (!EVERY[next].some(([n]) => n === every)) setEvery(1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!account) {
      setError("Add an account first, so we know where it comes from.");
      return;
    }
    const minor = parseMoney(amount, account.currency);
    if (minor === null || minor <= 0) {
      setError("Enter an amount above zero, like 500 or 500.50.");
      return;
    }
    if (name.trim() === "") {
      setError("Give it a name, like Rent or Netflix.");
      return;
    }

    setBusy(true);
    const ok = await onSave({
      id: rule?.id ?? crypto.randomUUID(),
      kind,
      name,
      amount: minor,
      currency: account.currency,
      accountId: account.id,
      categoryId: categoryId || null,
      frequency,
      repeatEvery: every,
      nextDue,
      endDate: endDate || null,
      autoPost,
      // Keeping the same date keeps a month-end schedule on its original day.
      anchorDay: rule && rule.nextDue === nextDue ? rule.anchorDay : undefined,
    });
    setBusy(false);
    if (!ok) setError("Could not save it. Check the details and try again.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-2" noValidate>
      <Segmented
        label="Type"
        value={kind}
        onChange={chooseKind}
        options={[
          { value: "expense", label: "Bill or payment" },
          { value: "income", label: "Income" },
        ]}
      />

      <label className="flex flex-col gap-2 text-sm font-semibold">
        Name
        <input
          value={name}
          maxLength={60}
          autoComplete="off"
          placeholder={income ? "e.g. Salary" : "e.g. Rent, Netflix, ECG"}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-semibold">
        Amount ({account?.currency ?? "GHS"})
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          autoComplete="off"
          onChange={(e) => setAmount(e.target.value)}
          className={`${inputClass} text-xl font-semibold tabular-nums`}
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-semibold">
        {income ? "Paid into" : "Paid from"}
        <select
          value={account?.id ?? ""}
          onChange={(e) => setAccountId(e.target.value)}
          className={inputClass}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {formatMoney(a.balance, a.currency)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2 text-sm font-semibold">
        <span>
          Category <span className="font-normal text-ink-3">(optional)</span>
        </span>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={inputClass}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-semibold">Repeats</legend>
        <Segmented
          label="How often"
          value={frequency}
          onChange={chooseFrequency}
          options={FREQUENCY_OPTIONS}
        />
        {everyOptions.length > 1 && (
          <select
            aria-label="Every"
            value={every}
            onChange={(e) => setEvery(Number(e.target.value))}
            className={inputClass}
          >
            {everyOptions.map(([n, label]) => (
              <option key={n} value={n}>
                {label}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      <section
        aria-label="Dates"
        className="overflow-hidden rounded-[1.75rem] bg-surface"
      >
        <label className="flex min-h-14 items-center justify-between gap-4 border-b border-line px-4">
          <span className="text-sm font-semibold">{rule ? "Next due" : "First due"}</span>
          <input
            type="date"
            value={nextDue}
            onChange={(e) => e.target.value && setNextDue(e.target.value)}
            className="min-h-11 bg-transparent text-right text-base text-ink-2 outline-none"
          />
        </label>
        <div className="flex min-h-14 items-center justify-between gap-3 px-4">
          <label htmlFor="rule-end" className="text-sm font-semibold">
            Ends <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <span className="flex items-center gap-1">
            <input
              id="rule-end"
              type="date"
              value={endDate}
              min={nextDue}
              onChange={(e) => setEndDate(e.target.value)}
              className="min-h-11 bg-transparent text-right text-base text-ink-2 outline-none"
            />
            {endDate && (
              <button
                type="button"
                aria-label="Clear end date"
                onClick={() => setEndDate("")}
                className="flex size-11 items-center justify-center rounded-full text-ink-3 active:bg-surface-2"
              >
                <X size={18} />
              </button>
            )}
          </span>
        </div>
      </section>

      <div className="flex items-center gap-4 rounded-3xl bg-surface-2 p-4">
        <span className="min-w-0 flex-1">
          <span id="auto-label" className="block font-semibold">
            Add it automatically
          </span>
          <span className="block text-sm text-ink-2">
            {autoPost
              ? pastDate
                ? "Dates already past are filled in for you."
                : `Recorded on the due date. Nothing to tap.`
              : income
                ? "You'll get a Received button when it's due."
                : "You'll get a Paid button when it's due."}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={autoPost}
          aria-labelledby="auto-label"
          onClick={() => setAutoPost((v) => !v)}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
            autoPost ? "bg-gold" : "bg-surface-3"
          }`}
        >
          <span
            className={`absolute left-1 top-1 size-6 rounded-full bg-white shadow transition-transform ${
              autoPost ? "translate-x-6" : ""
            }`}
          />
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl bg-expense-soft px-4 py-3 text-sm font-medium text-expense">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" full loading={busy}>
        {rule ? "Save changes" : "Add"}
      </Button>

      {rule && onPause && (
        <Button
          variant="secondary"
          size="lg"
          full
          icon={rule.paused ? <Play size={18} /> : <Pause size={18} />}
          onClick={() => void onPause()}
        >
          {rule.paused ? "Resume" : "Pause for now"}
        </Button>
      )}
      {rule && onRemove && (
        <Button
          variant="danger"
          size="lg"
          full
          icon={<Trash2 size={18} />}
          onClick={() => void onRemove()}
        >
          Stop and remove
        </Button>
      )}
      {rule && (
        <p className="text-center text-xs text-ink-3">
          Entries already recorded stay in your history.
        </p>
      )}
    </form>
  );
}
