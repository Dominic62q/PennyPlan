"use client";

import { BarChart3, Table2 } from "lucide-react";
import { useState } from "react";
import { chartTable } from "@/lib/assistant/chart-data";
import type { ChartSpec } from "@/lib/assistant/chart-spec";
import { DonutChart, BarsChart, BubbleChart, TreemapChart } from "./parts";
import { DumbbellChart, FlowChart, RadarChart, WaterfallChart } from "./flow";
import { useMoney } from "./kit";
import { CalendarChart, PunchcardChart, WeekdayChart } from "./rhythm";
import { BalancesChart, BudgetsChart, GaugeChart, TimelineChart } from "./status";
import { MonthsChart, PaceChart, StackedChart, TrendChart } from "./time";

function Chart({ spec }: { spec: ChartSpec }) {
  switch (spec.kind) {
    case "parts":
      return spec.shape === "donut" ? (
        <DonutChart spec={spec} />
      ) : spec.shape === "treemap" ? (
        <TreemapChart spec={spec} />
      ) : spec.shape === "bubbles" ? (
        <BubbleChart spec={spec} />
      ) : (
        <BarsChart spec={spec} />
      );
    case "trend":
      return <TrendChart spec={spec} />;
    case "pace":
      return <PaceChart spec={spec} />;
    case "calendar":
      return <CalendarChart spec={spec} />;
    case "weekday":
      return <WeekdayChart spec={spec} />;
    case "punchcard":
      return <PunchcardChart spec={spec} />;
    case "months":
      return <MonthsChart spec={spec} />;
    case "stacked":
      return <StackedChart spec={spec} />;
    case "cashflow":
      return spec.shape === "waterfall" ? <WaterfallChart spec={spec} /> : <FlowChart spec={spec} />;
    case "compare":
      return spec.shape === "radar" ? <RadarChart spec={spec} /> : <DumbbellChart spec={spec} />;
    case "budgets":
      return <BudgetsChart spec={spec} />;
    case "balances":
      return <BalancesChart spec={spec} />;
    case "gauge":
      return <GaugeChart spec={spec} />;
    case "timeline":
      return <TimelineChart spec={spec} />;
  }
}

function Table({ spec }: { spec: ChartSpec }) {
  const m = useMoney(spec.currency);
  const { columns, rows } = chartTable(spec, m.full);
  return (
    <div className="max-h-72 overflow-auto rounded-xl border border-line">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{spec.title}</caption>
        <thead className="sticky top-0 bg-surface-3">
          <tr>
            {columns.map((c, i) => (
              <th key={c + i} scope="col" className={`px-2.5 py-2 font-semibold ${i > 0 ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className={`px-2.5 py-1.5 tabular-nums ${i > 0 ? "text-right" : "font-medium"}`}>
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

// A chart in the conversation: a title, the chart, and a switch to read the same
// figures as a table.
export function ChartCard({ spec }: { spec: ChartSpec }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="w-full rounded-[1.5rem] bg-surface p-4 pb-3">
      <figcaption className="mb-1 flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[0.95rem] font-bold leading-snug">{spec.title}</span>
          {spec.subtitle && <span className="block text-xs text-ink-2">{spec.subtitle}</span>}
        </span>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          aria-label={asTable ? "Show the chart" : "Show as a table"}
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 transition active:scale-90"
        >
          {asTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
        </button>
      </figcaption>
      {asTable ? <Table spec={spec} /> : <Chart spec={spec} />}
    </figure>
  );
}
