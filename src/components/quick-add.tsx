"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Delete, Tags, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { CategoryBadge } from "@/components/ui/category-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { dateKeyToIso, localDateKey, todayKey } from "@/lib/dates";
import {
  readLastAccountId,
  rememberAccountId,
  useAccounts,
  useCategories,
} from "@/lib/ledger/hooks";
import { addTransaction, addTransfer, updateTransaction } from "@/lib/ledger/mutations";
import type { Category, LedgerTransaction } from "@/lib/ledger/types";
import { displayAmount, pressKey, type KeypadKey } from "@/lib/keypad";
import { formatMoney, minorToInput, minorUnitDigits, parseMoney } from "@/lib/money";
import { ledgerKeys, transactionQuery } from "@/lib/queries";
import { buttonClass, inputClass } from "@/lib/ui";

type Mode = "expense" | "income" | "transfer";

const MODES: Mode[] = ["expense", "income", "transfer"];
const MODE_LABELS: Record<Mode, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
};

const DIGIT_KEYS: KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

function isMode(value: string | null): value is Mode {
  return value !== null && (MODES as string[]).includes(value);
}

export function QuickAdd() {
  const params = useSearchParams();
  const editId = params.get("edit");
  const typeParam = params.get("type");
  const editing = useQuery({
    ...transactionQuery(editId ?? ""),
    enabled: editId !== null,
  });

  if (editId !== null) {
    if (editing.isPending) {
      return (
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
          <Skeleton className="h-52 !rounded-[2rem]" />
          <Skeleton className="h-40" />
        </div>
      );
    }
    if (!editing.data || editing.data.transferGroupId) {
      return (
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center">
          <EmptyState
            icon={X}
            title={editing.data ? "Transfers can't be edited" : "That entry no longer exists"}
            text={
              editing.data
                ? "Delete it and add a new one instead."
                : "It may have been deleted."
            }
            action={
              <Link href="/transactions" className={buttonClass("secondary", "lg", true)}>
                Back to activity
              </Link>
            }
          />
        </div>
      );
    }
    return <Form key={editId} existing={editing.data} />;
  }
  return <Form initialMode={isMode(typeParam) ? typeParam : "expense"} />;
}

