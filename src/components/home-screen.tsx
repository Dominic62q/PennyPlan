"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  Sparkles,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { BudgetRow } from "@/components/budget-row";
import { DueCard, UpcomingRow } from "@/components/bill-items";
import { CategoryBars } from "@/components/category-bars";
import { Greeting } from "@/components/greeting";
import { ProfileButton } from "@/components/profile-sheet";
import { QueryState } from "@/components/query-state";
import { TransactionList } from "@/components/transaction-list";
import { Money } from "@/components/ui/money";
import { Ring } from "@/components/ui/ring";
import { Skeleton } from "@/components/ui/skeleton";
import { currentMonthKey, monthKeyLabel, todayKey } from "@/lib/dates";
import { useAccounts, useCategoryLookup } from "@/lib/ledger/hooks";
import { ACCOUNT_COLORS } from "@/lib/ledger/presentation";
import { budgetStatus } from "@/lib/ledger/reports";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { addDaysKey, groupRules } from "@/lib/ledger/recurring";
import { setBalanceHidden, useBalanceHidden } from "@/lib/privacy";
import { budgetsQuery, monthlyReportQuery, recurringQuery, transactionsQuery } from "@/lib/queries";
import { buttonClass } from "@/lib/ui";

const RECENT = 5;
const SOON_DAYS = 14;
const MAX_COMING_UP = 3;
const MASK = "••••••";

function SectionHeader({
  title,
  href,
  action = "See all",
}: {
  title: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between px-1">
      <h2 className="text-[1.15rem] font-bold tracking-tight">{title}</h2>
      {href && (
        <Link
          href={href}
          className="-mr-2 flex min-h-11 items-center gap-0.5 rounded-full pl-3 pr-2 text-sm font-semibold text-gold-text transition active:bg-surface-2"
        >
          {action} <ChevronRight size={16} />
        </Link>
      )}
    </div>
  );
}

type Action = {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
  disabled?: boolean;
};

// The four things people do most, as round buttons within thumb reach.
function Actions({ items }: { items: Action[] }) {
  return (
    <nav
      aria-label="Quick actions"
      className="enter flex justify-between px-2"
      style={{ "--i": 2 } as React.CSSProperties}
    >
      {items.map(({ href, label, icon: Icon, primary, disabled }) => {
        const circle = `flex size-[3.6rem] items-center justify-center rounded-full transition ${
          primary
            ? "bg-gold text-on-gold shadow-[0_8px_24px_-8px_var(--glow)]"
            : "bg-surface-2 text-ink"
        }`;
        const body = (
          <>
            <span className={circle}>
              <Icon size={24} strokeWidth={2} />
            </span>
            <span className="text-xs font-semibold text-ink-2">{label}</span>
          </>
        );
        return disabled ? (
          <span
            key={label}
            aria-disabled
            title="Add a second account to move money"
            className="flex w-[4.5rem] flex-col items-center gap-2 opacity-40"
          >
            {body}
          </span>
        ) : (
          <Link
            key={label}
            href={href}
            className="flex w-[4.5rem] flex-col items-center gap-2 transition active:scale-90"
          >
            {body}
          </Link>
        );
      })}
    </nav>
  );
}

