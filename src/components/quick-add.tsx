"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Delete,
  Pencil,
  Tags,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useToast } from "@/components/toast";
import { CategoryBadge } from "@/components/ui/category-badge";
import { DatePickerSheet } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { dateKeyToIso, dayLabel, localDateKey, todayKey } from "@/lib/dates";
import {
  readLastAccountId,
  rememberAccountId,
  useAccounts,
  useCategories,
} from "@/lib/ledger/hooks";
import { addTransaction, addTransfer, updateTransaction } from "@/lib/ledger/mutations";
import { addDaysKey } from "@/lib/ledger/recurring";
import type { Category, LedgerTransaction } from "@/lib/ledger/types";
import { displayAmount, pressKey, type KeypadKey } from "@/lib/keypad";
import { formatMoney, minorToInput, minorUnitDigits, parseMoney } from "@/lib/money";
import { ledgerKeys, transactionQuery } from "@/lib/queries";
import { buttonClass, inputClass } from "@/lib/ui";

type Mode = "expense" | "income" | "transfer";
type Step = 0 | 1 | 2;

const MODES: Mode[] = ["expense", "income", "transfer"];
const MODE_LABELS: Record<Mode, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
};

// The wording of each step changes with what is being recorded, so every screen
// says plainly what it wants.
const COPY: Record<
  Mode,
  { amountTitle: string; accountLabel: string; summary: string; save: string }
> = {
  expense: {
    amountTitle: "How much did you spend?",
    accountLabel: "Paid from",
    summary: "You spent",
    save: "Save expense",
  },
  income: {
    amountTitle: "How much did you receive?",
    accountLabel: "Paid into",
    summary: "You received",
    save: "Save income",
  },
  transfer: {
    amountTitle: "How much are you moving?",
    accountLabel: "Moving from",
    summary: "You're moving",
    save: "Move money",
  },
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
  // Coming from a shortcut that already says what it is (?type=expense) skips the
  // first question.
  return isMode(typeParam) ? (
    <Form initialMode={typeParam} initialStep={1} />
  ) : (
    <Form initialMode="expense" initialStep={0} />
  );
}

