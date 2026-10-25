"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { DateField } from "@/components/ui/date-picker";
import { SelectField } from "@/components/ui/select-field";
import { reviewEntries } from "@/lib/assistant/review";
import type { NewEntry, Review, ReviewRow } from "@/lib/assistant/types";
import { todayKey } from "@/lib/dates";
import { formatMoney, parseMoney } from "@/lib/money";
import { accountsQuery, categoriesQuery } from "@/lib/queries";

const field =
  "h-10 min-w-0 rounded-xl border border-line bg-bg px-2.5 text-sm text-ink outline-none focus:border-gold";

// What Penny read from a receipt or statement, open for editing. Nothing is saved
// until the person taps Add; once answered it shrinks to a quiet line.
export function ReviewCard({
  review,
  onChange,
  onAccount,
  onConfirm,
  onSkip,
}: {
  review: Review;
  onChange: (next: Review) => void;
  onAccount: (accountId: string) => Promise<void>;
  onConfirm: (entries: NewEntry[]) => Promise<void>;
  onSkip: () => void;
}) {
  const accounts = useQuery(accountsQuery()).data;
  const categories = useQuery(categoriesQuery()).data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticked = review.rows.filter((r) => r.include).length;
  const noun = review.source === "receipt" ? "receipt" : `${ticked} ${ticked === 1 ? "line" : "lines"}`;

  if (review.status !== "pending") {
    return (
      <p className="max-w-[92%] rounded-full border border-line px-3.5 py-1.5 text-sm text-ink-3">
        {review.status === "done" ? `Added ${noun}` : `Skipped ${noun}`}
      </p>
    );
  }

  const account = accounts?.find((a) => a.id === review.accountId);
  const currency = account?.currency ?? "GHS";
  const wrongCurrency = Boolean(review.currency && account && account.currency !== review.currency);

  const patch = (id: string, change: Partial<ReviewRow>) => {
    setError(null);
    onChange({ ...review, rows: review.rows.map((r) => (r.id === id ? { ...r, ...change } : r)) });
  };

  const totalOf = (type: ReviewRow["type"]) =>
    review.rows
      .filter((r) => r.include && r.type === type)
      .reduce((n, r) => n + (parseMoney(r.amount, currency) ?? 0), 0);
  const summary = [
    totalOf("expense") ? `Spending ${formatMoney(totalOf("expense"), currency)}` : null,
    totalOf("income") ? `Income ${formatMoney(totalOf("income"), currency)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  async function add() {
    const result = reviewEntries(review, currency, todayKey());
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setBusy(true);
    try {
      await onConfirm(result.entries);
    } finally {
      setBusy(false);
    }
  }

  async function changeAccount(id: string) {
    setError(null);
    setBusy(true);
    try {
      await onAccount(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't switch account.");
    } finally {
      setBusy(false);
    }
  }

  const openAccounts = accounts?.filter((a) => !a.archivedAt || a.id === review.accountId) ?? [];
  const nameOf = (id: string) => {
    const cat = categories?.find((c) => c.id === id);
    const parent = cat?.parentId ? categories?.find((c) => c.id === cat.parentId) : null;
    return cat ? (parent ? `${parent.name} › ${cat.name}` : cat.name) : "Category";
  };

  return (
    <div className="w-full overflow-hidden rounded-[1.25rem] border border-gold/50 bg-surface-2">
      <div className="px-4 pb-2 pt-3">
        <p className="text-base font-semibold">
          {review.source === "receipt"
            ? "Here's what I read on the receipt"
            : `I found ${review.rows.length} ${review.rows.length === 1 ? "line" : "lines"} in the statement`}
        </p>
        <p className="text-xs text-ink-2">Check it and fix anything. Nothing is saved until you tap Add.</p>
        <label className="mt-2.5 block text-xs font-medium text-ink-2">
          Account
          <SelectField
            title="Account"
            value={review.accountId}
            disabled={busy}
            onChange={changeAccount}
            options={openAccounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
            className={`${field} mt-1 w-full`}
          />
        </label>
        {wrongCurrency && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-expense">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            This looks like {review.currency}, but this account is in {currency}. Pick a {review.currency} account.
          </p>
        )}
        {review.warnings.map((w) => (
          <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-ink-2">
            <AlertTriangle size={14} className="mt-px shrink-0 text-gold-text" />
            {w}
          </p>
        ))}
      </div>

      <ul className="max-h-[22rem] divide-y divide-line overflow-y-auto border-t border-line px-4">
        {review.rows.map((row) => (
          <li key={row.id} className={`space-y-2 py-3 ${row.include ? "" : "opacity-55"}`}>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={row.include}
                onChange={(e) => patch(row.id, { include: e.target.checked })}
                aria-label="Include this line"
                className="size-5 shrink-0 accent-gold"
              />
              <input
                value={row.payee}
                onChange={(e) => patch(row.id, { payee: e.target.value })}
                maxLength={120}
                placeholder="Payee"
                aria-label="Payee"
                className={`${field} flex-1`}
              />
              <input
                value={row.amount}
                onChange={(e) => patch(row.id, { amount: e.target.value })}
                inputMode="decimal"
                aria-label="Amount"
                className={`${field} w-24 text-right tabular-nums`}
              />
            </div>
            <div className="flex items-center gap-2 pl-7">
              <DateField
                title="Date"
                label="Date"
                value={row.date}
                max={todayKey()}
                onChange={(date) => patch(row.id, { date })}
                className={`${field} flex-1 px-2 text-left`}
              />
              <button
                type="button"
                onClick={() => patch(row.id, { type: row.type === "expense" ? "income" : "expense", categoryId: null })}
                className={`h-10 w-24 shrink-0 rounded-xl border text-xs font-semibold transition active:scale-95 ${
                  row.type === "income" ? "border-income/40 bg-income-soft text-income" : "border-line text-ink-2"
                }`}
              >
                {row.type === "income" ? "Income" : "Spending"}
              </button>
            </div>
            <div className="pl-7">
              <SelectField
                title="Category"
                label="Category"
                value={row.categoryId ?? ""}
                onChange={(id) => patch(row.id, { categoryId: id || null })}
                options={[
                  { value: "", label: "No category" },
                  ...(categories
                    ?.filter((c) => c.kind === row.type && (!c.archivedAt || c.id === row.categoryId))
                    .map((c) => ({ value: c.id, label: nameOf(c.id) })) ?? []),
                ]}
                className={`${field} w-full`}
              />
            </div>
            {row.duplicate && (
              <p className="pl-7 text-xs font-medium text-gold-text">Looks like it&apos;s already in this account.</p>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="border-t border-line px-4 py-2 text-sm text-expense">
          {error}
        </p>
      )}
      <div className="border-t border-line p-2.5">
        {summary && <p className="px-1.5 pb-2 text-xs text-ink-2">{summary}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="h-11 flex-1 rounded-full border border-line-strong text-sm font-semibold transition active:scale-[0.97] disabled:opacity-60"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={add}
            disabled={busy || wrongCurrency || ticked === 0}
            className="h-11 flex-1 rounded-full bg-gold text-sm font-semibold text-on-gold transition active:scale-[0.97] disabled:opacity-50"
          >
            {busy ? "Working…" : review.source === "receipt" ? "Add it" : `Add ${ticked}`}
          </button>
        </div>
      </div>
    </div>
  );
}
