"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CategoryBars } from "@/components/category-bars";
import { DailyChart, TrendChart } from "@/components/charts";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/ui/empty-state";
import { MonthSwitcher } from "@/components/ui/month-switcher";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { currentMonthKey, dayLabel, monthKeyLabel, shiftMonthKey } from "@/lib/dates";
import { changeRatio, type MonthlyReport } from "@/lib/ledger/reports";
import { formatMoney } from "@/lib/money";
import { monthlyReportQuery } from "@/lib/queries";
import { buttonClass } from "@/lib/ui";

type View = "chart" | "table";

export function ReportsScreen() {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonthKey);
  const query = useQuery(monthlyReportQuery(month));
  const report = query.data;

  const empty =
    report !== undefined &&
    report.count === 0 &&
    report.trend.every((t) => t.income === 0 && t.expense === 0);

  return (
    <>
      <PageHeader title="Reports" subtitle="Where your money went" />

      <div className="enter" style={{ "--i": 1 } as React.CSSProperties}>
        <MonthSwitcher month={month} onChange={setMonth} />
      </div>

      <QueryState
        isPending={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
        skeleton={
          <div className="flex flex-col gap-5">
            <Skeleton className="h-52 !rounded-[2rem]" />
            <Skeleton className="h-64 !rounded-3xl" />
          </div>
        }
      >
        {report &&
          (empty ? (
            <EmptyState
              icon={TrendingUp}
              title="Nothing to report yet"
              text="Reports fill in as you record spending and income."
              action={
                <Link href="/add" className={buttonClass("primary", "lg", true)}>
                  <Plus size={20} /> Add an entry
                </Link>
              }
            />
          ) : (
            <ReportBody
              key={month}
              report={report}
              month={month}
              onCategory={(id) =>
                router.push(
                  id
                    ? `/transactions?category=${id}&month=${month}`
                    : `/transactions?month=${month}`,
                )
              }
            />
          ))}
      </QueryState>
    </>
  );
}

function ReportBody({
  report,
  month,
  onCategory,
}: {
  report: MonthlyReport;
  month: string;
  onCategory: (id: string | null) => void;
}) {
  const { currency } = report;
  const net = report.income - report.expense;
  const prevLabel = monthKeyLabel(shiftMonthKey(month, -1), "short");
  const [trendView, setTrendView] = useState<View>("chart");
  const [dailyView, setDailyView] = useState<View>("chart");

  const spendingDays = report.daily.filter((d) => d.amount > 0).length;
  const today = new Date();
  const elapsed =
    month === currentMonthKey() ? today.getDate() : Math.max(1, report.daily.length);
  const average = Math.round(report.expense / Math.max(1, elapsed));
  const peak = report.daily.reduce<{ day: string; amount: number } | null>(
    (best, d) => (d.amount > (best?.amount ?? 0) ? d : best),
    null,
  );
  const initialDay =
    month === currentMonthKey()
      ? today.getDate() - 1
      : Math.max(0, report.daily.findIndex((d) => d.day === peak?.day));

  return (
    <>
      <section
        aria-label="Month summary"
        className="enter relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[var(--hero-from)] to-[var(--hero-to)] p-6 text-[var(--hero-ink)] shadow-pop"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <span
          aria-hidden
          className="absolute -right-12 -top-12 size-48 rounded-full bg-gold/20 blur-2xl"
        />
        <p className="relative text-sm font-medium text-[var(--hero-ink-2)]">
          {net >= 0 ? "Saved this month" : "Overspent this month"}
        </p>
        <Money
          minor={Math.abs(net)}
          currency={currency}
          size="hero"
          animated
          className="relative mt-2 text-white"
        />
        <div className="relative mt-6 grid grid-cols-2 gap-3">
          <SummaryTile
            label="Income"
            minor={report.income}
            currency={currency}
            dot="bg-[#7ff0c4]"
            change={changeRatio(report.income, report.prev_income)}
            goodWhen="up"
            against={prevLabel}
          />
          <SummaryTile
            label="Spent"
            minor={report.expense}
            currency={currency}
            dot="bg-gold"
            change={changeRatio(report.expense, report.prev_expense)}
            goodWhen="down"
            against={prevLabel}
          />
        </div>
      </section>

      <Card
        title="Last 6 months"
        subtitle="Income and spending"
        view={trendView}
        onView={setTrendView}
        index={3}
      >
        {trendView === "chart" ? (
          <TrendChart data={report.trend} currency={currency} initial={month} />
        ) : (
          <DataTable
            caption="Income and spending by month"
            head={["Month", "Income", "Spent", "Net"]}
            rows={report.trend.map((t) => [
              monthKeyLabel(`${t.month.slice(0, 7)}-01`, "short"),
              formatMoney(t.income, currency),
              formatMoney(t.expense, currency),
              formatMoney(t.income - t.expense, currency),
            ])}
          />
        )}
      </Card>

      {report.expense > 0 && (
        <Card
          title="Daily spending"
          subtitle={
            spendingDays === 0
              ? undefined
              : `About ${formatMoney(average, currency)} a day${
                  peak ? ` · biggest day ${dayLabel(peak.day.slice(0, 10))}` : ""
                }`
          }
          view={dailyView}
          onView={setDailyView}
          index={4}
        >
          {dailyView === "chart" ? (
            <DailyChart data={report.daily} currency={currency} initial={initialDay} />
          ) : (
            <DataTable
              caption="Spending on each day with any"
              head={["Day", "Spent"]}
              rows={report.daily
                .filter((d) => d.amount > 0)
                .map((d) => [dayLabel(d.day.slice(0, 10)), formatMoney(d.amount, currency)])}
            />
          )}
        </Card>
      )}

      {report.categories.length > 0 && (
        <section
          aria-label="Spending by category"
          className="enter"
          style={{ "--i": 5 } as React.CSSProperties}
        >
          <h2 className="mb-3 px-1 text-lg font-bold tracking-tight">Where it went</h2>
          <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
            <CategoryBars
              items={report.categories.map((c) => ({
                id: c.category_id,
                name: c.name,
                icon: c.icon,
                color: c.color,
                amount: c.amount,
              }))}
              total={report.expense}
              currency={currency}
              onSelect={(item) => onCategory(item.id)}
            />
          </div>
        </section>
      )}
    </>
  );
}