function Form({
  existing,
  initialMode = "expense",
}: {
  existing?: LedgerTransaction;
  initialMode?: Mode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const accountsQ = useAccounts();
  const categoriesQ = useCategories();

  const accounts = useMemo(
    () => (accountsQ.data ?? []).filter((a) => !a.archivedAt || a.id === existing?.accountId),
    [accountsQ.data, existing?.accountId],
  );
  const categories = categoriesQ.data;

  const [mode, setMode] = useState<Mode>(
    existing ? (existing.type === "income" ? "income" : "expense") : initialMode,
  );
  const [raw, setRaw] = useState(
    existing ? minorToInput(existing.amount, existing.currency) : "",
  );
  const [accountChoice, setAccountChoice] = useState(existing?.accountId ?? "");
  const [toChoice, setToChoice] = useState("");
  const [categoryChoice, setCategoryChoice] = useState<string | null>(existing?.categoryId ?? null);
  const [dateKey, setDateKey] = useState(existing ? localDateKey(existing.occurredAt) : todayKey());
  const [payee, setPayee] = useState(existing?.payee ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [fee, setFee] = useState("");
  const [amountIn, setAmountIn] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Defaults come from data that arrives after the first render, so they are
  // derived here instead of copied into state.
  const accountId =
    accountChoice ||
    (accounts.find((a) => a.id === readLastAccountId())?.id ?? accounts[0]?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const toAccountId = toChoice || accounts.find((a) => a.id !== accountId)?.id || "";
  const toAccount = accounts.find((a) => a.id === toAccountId);

  const currency = account?.currency ?? "GHS";
  const digits = minorUnitDigits(currency);
  const crossCurrency =
    mode === "transfer" && !!account && !!toAccount && account.currency !== toAccount.currency;

  const amountMinor = parseMoney(raw === "" ? "0" : raw.replace(/\.$/, ""), currency);
  const canSave =
    !busy &&
    !saved &&
    amountMinor !== null &&
    amountMinor > 0 &&
    !!account &&
    (mode !== "transfer" || (!!toAccount && toAccount.id !== account.id));

  const kind = mode === "income" ? "income" : "expense";
  const tree = useMemo(() => {
    const rows = (categories ?? []).filter((c) => c.kind === kind && !c.archivedAt);
    return {
      parents: rows.filter((c) => c.parentId === null),
      childrenOf: (id: string) => rows.filter((c) => c.parentId === id),
      byId: new Map<string, Category>(rows.map((c) => [c.id, c])),
    };
  }, [categories, kind]);

  const selected = categoryChoice ? tree.byId.get(categoryChoice) : undefined;
  const activeParentId = selected ? (selected.parentId ?? selected.id) : null;
  const subcategories = activeParentId ? tree.childrenOf(activeParentId) : [];

  function changeMode(next: Mode) {
    setMode(next);
    setError(null);
    // Income and expense categories are separate lists.
    if (next !== mode) setCategoryChoice(null);
  }

  async function save() {
    if (!account || amountMinor === null) return;
    setError(null);
    setBusy(true);
    const occurredAt =
      existing && dateKey === localDateKey(existing.occurredAt)
        ? existing.occurredAt
        : dateKeyToIso(dateKey);

    try {
      if (mode === "transfer") {
        if (!toAccount) throw new Error("Choose where the money goes");
        const inMinor = crossCurrency ? parseMoney(amountIn, toAccount.currency) : null;
        if (crossCurrency && !inMinor) throw new Error("Enter the amount received");
        const feeMinor = fee.trim() ? parseMoney(fee, currency) : null;
        if (fee.trim() && !feeMinor) throw new Error("Enter the fee like 1.50");
        const feeCategory = (categories ?? []).find(
          (c) => c.kind === "expense" && c.name === "Mobile money fees" && !c.archivedAt,
        );
        await addTransfer({
          groupId: crypto.randomUUID(),
          fromAccountId: account.id,
          toAccountId: toAccount.id,
          amountOut: amountMinor,
          amountIn: inMinor,
          occurredAt,
          note,
          fee: feeMinor,
          feeCategoryId: feeCategory?.id ?? null,
        });
      } else if (existing) {
        await updateTransaction(existing.id, {
          accountId: account.id,
          currency: account.currency,
          type: mode,
          amount: amountMinor,
          occurredAt,
          categoryId: categoryChoice,
          payee,
          note,
        });
      } else {
        await addTransaction({
          id: crypto.randomUUID(),
          accountId: account.id,
          type: mode,
          amount: amountMinor,
          currency: account.currency,
          occurredAt,
          categoryId: categoryChoice,
          payee,
          note,
        });
      }
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
      return;
    }

    rememberAccountId(account.id);
    await queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
    setBusy(false);
    setSaved(true);
    // Let the checkmark land before returning home.
    window.setTimeout(() => {
      toast.show(
        existing
          ? "Changes saved"
          : `${MODE_LABELS[mode]} saved · ${formatMoney(amountMinor, currency)}`,
      );
      router.replace(existing ? "/transactions" : "/");
    }, 700);
  }

  if (accountsQ.isSuccess && accounts.length === 0) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center">
        <EmptyState
          icon={Wallet}
          title="Add an account first"
          text="Entries are saved to an account, like cash or a bank account."
          action={
            <div className="flex flex-col gap-2">
              <Link href="/accounts" className={buttonClass("primary", "lg", true)}>
                Create an account
              </Link>
              <Link href="/" className={buttonClass("ghost", "md", true)}>
                Cancel
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const shown = displayAmount(raw);
  const amountSize =
    shown.length > 11 ? "text-4xl" : shown.length > 8 ? "text-5xl" : "text-[3.75rem]";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="relative rounded-b-[2rem] bg-gradient-to-br from-[var(--hero-from)] to-[var(--hero-to)] px-4 pb-6 pt-[max(0.75rem,env(safe-area-inset-top))] text-[var(--hero-ink)] shadow-pop">
        <div className="flex min-h-11 items-center justify-between">
          <Link
            href={existing ? "/transactions" : "/"}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-full bg-white/10 transition active:scale-95"
          >
            <X size={20} />
          </Link>
          <h1 className="text-base font-semibold">{existing ? "Edit entry" : "New entry"}</h1>
          <span className="size-11" aria-hidden />
        </div>

        <div className="mt-3">
          <Segmented<Mode>
            label="Entry type"
            tone="dark"
            value={mode}
            onChange={changeMode}
            options={(existing ? MODES.slice(0, 2) : MODES).map((value) => ({
              value,
              label: MODE_LABELS[value],
            }))}
          />
        </div>

        <p
          aria-live="polite"
          aria-label="Amount"
          className="mt-6 flex items-baseline justify-center gap-2 text-center font-semibold tabular-nums"
        >
          <span className="text-xl text-[var(--hero-ink-2)]">{currency}</span>
          <span
            className={`${amountSize} leading-none tracking-tight ${raw === "" ? "text-white/35" : "text-white"}`}
          >
            {shown}
          </span>
        </p>

        {account && (
          <label className="relative mx-auto mt-5 flex min-h-11 w-fit max-w-full items-center gap-2 rounded-full bg-white/10 pl-4 pr-3 text-sm font-medium">
            <span className="text-[var(--hero-ink-2)]">{mode === "transfer" ? "From" : "Account"}</span>
            <span className="truncate font-semibold text-white">{account.name}</span>
            <span className="text-[var(--hero-ink-2)]">· {formatMoney(account.balance, account.currency)}</span>
            <ChevronDown size={16} className="shrink-0 text-[var(--hero-ink-2)]" />
            <select
              aria-label={mode === "transfer" ? "From account" : "Account"}
              value={accountId}
              onChange={(e) => setAccountChoice(e.target.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {formatMoney(a.balance, a.currency)}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-6 px-4 pb-[19rem] pt-6">
        {mode === "transfer" ? (
          <section className="flex flex-col gap-4" aria-label="Transfer details">
            <label className="flex flex-col gap-2 text-sm font-semibold">
              To account
              <select
                value={toAccountId}
                onChange={(e) => setToChoice(e.target.value)}
                className={inputClass}
              >
                {accounts
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {formatMoney(a.balance, a.currency)}
                    </option>
                  ))}
              </select>
            </label>
            {crossCurrency && toAccount && (
              <label className="flex flex-col gap-2 text-sm font-semibold">
                Amount received ({toAccount.currency})
                <input
                  inputMode="decimal"
                  value={amountIn}
                  onChange={(e) => setAmountIn(e.target.value)}
                  className={inputClass}
                />
              </label>
            )}
            <label className="flex flex-col gap-2 text-sm font-semibold">
              Fee <span className="font-normal text-ink-3">(optional)</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className={inputClass}
              />
            </label>
          </section>
        ) : (
          <section aria-label="Category">
            <h2 className="mb-3 text-sm font-semibold text-ink-2">Category</h2>
            {categoriesQ.isSuccess && tree.parents.length === 0 ? (
              <Link
                href="/categories"
                className="flex items-center gap-3 rounded-3xl border border-dashed border-line-strong p-4 transition active:scale-[0.99]"
              >
                <span className="flex size-11 items-center justify-center rounded-2xl bg-gold/20 text-gold-strong">
                  <Tags size={22} />
                </span>
                <span className="flex-1 text-sm">
                  <span className="block font-semibold">Add {kind} categories</span>
                  <span className="block text-ink-2">Or save without one for now.</span>
                </span>
              </Link>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-x-2 gap-y-4">
                  {tree.parents.map((c) => {
                    const active = activeParentId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setCategoryChoice(active && !selected?.parentId ? null : c.id)
                        }
                        className="flex flex-col items-center gap-1.5 rounded-2xl py-1 transition active:scale-95"
                      >
                        <span
                          className={`relative rounded-[1.1rem] p-0.5 transition ${
                            active ? "ring-2 ring-gold ring-offset-2 ring-offset-bg" : ""
                          }`}
                        >
                          <CategoryBadge id={c.id} icon={c.icon} color={c.color} size="lg" />
                          {active && (
                            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-gold text-on-gold">
                              <Check size={12} strokeWidth={3.5} />
                            </span>
                          )}
                        </span>
                        <span className="line-clamp-2 w-full text-center text-xs font-medium leading-tight">
                          {c.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {subcategories.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 rounded-2xl bg-surface-2 p-3">
                    {subcategories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={categoryChoice === c.id}
                        onClick={() =>
                          setCategoryChoice(categoryChoice === c.id ? activeParentId : c.id)
                        }
                        className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${
                          categoryChoice === c.id
                            ? "bg-ink text-bg"
                            : "bg-surface text-ink-2 shadow-card"
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <section
          aria-label="Details"
          className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card"
        >
          <label className="flex min-h-14 items-center justify-between gap-4 border-b border-line px-4">
            <span className="text-sm font-semibold">Date</span>
            <input
              type="date"
              value={dateKey}
              max={todayKey()}
              onChange={(e) => e.target.value && setDateKey(e.target.value)}
              className="min-h-11 bg-transparent text-right text-base text-ink-2 outline-none"
            />
          </label>
          {mode !== "transfer" && (
            <label className="flex min-h-14 items-center justify-between gap-4 border-b border-line px-4">
              <span className="text-sm font-semibold">Payee</span>
              <input
                value={payee}
                maxLength={120}
                autoComplete="off"
                placeholder="Optional"
                onChange={(e) => setPayee(e.target.value)}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-right text-base outline-none placeholder:text-ink-3"
              />
            </label>
          )}
          <label className="flex min-h-14 items-center justify-between gap-4 px-4">
            <span className="text-sm font-semibold">Note</span>
            <input
              value={note}
              maxLength={500}
              autoComplete="off"
              placeholder="Optional"
              onChange={(e) => setNote(e.target.value)}
              className="min-h-11 min-w-0 flex-1 bg-transparent text-right text-base outline-none placeholder:text-ink-3"
            />
          </label>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[var(--nav-bg)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        <div className="mx-auto max-w-md">
          {error && (
            <p
              role="alert"
              className="mb-2 rounded-xl bg-expense-soft px-3 py-2 text-sm font-medium text-expense"
              style={{ animation: "pop-in 0.3s ease both" }}
            >
              {error}
            </p>
          )}
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Amount keypad">
            {DIGIT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRaw((r) => pressKey(r, key, digits))}
                disabled={key === "." && digits === 0}
                aria-label={key === "back" ? "Delete" : key === "." ? "Decimal point" : key}
                className="flex min-h-[3.25rem] items-center justify-center rounded-2xl bg-surface-2 text-2xl font-semibold transition active:scale-95 active:bg-surface-3 disabled:opacity-30"
              >
                {key === "back" ? <Delete size={24} /> : key}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              aria-label={existing ? "Save changes" : "Save"}
              className="col-start-4 row-span-4 row-start-1 flex flex-col items-center justify-center gap-2 rounded-2xl bg-gold text-on-gold shadow-[0_8px_24px_-8px_rgb(244_197_66/0.7)] transition active:scale-95 disabled:opacity-40 disabled:shadow-none"
            >
              {busy ? <Spinner size={26} /> : <Check size={30} strokeWidth={3} />}
              <span className="text-sm font-bold">{busy ? "Saving" : "Save"}</span>
            </button>
          </div>
        </div>
      </div>

      {saved && (
        <div
          aria-hidden
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--hero-to)]/92 backdrop-blur-sm"
          style={{ animation: "fade-in 0.2s ease both" }}
        >
          <span
            className="flex size-28 items-center justify-center rounded-full bg-gold text-on-gold shadow-[0_0_80px_rgb(244_197_66/0.5)]"
            style={{ animation: "pop-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
          >
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1}
                style={{ animation: "draw 0.45s ease-out 0.2s forwards" }}
              />
            </svg>
          </span>
        </div>
      )}
    </div>
  );
}