export function HomeScreen() {
  const month = currentMonthKey();
  const accounts = useAccounts();
  const recent = useQuery(transactionsQuery());
  const report = useQuery(monthlyReportQuery(month));
  const budgets = useQuery(budgetsQuery(month));
  const categories = useCategoryLookup();
  const recurring = useQuery(recurringQuery());
  const hidden = useBalanceHidden();

  // Everything waiting for a tap, then what falls due in the next two weeks.
  const groups = groupRules(recurring.data ?? []);
  const horizon = addDaysKey(todayKey(), SOON_DAYS);
  const comingUp = [
    ...groups.due,
    ...groups.upcoming.filter((r) => r.nextDue <= horizon),
  ].slice(0, MAX_COMING_UP);

  // The total is every open account added together. Accounts in different
  // currencies can't be added, so each currency gets its own line.
  const active = (accounts.data ?? []).filter((a) => !a.archivedAt);
  const totals = new Map<string, number>();
  for (const a of active) {
    totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balance);
  }
  const [primary, ...others] = [...totals.entries()];
  const currency = primary?.[0] ?? DEFAULT_CURRENCY;
  const mask = (text: string) => (hidden ? MASK : text);

  const overall = budgets.data?.find((b) => b.categoryId === null);
  const categoryBudgets = (budgets.data ?? [])
    .filter((b) => b.categoryId !== null)
    .sort((a, b) => b.spent / b.amount - a.spent / a.amount);

  return (
    <>
      <header className="enter flex items-center justify-between pt-1">
        {accounts.isSuccess ? (
          <Greeting className="text-[0.95rem] font-medium text-ink-2" />
        ) : (
          <Skeleton className="h-5 w-40 !rounded-full" />
        )}
        <ProfileButton />
      </header>

      <QueryState
        isPending={accounts.isPending}
        error={accounts.error}
        retry={() => void accounts.refetch()}
        skeleton={<Skeleton className="h-44 !rounded-[2rem]" />}
      >
        {active.length === 0 ? (
          <section
            aria-label="Get started"
            className="enter rounded-[2rem] bg-surface p-6"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-gold text-on-gold">
              <Wallet size={26} />
            </span>
            <h2 className="mt-5 text-2xl font-bold tracking-tight">Start with an account</h2>
            <p className="mt-2 text-ink-2">
              Add where your money lives, like cash, a bank account or mobile money. Then record
              spending and income in seconds.
            </p>
            <Link href="/accounts?new=1" className={`${buttonClass("primary", "lg", true)} mt-6`}>
              <Plus size={20} /> Add your first account
            </Link>
          </section>
        ) : (
          <section aria-label="Total balance" className="enter flex flex-col gap-4 pt-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink-2">Total balance</p>
              <div className="flex items-center gap-1.5">
                <Link
                  href="/accounts"
                  className="flex min-h-9 items-center gap-1 rounded-full bg-surface-2 py-1 pl-3.5 pr-2.5 text-xs font-semibold text-ink-2 transition active:scale-95"
                >
                  {active.length} {active.length === 1 ? "account" : "accounts"}
                  <ChevronRight size={14} />
                </Link>
                <button
                  type="button"
                  onClick={() => setBalanceHidden(!hidden)}
                  aria-label={hidden ? "Show balances" : "Hide balances"}
                  aria-pressed={hidden}
                  className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 transition active:scale-90"
                >
                  {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <div>
              {hidden ? (
                <p className="text-[3.4rem] font-semibold leading-none tracking-tighter text-ink-3">
                  {MASK}
                </p>
              ) : (
                <Money minor={primary[1]} currency={currency} size="hero" animated />
              )}
              {others.map(([c, total]) => (
                <p key={c} className="mt-1.5 text-sm text-ink-2">
                  + {mask(formatMoney(total, c))} in {c}
                </p>
              ))}
              {active.length > 1 && (
                <p className="mt-2 text-sm text-ink-3">
                  All {active.length} accounts added together
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-ink-3">
                This month · {monthKeyLabel(month, "short")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-2 rounded-full bg-surface-2 py-2 pl-3 pr-4 text-sm">
                <span aria-hidden className="size-2 rounded-full bg-income" />
                <span className="text-ink-2">In</span>
                <span className="font-semibold tabular-nums">
                  {report.data ? mask(formatMoney(report.data.income, currency)) : "—"}
                </span>
              </span>
              <span className="flex items-center gap-2 rounded-full bg-surface-2 py-2 pl-3 pr-4 text-sm">
                <span aria-hidden className="size-2 rounded-full bg-expense" />
                <span className="text-ink-2">Out</span>
                <span className="font-semibold tabular-nums">
                  {report.data ? mask(formatMoney(report.data.expense, currency)) : "—"}
                </span>
              </span>
              </div>
            </div>
          </section>
        )}
      </QueryState>

      {active.length > 0 && (
        <>
          <Actions
            items={[
              { href: "/add?type=expense", label: "Spend", icon: ArrowUpRight, primary: true },
              { href: "/add?type=income", label: "Receive", icon: ArrowDownLeft },
              {
                href: "/add?type=transfer",
                label: "Move",
                icon: ArrowLeftRight,
                disabled: active.length < 2,
              },
              { href: "/assistant", label: "Ask Penny", icon: Sparkles },
            ]}
          />

          <section
            aria-label="Accounts"
            className="enter"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            <SectionHeader title="Accounts" href="/accounts" />
            <ul className="-mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {active.map((a) => (
                <li key={a.id} className="shrink-0 snap-start">
                  <Link
                    href="/accounts"
                    className="block min-w-[8.5rem] rounded-[1.5rem] bg-surface px-4 py-3.5 transition active:scale-[0.97]"
                  >
                    <span className="flex items-center gap-2 text-sm text-ink-2">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: ACCOUNT_COLORS[a.type] }}
                      />
                      <span className="max-w-[7rem] truncate">{a.name}</span>
                    </span>
                    <span className="mt-1.5 block text-lg font-semibold tabular-nums">
                      {mask(formatMoney(a.balance, a.currency))}
                    </span>
                  </Link>
                </li>
              ))}
              <li className="shrink-0 snap-start">
                <Link
                  href="/accounts?new=1"
                  className="flex h-full min-w-[6.5rem] flex-col items-start justify-center gap-1 rounded-[1.5rem] border border-dashed border-line-strong px-4 py-3.5 text-sm font-semibold text-ink-2 transition active:scale-[0.97]"
                >
                  <Plus size={18} />
                  Add account
                </Link>
              </li>
            </ul>
          </section>

          {recurring.isSuccess && (
            <section
              aria-label="Bills"
              className="enter"
              style={{ "--i": 4 } as React.CSSProperties}
            >
              {comingUp.length > 0 ? (
                <>
                  <SectionHeader title="Coming up" href="/bills" action="All bills" />
                  <ul className="flex flex-col gap-3">
                    {comingUp.map((r) => (
                      <li key={r.id}>
                        {groups.due.includes(r) ? (
                          <DueCard rule={r} />
                        ) : (
                          <div className="overflow-hidden rounded-[1.75rem] bg-surface">
                            <UpcomingRow rule={r} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                recurring.data.length === 0 && (
                  <Link
                    href="/bills"
                    className="flex items-center gap-4 rounded-[1.75rem] bg-surface p-5 transition active:scale-[0.99]"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-text">
                      <CalendarClock size={22} />
                    </span>
                    <span className="flex-1">
                      <span className="block font-semibold">Schedule your bills</span>
                      <span className="block text-sm text-ink-2">
                        Rent, subscriptions and pay, handled every time.
                      </span>
                    </span>
                    <ChevronRight size={18} className="text-ink-3" />
                  </Link>
                )
              )}
            </section>
          )}

          <section
            aria-label="Budget"
            className="enter"
            style={{ "--i": 4 } as React.CSSProperties}
          >
            <SectionHeader title="Budget" href="/budgets" action="Details" />
            <QueryState
              isPending={budgets.isPending}
              error={budgets.error}
              retry={() => void budgets.refetch()}
              skeleton={<Skeleton className="h-36 !rounded-[1.75rem]" />}
            >
              {overall ? (
                <div className="flex items-center gap-5 rounded-[1.75rem] bg-surface p-5">
                  <Ring
                    ratio={overall.spent / overall.amount}
                    size={112}
                    thickness={11}
                    label="Overall monthly budget used"
                  >
                    <span className="text-2xl font-bold tabular-nums">
                      {Math.round((overall.spent / overall.amount) * 100)}%
                    </span>
                    <span className="text-[0.7rem] text-ink-3">used</span>
                  </Ring>
                  <div className="min-w-0">
                    <p className="text-sm text-ink-2">
                      {overall.amount - overall.spent >= 0 ? "Left this month" : "Over by"}
                    </p>
                    <Money
                      minor={Math.abs(overall.amount - overall.spent)}
                      currency={overall.currency}
                      size="lg"
                      className={
                        budgetStatus(overall.spent, overall.amount) === "over"
                          ? "text-expense"
                          : ""
                      }
                    />
                    <p className="mt-1 text-sm text-ink-3">
                      of {formatMoney(overall.amount, overall.currency)}
                    </p>
                  </div>
                </div>
              ) : categoryBudgets.length > 0 ? (
                <ul className="flex flex-col gap-5 rounded-[1.75rem] bg-surface p-5">
                  {categoryBudgets.slice(0, 3).map((b) => {
                    const c = b.categoryId ? categories.byId.get(b.categoryId) : undefined;
                    return (
                      <li key={b.id}>
                        <BudgetRow
                          id={b.categoryId ?? b.id}
                          name={c?.name ?? "Category"}
                          icon={c?.icon ?? null}
                          color={c?.color ?? null}
                          spent={b.spent}
                          amount={b.amount}
                          currency={b.currency}
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Link
                  href="/budgets"
                  className="flex items-center gap-4 rounded-[1.75rem] bg-surface p-5 transition active:scale-[0.99]"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-text">
                    <Target size={22} />
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold">Set a monthly budget</span>
                    <span className="block text-sm text-ink-2">
                      See how much you can still spend, every day.
                    </span>
                  </span>
                  <ChevronRight size={18} className="text-ink-3" />
                </Link>
              )}
            </QueryState>
          </section>

          {report.data && report.data.categories.length > 0 && (
            <section
              aria-label="Spending this month"
              className="enter"
              style={{ "--i": 5 } as React.CSSProperties}
            >
              <SectionHeader title="Spending this month" href="/reports" action="Reports" />
              <div className="rounded-[1.75rem] bg-surface p-5">
                <CategoryBars
                  items={report.data.categories.slice(0, 4).map((c) => ({
                    id: c.category_id,
                    name: c.name,
                    icon: c.icon,
                    color: c.color,
                    amount: c.amount,
                  }))}
                  total={report.data.expense}
                  currency={currency}
                />
              </div>
            </section>
          )}
        </>
      )}

      <section
        aria-label="Recent activity"
        className="enter"
        style={{ "--i": 6 } as React.CSSProperties}
      >
        <SectionHeader title="Recent" href="/transactions" />
        <QueryState
          isPending={recent.isPending}
          error={recent.error}
          retry={() => void recent.refetch()}
        >
          <TransactionList
            transactions={(recent.data ?? []).slice(0, RECENT)}
            grouped={false}
            empty={
              <div className="rounded-[1.75rem] bg-surface px-6 py-8 text-center">
                <p className="font-semibold">No entries yet</p>
                <p className="mt-1 text-sm text-ink-2">
                  Tap Spend or Receive above to record your first one.
                </p>
              </div>
            }
          />
        </QueryState>
      </section>
    </>
  );
}