function SummaryTile({
  label,
  minor,
  currency,
  dot,
  change,
  goodWhen,
  against,
}: {
  label: string;
  minor: number;
  currency: string;
  dot: string;
  change: number | null;
  goodWhen: "up" | "down";
  against: string;
}) {
  return (
    <div className="rounded-2xl bg-white/10 p-3.5 backdrop-blur-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--hero-ink-2)]">
        <span aria-hidden className={`size-2 rounded-full ${dot}`} />
        {label}
      </p>
      <Money minor={minor} currency={currency} size="lg" className="mt-1.5 text-white" />
      <Change value={change} against={against} goodWhen={goodWhen} />
    </div>
  );
}

// "12% more than Sep". The arrow and words carry the direction; the shade only
// hints at whether that is good news.
function Change({
  value,
  against,
  goodWhen,
}: {
  value: number | null;
  against: string;
  goodWhen: "up" | "down";
}) {
  if (value === null) {
    return <p className="mt-1 text-xs text-[var(--hero-ink-2)]">No {against} to compare</p>;
  }
  const pct = Math.round(Math.abs(value) * 100);
  if (pct === 0) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-[var(--hero-ink-2)]">
        Same as {against}
      </p>
    );
  }
  const up = value > 0;
  const good = up === (goodWhen === "up");
  return (
    <p
      className={`mt-1 flex items-center gap-1 text-xs font-medium ${
        good ? "text-[#c6f8e3]" : "text-[#ffe28a]"
      }`}
    >
      {up ? "Up" : "Down"} {pct}% vs {against}
    </p>
  );
}

function Card({
  title,
  subtitle,
  view,
  onView,
  index,
  children,
}: {
  title: string;
  subtitle?: string;
  view: View;
  onView: (view: View) => void;
  index: number;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="enter rounded-3xl border border-line bg-surface p-5 shadow-card"
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          {subtitle && <p className="text-sm text-ink-2">{subtitle}</p>}
        </div>
        <div className="w-32 shrink-0">
          <Segmented<View>
            label={`${title} view`}
            value={view}
            onChange={onView}
            options={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
      </div>
      {children}
    </section>
  );
}

function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <div className="max-h-72 overflow-auto rounded-2xl border border-line">
      <table className="w-full text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-2">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-3 py-2.5 font-semibold ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-line">
              {row.map((cell, i) => (
                <td key={i} className={`px-3 py-2.5 ${i > 0 ? "text-right" : "font-medium"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
