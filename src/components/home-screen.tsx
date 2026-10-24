"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronRight,
  Plus,
  Target,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { BudgetRow } from "@/components/budget-row";
import { DueCard, UpcomingRow } from "@/components/bill-items";
import { CategoryBars } from "@/components/category-bars";
import { Greeting } from "@/components/greeting";
import { ProfileButton } from "@/components/profile-sheet";
import { QueryState } from "@/components/query-state";
import { TransactionList } from "@/components/transaction-list";
import { IconTile } from "@/components/ui/category-badge";
import { Money } from "@/components/ui/money";
import { Ring } from "@/components/ui/ring";
import { Skeleton } from "@/components/ui/skeleton";
import { currentMonthKey, monthKeyLabel, todayKey } from "@/lib/dates";
import { useAccounts, useCategoryLookup } from "@/lib/ledger/hooks";
import { ACCOUNT_COLORS, ACCOUNT_ICONS } from "@/lib/ledger/presentation";
import { budgetStatus } from "@/lib/ledger/reports";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { addDaysKey, groupRules } from "@/lib/ledger/recurring";
import { budgetsQuery, monthlyReportQuery, recurringQuery, transactionsQuery } from "@/lib/queries";
import { buttonClass } from "@/lib/ui";

const RECENT = 5;
const SOON_DAYS = 14;
const MAX_COMING_UP = 3;

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
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      {href && (
        <Link
          href={href}
          className="flex min-h-11 items-center gap-0.5 pl-3 text-sm font-semibold text-ink-2"
        >
          {action} <ChevronRight size={16} />
        </Link>
      )}
    </div>
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

  // Everything waiting for a tap, then what falls due in the next two weeks.
  const groups = groupRules(recurring.data ?? []);
  const horizon = addDaysKey(todayKey(), SOON_DAYS);
  const comingUp = [
    ...groups.due,
    ...groups.upcoming.filter((r) => r.nextDue <= horizon),
  ].slice(0, MAX_COMING_UP);

  const active = (accounts.data ?? []).filter((a) => !a.archivedAt);
  const totals = new Map<string, number>();
  for (const a of active) {
    totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balance);
  }
  const [primary, ...others] = [...totals.entries()];
  const currency = primary?.[0] ?? DEFAULT_CURRENCY;

  const overall = budgets.data?.find((b) => b.categoryId === null);
  const categoryBudgets = (budgets.data ?? [])
    .filter((b) => b.categoryId !== null)
    .sort((a, b) => b.spent / b.amount - a.spent / a.amount);

  return (
    <>
      <header className="enter flex items-center justify-between pt-1">
        <div>
          {accounts.isSuccess ? (
            <Greeting className="text-sm text-ink-2" />
          ) : (
            <Skeleton className="h-4 w-24" />
          )}
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">
            Your money
          </h1>
        </div>
        <ProfileButton />
      </header>

      <QueryState
        isPending={accounts.isPending}
        error={accounts.error}
        retry={() => void accounts.refetch()}
        skeleton={<Skeleton className="h-56 !rounded-[2rem]" />}
      >
        {active.length === 0 ? (
          <section
            aria-label="Get started"
            className="enter relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[var(--hero-from)] to-[var(--hero-to)] p-6 text-[var(--hero-ink)] shadow-pop"
          >
            <span className="absolute -right-10 -top-10 size-44 rounded-full bg-gold/20 blur-2xl" />
            <span className="relative flex size-12 items-center justify-center rounded-2xl bg-gold text-on-gold">
              <Wallet size={24} />
            </span>
            <h2 className="relative mt-5 text-2xl font-bold tracking-tight">
              Start with an account
            </h2>
            <p className="relative mt-2 text-[var(--hero-ink-2)]">
              Add where your money lives, like cash, a bank account or mobile money.
              Then record spending and income in seconds.
            </p>
            <Link
              href="/accounts"
              className={`${buttonClass("primary", "lg", true)} relative mt-6`}
            >
              <Plus size={20} /> Add your first account
            </Link>
          </section>
        ) : (
          <section
            aria-label="Total balance"
            className="enter relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[var(--hero-from)] to-[var(--hero-to)] p-6 text-[var(--hero-ink)] shadow-pop"
          >
            <span
              aria-hidden
              className="absolute -right-12 -top-12 size-52 rounded-full bg-gold/20 blur-2xl"
              style={{ animation: "glow-pulse 5s ease-in-out infinite" }}
            />
            <span
              aria-hidden
              className="absolute -bottom-16 -left-10 size-44 rounded-full bg-[#2fd6a1]/15 blur-2xl"
            />
            <p className="relative text-sm font-medium text-[var(--hero-ink-2)]">
              Total balance
            </p>
            <Money
              minor={primary[1]}
              currency={currency}
              size="hero"
              animated
              className="relative mt-2 text-white"
            />
            {others.map(([c, total]) => (
              <p key={c} className="relative mt-1 text-sm text-[var(--hero-ink-2)]">
                + {formatMoney(total, c)}
              </p>
            ))}

            <div className="relative mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/10 p-3.5 backdrop-blur-sm">
                <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--hero-ink-2)]">
                  <span aria-hidden className="size-2 rounded-full bg-[#7ff0c4]" />
                  Income · {monthKeyLabel(month, "short")}
                </p>
                <p className="mt-1.5 text-lg font-semibold tabular-nums text-white">
                  {report.data ? formatMoney(report.data.income, currency) : "—"}
                </p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3.5 backdrop-blur-sm">
                <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--hero-ink-2)]">
                  <span aria-hidden className="size-2 rounded-full bg-gold" />
                  Spent · {monthKeyLabel(month, "short")}
                </p>
                <p className="mt-1.5 text-lg font-semibold tabular-nums text-white">
                  {report.data ? formatMoney(report.data.expense, currency) : "—"}
                </p>
              </div>
            </div>
          </section>
        )}
      </QueryState>

      {active.length > 0 && (
        <>
          <nav
            aria-label="Quick actions"
            className="enter grid grid-cols-3 gap-3"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            {[
              { type: "expense", label: "Expense" },
              { type: "income", label: "Income" },
              { type: "transfer", label: "Transfer" },
            ].map(({ type, label }) => (
              <Link
                key={type}
                href={`/add?type=${type}`}
                className="flex min-h-14 items-center justify-center rounded-2xl border border-line bg-surface text-sm font-semibold shadow-card transition active:scale-95"
              >
                {label}
              </Link>
            ))}
          </nav>

          {active.length > 1 && (
            <section
              aria-label="Accounts"
              className="enter"
              style={{ "--i": 3 } as React.CSSProperties}
            >
              <SectionHeader title="Accounts" href="/accounts" action="Manage" />
              <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {active.map((a) => (
                  <li key={a.id} className="w-[11.5rem] shrink-0 snap-start">
                    <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
                      <IconTile icon={ACCOUNT_ICONS[a.type]} color={ACCOUNT_COLORS[a.type]} />
                      <p className="mt-3 truncate text-sm text-ink-2">{a.name}</p>
                      <Money minor={a.balance} currency={a.currency} size="lg" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

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
                          <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
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
                    className="flex items-center gap-4 rounded-3xl border border-dashed border-line-strong bg-surface p-5 transition active:scale-[0.99]"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gold/20 text-gold-strong">
                      <CalendarClock size={24} />
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
              skeleton={<Skeleton className="h-36 !rounded-3xl" />}
            >
              {overall ? (
                <div className="flex items-center gap-5 rounded-3xl border border-line bg-surface p-5 shadow-card">
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
                <ul className="flex flex-col gap-5 rounded-3xl border border-line bg-surface p-5 shadow-card">
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
                  className="flex items-center gap-4 rounded-3xl border border-dashed border-line-strong bg-surface p-5 transition active:scale-[0.99]"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gold/20 text-gold-strong">
                    <Target size={24} />
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
              <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
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
            empty={
              <div className="rounded-3xl border border-dashed border-line-strong px-6 py-8 text-center">
                <p className="font-semibold">No entries yet</p>
                <p className="mt-1 text-sm text-ink-2">
                  Tap the gold + to record your first one.
                </p>
              </div>
            }
          />
        </QueryState>
      </section>
    </>
  );
}
