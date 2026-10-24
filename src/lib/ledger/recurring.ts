import { dayLabel, todayKey } from "@/lib/dates";
import type { RecurringRule } from "./types";

// Pure helpers for recurring rules and bills. The database owns the schedule
// (next_due moves on when something is paid or posted); this only describes it.

const MS_PER_DAY = 86_400_000;

function toUtc(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// Whole days from one calendar day to another. Negative when `to` is earlier.
export function daysBetween(from: string, to: string) {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

// The calendar day `days` after (or, negative, before) a day key.
export function addDaysKey(key: string, days: number) {
  const d = new Date(toUtc(key) + days * MS_PER_DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function ordinal(n: number) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// "Monthly, on the 25th", "Every 2 weeks, on Fridays", "Yearly, on 25 Oct".
export function scheduleLabel(
  rule: Pick<RecurringRule, "frequency" | "repeatEvery" | "anchorDay" | "nextDue">,
) {
  const { frequency, repeatEvery: n, anchorDay, nextDue } = rule;
  const [, month] = nextDue.split("-").map(Number);
  if (frequency === "weekly") {
    const weekday = WEEKDAYS[new Date(toUtc(nextDue)).getUTCDay()];
    return `${n === 1 ? "Weekly" : `Every ${n} weeks`}, on ${weekday}`;
  }
  if (frequency === "monthly") {
    return `${n === 1 ? "Monthly" : `Every ${n} months`}, on the ${ordinal(anchorDay)}`;
  }
  return `${n === 1 ? "Yearly" : `Every ${n} years`}, on ${anchorDay} ${MONTHS[month - 1]}`;
}

// What the rule costs (or brings in) in an average month, for "about X a month".
export function monthlyEquivalent(
  rule: Pick<RecurringRule, "frequency" | "repeatEvery" | "amount">,
) {
  const { frequency, repeatEvery: n, amount } = rule;
  if (frequency === "weekly") return Math.round((amount * 52) / 12 / n);
  if (frequency === "monthly") return Math.round(amount / n);
  return Math.round(amount / (12 * n));
}

export function isEnded(rule: Pick<RecurringRule, "nextDue" | "endDate">) {
  return rule.endDate !== null && rule.nextDue > rule.endDate;
}

export type DueTone = "overdue" | "today" | "soon" | "later";

// How far away the next occurrence is, in words and as a tone for the UI.
export function dueStatus(nextDue: string, today = todayKey()) {
  const days = daysBetween(today, nextDue);
  let tone: DueTone;
  let label: string;
  if (days < 0) {
    tone = "overdue";
    label = days === -1 ? "Overdue by 1 day" : `Overdue by ${-days} days`;
  } else if (days === 0) {
    tone = "today";
    label = "Due today";
  } else if (days === 1) {
    tone = "soon";
    label = "Due tomorrow";
  } else if (days <= 7) {
    tone = "soon";
    label = `Due in ${days} days`;
  } else {
    tone = "later";
    label = `Due ${dayLabel(nextDue)}`;
  }
  return { days, tone, label };
}

// A rule that has fallen due and is waiting for the person to act on it.
export function needsAttention(rule: RecurringRule, today = todayKey()) {
  return !rule.paused && !isEnded(rule) && !rule.autoPost && rule.nextDue <= today;
}

export type RuleGroups = {
  due: RecurringRule[];
  upcoming: RecurringRule[];
  paused: RecurringRule[];
  ended: RecurringRule[];
};

// Splits rules for the list: what needs a tap, what is coming, and the rest.
// Soonest first within each group.
export function groupRules(rules: RecurringRule[], today = todayKey()): RuleGroups {
  const byDue = (a: RecurringRule, b: RecurringRule) =>
    a.nextDue.localeCompare(b.nextDue) || a.name.localeCompare(b.name);
  const groups: RuleGroups = { due: [], upcoming: [], paused: [], ended: [] };
  for (const rule of rules) {
    if (isEnded(rule)) groups.ended.push(rule);
    else if (rule.paused) groups.paused.push(rule);
    else if (needsAttention(rule, today)) groups.due.push(rule);
    else groups.upcoming.push(rule);
  }
  for (const list of Object.values(groups)) list.sort(byDue);
  return groups;
}