function StepHeader({
  step,
  editing,
  onBack,
  closeHref,
}: {
  step: Step;
  editing: boolean;
  onBack: () => void;
  closeHref: string;
}) {
  const leading =
    step === 0 || editing ? (
      <Link
        href={closeHref}
        aria-label="Close"
        className="flex size-11 items-center justify-center rounded-full transition active:bg-surface-2"
      >
        <X size={22} />
      </Link>
    ) : (
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex size-11 items-center justify-center rounded-full transition active:bg-surface-2"
      >
        <ChevronLeft size={24} />
      </button>
    );

  return (
    <header className="pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="flex min-h-11 items-center justify-between">
        <div className="-ml-2">{leading}</div>
        <h1 className="text-base font-semibold">{editing ? "Edit entry" : "New entry"}</h1>
        <span className="size-11" aria-hidden />
      </div>
      {!editing && (
        <div className="mt-1 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i <= step ? "bg-gold" : "bg-surface-3"
              }`}
            />
          ))}
        </div>
      )}
    </header>
  );
}

function Question({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-5 mt-6">
      <h2 className="text-[1.65rem] font-bold leading-tight tracking-tight">{title}</h2>
      {hint && <p className="mt-1.5 text-[0.95rem] text-ink-2">{hint}</p>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-ink-2">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const MODE_CARDS: Array<{
  mode: Mode;
  title: string;
  hint: string;
  icon: typeof ArrowUpRight;
  tone: string;
}> = [
  {
    mode: "expense",
    title: "I spent money",
    hint: "Food, transport, bills, shopping",
    icon: ArrowUpRight,
    tone: "bg-expense-soft text-expense",
  },
  {
    mode: "income",
    title: "I received money",
    hint: "Salary, gifts, sales, refunds",
    icon: ArrowDownLeft,
    tone: "bg-income-soft text-income",
  },
  {
    mode: "transfer",
    title: "I moved money",
    hint: "Between your own accounts, like bank to mobile money",
    icon: ArrowLeftRight,
    tone: "bg-surface-2 text-ink-2",
  },
];

function Form({
  existing,
  initialMode = "expense",
  initialStep = 2,
}: {
  existing?: LedgerTransaction;
  initialMode?: Mode;
  initialStep?: Step;
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

  const [stepRaw, setStep] = useState<Step>(existing ? 2 : initialStep);
  const [mode, setMode] = useState<Mode>(
    existing ? (existing.type === "income" ? "income" : "expense") : initialMode,
  );
  const [raw, setRaw] = useState(
    existing ? minorToInput(existing.amount, existing.currency) : "",
  );
  const [accountChoice, setAccountChoice] = useState(existing?.accountId ?? "");
  const [accountOpen, setAccountOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
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
  const hasAmount = amountMinor !== null && amountMinor > 0;
  const canMove = accounts.length >= 2;
  // A shortcut can land on "move money" with only one account; send that back to
  // the first question, where the option explains itself.
  const stuck = mode === "transfer" && accountsQ.isSuccess && !canMove;
  const step: Step = stuck ? 0 : stepRaw;
  const canSave =
    !busy &&
    !saved &&
    hasAmount &&
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

  function chooseMode(next: Mode) {
    setError(null);
    // Income and expense categories are separate lists.
    if (next !== mode) setCategoryChoice(null);
    setMode(next);
    setStep(1);
  }

  function goBack() {
    setError(null);
    setStep((s) => (s === 0 ? 0 : ((s - 1) as Step)));
  }

  // A real keyboard works on the amount step too.
  useEffect(() => {
    if (step !== 1) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key) || event.key === ".") {
        setRaw((r) => pressKey(r, event.key as KeypadKey, digits));
      } else if (event.key === "Backspace") {
        setRaw((r) => pressKey(r, "back", digits));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, digits]);

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

  const copy = COPY[mode];
  const shown = displayAmount(raw);
  const amountSize =
    shown.length > 11 ? "text-4xl" : shown.length > 8 ? "text-5xl" : "text-[3.5rem]";
  const amountTone =
    mode === "income" ? "text-income" : mode === "expense" ? "text-ink" : "text-ink";
  const yesterday = addDaysKey(todayKey(), -1);
  const customDate = dateKey !== todayKey() && dateKey !== yesterday;

  // The account picker is one tappable line that opens the app's own list.
  const accountPicker = account && (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setAccountOpen(true)}
        className="flex min-h-16 w-full items-center gap-3 rounded-[1.75rem] bg-surface px-4 text-left shadow-card"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-ink-3">{copy.accountLabel}</span>
          <span className="block truncate font-semibold">{account.name}</span>
        </span>
        <span className="text-sm text-ink-2">{formatMoney(account.balance, account.currency)}</span>
        <ChevronDown size={18} className="shrink-0 text-ink-3" />
      </button>
      <Sheet open={accountOpen} onClose={() => setAccountOpen(false)} title={copy.accountLabel}>
        <ul role="listbox" aria-label={copy.accountLabel} className="flex flex-col gap-1 pb-1">
          {accounts.map((a) => {
            const active = a.id === accountId;
            return (
              <li key={a.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setAccountChoice(a.id);
                    setAccountOpen(false);
                  }}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 py-2 text-left transition active:scale-[0.99] ${
                    active ? "bg-surface-2" : "active:bg-surface-2"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.name}</span>
                    <span className="block text-sm text-ink-2">{formatMoney(a.balance, a.currency)}</span>
                  </span>
                  {active && <Check size={18} strokeWidth={2.6} className="shrink-0 text-gold-text" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
      <StepHeader
        step={step}
        editing={!!existing}
        onBack={goBack}
        closeHref={existing ? "/transactions" : "/"}
      />

      {/* Step 1 of 3: what happened */}
      {step === 0 && (
        <div key="type" style={{ animation: "fade-up 0.4s ease both" }} className="flex flex-1 flex-col">
          <Question title="What would you like to record?" />
          <ul className="flex flex-col gap-3">
            {MODE_CARDS.map(({ mode: value, title, hint, icon: Icon, tone }) => {
              const blocked = value === "transfer" && accountsQ.isSuccess && !canMove;
              return (
                <li key={value}>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => chooseMode(value)}
                    className="flex min-h-24 w-full items-center gap-4 rounded-[1.75rem] bg-surface p-4 text-left shadow-card transition active:scale-[0.98] disabled:opacity-50"
                  >
                    <span className={`flex size-14 shrink-0 items-center justify-center rounded-full ${tone}`}>
                      <Icon size={26} strokeWidth={2} />
                    </span>
                    <span className="flex-1">
                      <span className="block text-lg font-bold leading-tight">{title}</span>
                      <span className="mt-0.5 block text-sm text-ink-2">
                        {blocked ? "You need two accounts to move money" : hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Step 2 of 3: how much */}
      {step === 1 && (
        <div key="amount" style={{ animation: "fade-up 0.4s ease both" }} className="flex flex-1 flex-col">
          <Question title={copy.amountTitle} />

          <p
            aria-live="polite"
            aria-label="Amount"
            className="flex min-h-28 items-baseline justify-center gap-2 rounded-[1.75rem] bg-surface px-4 py-6 text-center font-semibold tabular-nums shadow-card"
          >
            <span className="text-xl text-ink-3">{currency}</span>
            <span
              className={`${amountSize} leading-none tracking-tight ${raw === "" ? "text-ink-3/50" : amountTone}`}
            >
              {shown}
            </span>
          </p>

          <div className="mt-3">{accountPicker}</div>

          <div className="mt-auto pb-[max(1rem,env(safe-area-inset-bottom))] pt-5">
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Amount keypad">
              {DIGIT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRaw((r) => pressKey(r, key, digits))}
                  disabled={key === "." && digits === 0}
                  aria-label={key === "back" ? "Delete" : key === "." ? "Decimal point" : key}
                  className="flex min-h-14 items-center justify-center rounded-full bg-surface-2 text-2xl font-semibold transition active:scale-95 active:bg-surface-3 disabled:opacity-30"
                >
                  {key === "back" ? <Delete size={24} /> : key}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!hasAmount || !account}
              className="mt-3 flex min-h-12 w-full items-center justify-center rounded-full bg-gold text-base font-semibold text-on-gold transition active:scale-[0.98] disabled:opacity-40"
            >
              {hasAmount ? "Continue" : "Enter an amount"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 of 3: the details */}
      {step === 2 && (
        <div
          key="details"
          style={{ animation: "fade-up 0.4s ease both" }}
          className="flex flex-1 flex-col gap-7 pb-32 pt-5"
        >
          <button
            type="button"
            onClick={() => setStep(1)}
            aria-label="Change the amount or account"
            className="flex items-center gap-3 rounded-[1.75rem] bg-gradient-to-br from-[var(--hero-from)] to-[var(--hero-to)] p-4 text-left text-[var(--hero-ink)] shadow-pop transition active:scale-[0.99]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-[var(--hero-ink-2)]">{copy.summary}</span>
              <span className="block truncate text-[2rem] font-bold leading-tight tabular-nums">
                {formatMoney(amountMinor ?? 0, currency)}
              </span>
              {account && (
                <span className="block truncate text-sm text-[var(--hero-ink-2)]">
                  {mode === "income" ? "into" : "from"} {account.name}
                </span>
              )}
            </span>
            <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-semibold">
              <Pencil size={14} aria-hidden="true" />
              Change
            </span>
          </button>

          {mode === "transfer" ? (
            <>
              <Section title="Where is it going?">
                <ul className="flex flex-col gap-2">
                  {accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => {
                      const on = a.id === toAccountId;
                      return (
                        <li key={a.id}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => setToChoice(a.id)}
                            className={`flex min-h-16 w-full items-center gap-3 rounded-3xl border bg-surface px-4 text-left shadow-card transition active:scale-[0.99] ${
                              on ? "border-gold ring-2 ring-gold/60" : "border-line"
                            }`}
                          >
                            <span className="flex-1">
                              <span className="block font-semibold">{a.name}</span>
                              <span className="block text-sm text-ink-2">
                                {formatMoney(a.balance, a.currency)}
                              </span>
                            </span>
                            {on && (
                              <span className="flex size-6 items-center justify-center rounded-full bg-gold text-on-gold">
                                <Check size={14} strokeWidth={3.5} />
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </Section>

              {crossCurrency && toAccount && (
                <Section
                  title={`How much arrives in ${toAccount.name}?`}
                  hint={`These accounts use different currencies, so enter the amount received in ${toAccount.currency}.`}
                >
                  <input
                    inputMode="decimal"
                    aria-label={`Amount received in ${toAccount.currency}`}
                    placeholder="0.00"
                    value={amountIn}
                    onChange={(e) => setAmountIn(e.target.value)}
                    className={inputClass}
                  />
                </Section>
              )}

              <Section title="Any fee?" hint="For example a mobile money charge. Taken from the account you're moving from.">
                <input
                  inputMode="decimal"
                  aria-label="Fee"
                  placeholder="None"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  className={inputClass}
                />
              </Section>
            </>
          ) : (
            <Section
              title={mode === "income" ? "Where did it come from?" : "What was it for?"}
              hint="Pick a category. You can also skip this."
            >
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
                            className={`relative rounded-full p-0.5 transition ${
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
                    <div className="flex flex-wrap gap-2 rounded-2xl bg-surface-2 p-3">
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
            </Section>
          )}

          <Section title="When?">
            <div className="flex flex-wrap gap-2">
              {[
                { key: todayKey(), label: "Today" },
                { key: yesterday, label: "Yesterday" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={dateKey === key}
                  onClick={() => setDateKey(key)}
                  className={`min-h-11 rounded-full px-5 text-sm font-semibold transition ${
                    dateKey === key ? "bg-ink text-bg" : "bg-surface text-ink-2 shadow-card"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setDateOpen(true)}
                className={`min-h-11 rounded-full px-5 text-sm font-semibold transition ${
                  customDate ? "bg-ink text-bg" : "bg-surface text-ink-2 shadow-card"
                }`}
              >
                {customDate ? dayLabel(dateKey) : "Pick a date"}
              </button>
              <DatePickerSheet
                open={dateOpen}
                onClose={() => setDateOpen(false)}
                value={dateKey}
                onChange={setDateKey}
                max={todayKey()}
              />
            </div>
          </Section>

          <Section title="Anything to add?" hint="Optional">
            <div className="flex flex-col gap-3">
              {mode !== "transfer" && (
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  {mode === "income" ? "Who paid you" : "Who you paid"}
                  <input
                    value={payee}
                    maxLength={120}
                    autoComplete="off"
                    placeholder={mode === "income" ? "e.g. Employer" : "e.g. Melcom"}
                    onChange={(e) => setPayee(e.target.value)}
                    className={inputClass}
                  />
                </label>
              )}
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                Note
                <input
                  value={note}
                  maxLength={500}
                  autoComplete="off"
                  placeholder="Anything to remember about it"
                  onChange={(e) => setNote(e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
          </Section>
        </div>
      )}

      {step === 2 && (
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
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gold text-base font-semibold text-on-gold transition active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? <Spinner size={20} /> : <Check size={20} strokeWidth={3} />}
              {busy ? "Saving" : existing ? "Save changes" : copy.save}
            </button>
          </div>
        </div>
      )}

      {saved && (
        <div
          aria-hidden
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--hero-to)]/92 backdrop-blur-sm"
          style={{ animation: "fade-in 0.2s ease both" }}
        >
          <span
            className="flex size-28 items-center justify-center rounded-full bg-gold text-on-gold shadow-[0_0_80px_var(--glow)]"
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
