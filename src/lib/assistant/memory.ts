import { isToolName } from "./tool-definitions";
import type { ChatMessage, ModelMessage } from "./types";

// What Penny remembers of a chat. The screen shows photos, cards, charts and green
// change lines, and the model only reads text, so each of those is written down as a
// short bracketed note in the history. Recent look-ups (what the tools returned) are
// kept too, so a follow-up builds on them instead of starting over.

const MAX_NOTE_CHARS = 1_500;
const MAX_DIGEST_CHARS = 6_000;
const MAX_NOTE_ROWS = 15;
// How many recent answers keep the look-ups behind them.
const RECENT_TRACES = 3;
const MAX_TRACE_RESULT_CHARS = 3_000;
const MAX_TRACE_CHARS = 24_000;

// What one request may carry; the server's own limits sit a little above these.
export const MAX_MODEL_MESSAGES = 90;
export const MAX_MODEL_CHARS = 90_000;

const OMITTED = "[Earlier messages in this chat were left out to keep it quick.]";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function listed(rows: string[]) {
  const shown = rows.slice(0, MAX_NOTE_ROWS);
  const more = rows.length - shown.length;
  return `${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

type Note = Exclude<ChatMessage, { role: "user" } | { kind: "text" } | { kind: "notice" }>;

function noteOf(m: Note): string {
  switch (m.kind) {
    case "action":
      return `[Change made: ${m.label}${m.detail ? ` · ${m.detail}` : ""}${m.undone ? " (the person undid it)" : ""}]`;
    case "confirm": {
      const rows = listed(m.rows.map((r) => `${r.title}${r.detail ? ` (${r.detail})` : ""} ${r.amount}`));
      const adding = m.action === "add";
      const state =
        m.status === "pending"
          ? "waiting for the person to confirm"
          : m.status === "done"
            ? adding
              ? "the person confirmed and they were added"
              : "the person confirmed and they were deleted"
            : adding
              ? "the person skipped it, nothing was added"
              : "the person kept them, nothing was deleted";
      return clip(
        `[Card shown: ${adding ? "add" : "delete"} ${m.rows.length} ${m.rows.length === 1 ? "transaction" : "transactions"}, ${state}. ${rows}]`,
        MAX_NOTE_CHARS,
      );
    }
    case "review": {
      const rows = listed(
        m.rows.map((r) => `${r.date} ${r.payee || "(no name)"} ${r.type === "income" ? "+" : "-"}${r.amount}${r.include ? "" : " (left out)"}`),
      );
      const state =
        m.status === "pending"
          ? "waiting for the person to check and add them"
          : m.status === "done"
            ? "the person added them"
            : "the person skipped them, nothing was added";
      const warnings = m.warnings.length ? ` Warnings: ${m.warnings.join(" ")}` : "";
      return clip(
        `[Card shown: what Penny read from a ${m.source}${m.currency ? ` (${m.currency})` : ""}, ${m.rows.length} ${m.rows.length === 1 ? "line" : "lines"}, ${state}. ${rows}${m.note ? ` Note: ${m.note}.` : ""}${warnings}]`,
        MAX_NOTE_CHARS,
      );
    }
    case "chart":
      return `[Chart shown: ${m.chart.title}${m.chart.subtitle ? `, ${m.chart.subtitle}` : ""}]`;
  }
}

function userContent(m: Extract<ChatMessage, { role: "user" }>): string | null {
  if (!m.digest) return m.local ? null : m.text;
  const read = `[Attachment the person sent. What Penny read from it:\n${clip(m.digest, MAX_DIGEST_CHARS)}]`;
  return m.local ? read : `${m.text}\n\n${read}`;
}

// A saved trace is only replayed if it is whole: known tools, every request answered.
// Anything else (a tool since renamed, a half-saved chat) is left out rather than
// making the server refuse the whole conversation.
function validTrace(trace: ModelMessage[] | undefined): trace is ModelMessage[] {
  if (!trace?.length) return false;
  const pending = new Set<string>();
  for (const step of trace) {
    if (step.role === "assistant") {
      if (pending.size > 0 || !step.tool_calls?.length) return false;
      for (const call of step.tool_calls) {
        if (!isToolName(call.function.name)) return false;
        pending.add(call.id);
      }
    } else if (step.role === "tool") {
      if (!pending.delete(step.tool_call_id)) return false;
    } else {
      return false;
    }
  }
  return pending.size === 0;
}

/** The look-ups from one answer, trimmed to what is worth keeping with the chat. */
export function compactTrace(trace: ModelMessage[]): ModelMessage[] | undefined {
  if (!validTrace(trace)) return undefined;
  const compact = trace.map((step): ModelMessage =>
    step.role === "tool" ? { ...step, content: clip(step.content, MAX_TRACE_RESULT_CHARS) } : step,
  );
  return compact.reduce((n, step) => n + sizeOf(step), 0) <= MAX_TRACE_CHARS ? compact : undefined;
}

function sizeOf(m: ModelMessage) {
  const calls = m.role === "assistant" ? (m.tool_calls ?? []) : [];
  return (m.content?.length ?? 0) + calls.reduce((n, c) => n + c.function.name.length + c.function.arguments.length, 0);
}

function build(messages: ChatMessage[], traceTurns: number): ModelMessage[] {
  // The latest few answers that have look-ups behind them keep those look-ups.
  const withTrace = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && withTrace.size < traceTurns; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.kind === "text" && validTrace(m.trace)) withTrace.add(m.id);
  }

  const out: ModelMessage[] = [];
  let notes: string[] = [];
  const flush = () => {
    if (notes.length === 0) return;
    out.push({ role: "assistant", content: notes.join("\n") });
    notes = [];
  };

  for (const m of messages) {
    if (m.role === "user") {
      flush();
      const content = userContent(m);
      if (content) out.push({ role: "user", content });
    } else if (m.kind === "text") {
      if (withTrace.has(m.id) && m.trace) out.push(...m.trace);
      // Notes made while she worked sit with her answer, so the history stays a plain
      // back and forth.
      out.push({ role: "assistant", content: [...notes, m.text].join("\n\n") });
      notes = [];
    } else if (m.kind !== "notice") {
      notes.push(noteOf(m));
    }
  }
  flush();
  return out;
}

const fits = (messages: ModelMessage[]) =>
  messages.length <= MAX_MODEL_MESSAGES && messages.reduce((n, m) => n + sizeOf(m), 0) <= MAX_MODEL_CHARS;

/**
 * The chat as the model reads it. Everything said and everything done is kept. When it
 * grows too long, the look-ups of older answers go first, then the oldest turns, so a
 * long chat keeps working instead of being refused.
 */
export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  for (const turns of [RECENT_TRACES, 1, 0]) {
    const built = build(messages, turns);
    if (fits(built)) return built;
  }

  const built = build(messages, 0);
  const starts = built.flatMap((m, i) => (m.role === "user" ? [i] : []));
  // Drop whole turns from the front, always keeping the latest one.
  for (let k = 1; k < starts.length; k++) {
    const rest = built.slice(starts[k]);
    if (fits(rest)) {
      const [first, ...others] = rest;
      return [{ role: "user", content: `${OMITTED}\n${first.content}` }, ...others];
    }
  }
  const last = built.slice(starts[starts.length - 1] ?? 0);
  const [first, ...others] = last;
  return first?.role === "user" ? [{ role: "user", content: `${OMITTED}\n${first.content}` }, ...others] : last;
}
