"use client";

import { Check, Copy, Undo2 } from "lucide-react";
import { useState } from "react";
import { ChartCard } from "@/components/assistant/charts/chart-card";
import { ReviewCard } from "@/components/assistant/review-card";
import { plainText, RichText } from "@/components/assistant/rich-text";
import { Mascot, type Mood } from "@/components/ui/mascot";
import { READING_PHRASE } from "@/lib/assistant/agent";
import type { ChatMessage, NewEntry } from "@/lib/assistant/types";

// Penny's face beside her replies. `pulse` rings it while she is working.
export function Avatar({ pulse = false, mood }: { pulse?: boolean; mood?: Mood }) {
  return (
    <span aria-hidden="true" className="relative size-7 shrink-0">
      {pulse && (
        <span
          className="absolute inset-0 rounded-full border-2 border-gold"
          style={{ animation: "halo 1.8s ease-out infinite" }}
        />
      )}
      <span className="relative block">
        <Mascot size={28} mood={mood ?? (pulse ? "thinking" : "idle")} animate={pulse} />
      </span>
    </span>
  );
}

export function UserBubble({ text, image }: { text: string; image?: string }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- a small saved preview, not a site image
        <img
          src={image}
          alt="Photo you sent"
          className="max-h-56 max-w-[60%] rounded-[1.25rem] rounded-br-md border border-line object-cover"
        />
      )}
      {text && (
        <p className="max-w-[84%] select-text whitespace-pre-wrap break-words rounded-[1.25rem] rounded-br-md bg-gold px-4 py-3 text-base font-medium leading-snug text-on-gold">
          {text}
        </p>
      )}
    </div>
  );
}

// A row of Penny's: the avatar sits beside the first message of a run and a
// spacer keeps the rest lined up under it.
function AssistantRow({
  showAvatar,
  mood,
  children,
}: {
  showAvatar: boolean;
  mood?: Mood;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      {showAvatar ? <Avatar mood={mood} /> : <span className="size-7 shrink-0" aria-hidden="true" />}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2.5">{children}</div>
    </div>
  );
}

// Copies text to the clipboard. Falls back to a hidden field where the clipboard
// API is blocked (older webviews, plain http).
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (!(await copyText(text))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={copied ? "Copied" : "Copy reply"}
      className="-mt-1 ml-1 flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-ink-3 transition active:bg-surface-2"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function TextBubble({ text, notice = false }: { text: string; notice?: boolean }) {
  return (
    <>
      <div
        className={`max-w-[92%] select-text break-words rounded-[1.25rem] rounded-tl-md px-4 py-3 text-base leading-snug ${
          notice ? "bg-surface-2 text-ink-2" : "bg-surface"
        }`}
      >
        {notice ? <p className="whitespace-pre-wrap">{text}</p> : <RichText text={text} />}
      </div>
      {!notice && <CopyButton text={plainText(text)} />}
    </>
  );
}

// The green line after a change: what was done, plus Undo while it can be
// reversed. Once undone it goes quiet and grey.
function ActionLine({
  label,
  detail,
  canUndo,
  undone,
  onUndo,
}: {
  label: string;
  detail?: string;
  canUndo: boolean;
  undone?: boolean;
  onUndo: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function undo() {
    setBusy(true);
    try {
      await onUndo();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex w-full items-center gap-2.5 rounded-full border py-1.5 pl-3 pr-1.5 ${
        undone ? "border-line bg-surface-2" : "border-income/30 bg-income-soft"
      }`}
    >
      <span
        className={`flex size-[1.375rem] shrink-0 items-center justify-center rounded-full ${
          undone ? "bg-line-strong text-ink-2" : "bg-income text-bg"
        }`}
      >
        {undone ? <Undo2 size={12} strokeWidth={3} /> : <Check size={13} strokeWidth={3.4} />}
      </span>
      <span className={`min-w-0 flex-1 text-sm font-semibold ${undone ? "text-ink-3 line-through" : ""}`}>
        {label}
        {detail && <span className="font-normal text-ink-2"> · {detail}</span>}
      </span>
      {undone ? (
        <span className="pr-2.5 text-sm font-semibold text-ink-2">Undone</span>
      ) : (
        canUndo && (
          <button
            type="button"
            onClick={undo}
            disabled={busy}
            className="h-8 shrink-0 rounded-full bg-surface-2 px-3.5 text-sm font-semibold transition active:scale-95 disabled:opacity-60"
          >
            {busy ? "Undoing…" : "Undo"}
          </button>
        )
      )}
    </div>
  );
}

// Asks before deleting, or before adding a long list. Nothing has happened yet; the
// main button does it, the other walks away. Once answered it shrinks to a quiet
// line (the green line follows).
function ConfirmCard({
  message,
  onConfirm,
  onKeep,
}: {
  message: Extract<ChatMessage, { kind: "confirm" }>;
  onConfirm: () => Promise<void>;
  onKeep: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const count = message.rows.length;
  const noun = count === 1 ? "transaction" : "transactions";
  const adding = message.action === "add";

  if (message.status !== "pending") {
    const done = adding ? "Added" : "Deleted";
    const passed = adding ? "Skipped" : "Kept";
    return (
      <p className="max-w-[92%] rounded-full border border-line px-3.5 py-1.5 text-sm text-ink-3">
        {message.status === "done" ? `${done} ${count} ${noun}` : `${passed} ${count} ${noun}`}
      </p>
    );
  }

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`w-full overflow-hidden rounded-[1.25rem] border bg-surface-2 ${adding ? "border-gold/50" : "border-expense/40"}`}
    >
      <p className="px-4 pb-1 pt-3 text-base font-semibold">
        {adding ? "Add" : "Delete"} {count} {noun}?
        {message.action === "add" && message.summary && (
          <span className="block text-xs font-normal text-ink-2">{message.summary}</span>
        )}
      </p>
      <ul className="max-h-60 divide-y divide-line overflow-y-auto px-4">
        {message.rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{row.title}</span>
              <span className="block truncate text-xs text-ink-2">{row.detail}</span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{row.amount}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-line p-2.5">
        <button
          type="button"
          onClick={onKeep}
          disabled={busy}
          className="h-11 flex-1 rounded-full border border-line-strong text-sm font-semibold transition active:scale-[0.97] disabled:opacity-60"
        >
          {adding ? "Skip" : "Keep"}
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className={`h-11 flex-1 rounded-full text-sm font-semibold transition active:scale-[0.97] disabled:opacity-60 ${
            adding ? "bg-gold text-on-gold" : "bg-expense text-bg"
          }`}
        >
          {adding ? (busy ? "Adding…" : `Add ${count}`) : busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

type ReviewMessage = Extract<ChatMessage, { kind: "review" }>;

export type ReviewHandlers = {
  onChange: (message: ReviewMessage) => void;
  onAccount: (message: ReviewMessage, accountId: string) => Promise<void>;
  onConfirm: (message: ReviewMessage, entries: NewEntry[]) => Promise<void>;
  onSkip: (message: ReviewMessage) => void;
};

export function MessageRow({
  message,
  previous,
  onUndo,
  onConfirm,
  onKeep,
  review,
}: {
  message: ChatMessage;
  previous?: ChatMessage;
  onUndo: (message: Extract<ChatMessage, { kind: "action" }>) => Promise<void>;
  onConfirm: (message: Extract<ChatMessage, { kind: "confirm" }>) => Promise<void>;
  onKeep: (message: Extract<ChatMessage, { kind: "confirm" }>) => void;
  review: ReviewHandlers;
}) {
  if (message.role === "user") return <UserBubble text={message.text} image={message.image} />;
  const showAvatar = previous?.role !== "assistant";
  return (
    <AssistantRow showAvatar={showAvatar} mood={message.kind === "notice" ? "sorry" : undefined}>
      {message.kind === "review" ? (
        <ReviewCard
          review={message}
          onChange={(next) => review.onChange({ ...message, ...next })}
          onAccount={(id) => review.onAccount(message, id)}
          onConfirm={(entries) => review.onConfirm(message, entries)}
          onSkip={() => review.onSkip(message)}
        />
      ) : message.kind === "confirm" ? (
        <ConfirmCard
          message={message}
          onConfirm={() => onConfirm(message)}
          onKeep={() => onKeep(message)}
        />
      ) : message.kind === "chart" ? (
        <ChartCard spec={message.chart} />
      ) : message.kind === "action" ? (
        <ActionLine
          label={message.label}
          detail={message.detail}
          canUndo={Boolean(message.undoTokens?.length)}
          undone={message.undone}
          onUndo={() => onUndo(message)}
        />
      ) : (
        <TextBubble text={message.text} notice={message.kind === "notice"} />
      )}
    </AssistantRow>
  );
}

// Penny's answer as it is being written. Becomes the normal bubble once it is done.
export function WritingRow({ text }: { text: string }) {
  return (
    <AssistantRow showAvatar mood="thinking">
      <div className="max-w-[92%] select-text break-words rounded-[1.25rem] rounded-tl-md bg-surface px-4 py-3 text-base leading-snug">
        <RichText text={text} />
      </div>
    </AssistantRow>
  );
}

// Shown while Penny works. A short plain phrase, never the inner steps.
export function WorkingRow({ phrase }: { phrase: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar pulse mood={phrase === READING_PHRASE ? "reading" : "thinking"} />
      <p
        role="status"
        className="flex items-center gap-2.5 rounded-[1.25rem] rounded-tl-md bg-surface-2 px-4 py-2.5 text-[0.95rem] font-medium"
      >
        <span className="assistant-shimmer">{phrase}</span>
        <span aria-hidden="true" className="flex items-center gap-1">
          {[0, 0.15, 0.3].map((delay) => (
            <span
              key={delay}
              className="size-[5px] rounded-full bg-ink-2"
              style={{ animation: `bob 1.2s ease-in-out ${delay}s infinite` }}
            />
          ))}
        </span>
      </p>
    </div>
  );
}
