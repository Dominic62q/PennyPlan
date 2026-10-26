"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, History, MessageSquare, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Composer, type Attachment } from "@/components/assistant/composer";
import { chatKeys, HistorySheet } from "@/components/assistant/history-sheet";
import { MessageRow, WorkingRow, type ReviewHandlers } from "@/components/assistant/messages";
import { Greeting } from "@/components/greeting";
import { Mascot } from "@/components/ui/mascot";
import { dayLabel, localDateKey } from "@/lib/dates";
import { READING_PHRASE, runAgent, THINKING_PHRASE } from "@/lib/assistant/agent";
import { addConfirmed, deleteConfirmed, undoChange } from "@/lib/assistant/changes";
import { listChats, loadChat, saveChat } from "@/lib/assistant/chats";
import { AssistantError, describeImage, NothingToReadError, readDocument } from "@/lib/assistant/client";
import { compactTrace } from "@/lib/assistant/memory";
import { imageToDataUrl } from "@/lib/assistant/image";
import { readPdf } from "@/lib/assistant/pdf";
import { buildReview, recheckDuplicates } from "@/lib/assistant/review";
import type { ChatMessage, ModelMessage, NewEntry } from "@/lib/assistant/types";

const MAX_STATEMENT_CHARS = 20_000;
// How much of a PDF's text Penny keeps in mind when it comes with a message.
const MAX_KEPT_PDF_CHARS = 6_000;
const ACTIVE_CHAT_KEY = "penny-active-chat";
const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

const STARTERS = [
  "How much did I spend this month?",
  "What are my biggest bills?",
  "Add 45 for lunch today",
  "Set a monthly food budget",
];

export function AssistantScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [working, setWorking] = useState(false);
  const [phrase, setPhrase] = useState(THINKING_PHRASE);
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const request = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const justOpened = useRef<ChatMessage[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const inChat = messages.length > 0 || working;
  const router = useRouter();
  const [hello, setHello] = useState(false);
  const helloTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The last few chats, shown on the welcome screen so a new one isn't the only way in.
  const chats = useQuery({ queryKey: chatKeys.all, queryFn: listChats, enabled: !inChat });
  const recent = (chats.data ?? []).slice(0, 3);

  useEffect(() => {
    return () => {
      request.current?.abort();
      clearTimeout(helloTimer.current);
    };
  }, []);

  // Back goes to the page Penny was opened from. The browser's history can't be
  // trusted to have one (a reload, an installed app opening here, a previous page
  // that is the sign-in screen), so if we're still on Penny a moment later, go Home.
  function goBack() {
    const here = window.location.pathname;
    if (window.history.length > 1) {
      router.back();
      window.setTimeout(() => {
        if (window.location.pathname === here) router.push("/");
      }, 350);
    } else {
      router.push("/");
    }
  }

  function greet() {
    setHello(true);
    clearTimeout(helloTimer.current);
    helloTimer.current = setTimeout(() => setHello(false), 1600);
  }

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, working]);

  // What is on screen right now, readable from timers and cleanup code.
  const latest = useRef({ id: conversationId, messages });
  useEffect(() => {
    latest.current = { id: conversationId, messages };
  });
  const saved = useRef<ChatMessage[] | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // Writes the chat if it changed since the last save. A chat just reopened is
  // left alone until something changes, so opening it doesn't reorder the list.
  const persist = useCallback(() => {
    const { id, messages: current } = latest.current;
    if (current.length === 0 || current === justOpened.current || current === saved.current) return;
    saved.current = current;
    saveChat(id, current)
      .then(() => {
        setSaveFailed(false);
        return queryClient.invalidateQueries({ queryKey: chatKeys.all });
      })
      .catch(() => {
        // Forget it was saved so the next change (or leaving) tries again.
        if (saved.current === current) saved.current = null;
        setSaveFailed(true);
      });
  }, [queryClient]);

  // Saves shortly after every change, including the question while Penny is still
  // thinking, so a chat is never lost by leaving mid-answer.
  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(persist, 600);
    return () => clearTimeout(timer);
  }, [messages, persist]);

  // Leaving the screen or the app saves right away instead of waiting.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", persist);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, [persist]);

  // Remember which chat is open so coming back to Penny continues it.
  useEffect(() => {
    try {
      if (messages.length > 0) sessionStorage.setItem(ACTIVE_CHAT_KEY, conversationId);
    } catch {
      // Without storage Penny just opens on the welcome screen.
    }
  }, [messages, conversationId]);

  useEffect(() => {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(ACTIVE_CHAT_KEY);
    } catch {
      return;
    }
    if (!id) return;
    const wanted = id;
    loadChat(wanted)
      .then((opened) => {
        // The person may have started typing while it loaded.
        if (latest.current.messages.length > 0) return;
        justOpened.current = opened;
        setMessages(opened);
        setConversationId(wanted);
      })
      .catch(() => {
        try {
          sessionStorage.removeItem(ACTIVE_CHAT_KEY);
        } catch {
          // Nothing to clear.
        }
      });
  }, []);

  function stop() {
    request.current?.abort();
    request.current = null;
    setWorking(false);
  }

  async function send(text: string) {
    const history: ChatMessage[] = [...messages, { id: crypto.randomUUID(), role: "user", text }];
    setMessages(history);
    setWorking(true);
    const controller = new AbortController();
    request.current = controller;
    await answer(history, controller);
  }

  // Has Penny answer the chat so far and shows what she says. The question is
  // already on screen, and `working` is already on.
  async function answer(history: ChatMessage[], controller: AbortController) {
    let reply: ChatMessage;
    try {
      // Her look-ups are kept with the answer, so a follow-up can build on them.
      const kept: { trace?: ModelMessage[] } = {};
      const text = await runAgent({
        history,
        conversationId,
        queryClient,
        signal: controller.signal,
        onPhrase: setPhrase,
        onTrace: (trace) => void (kept.trace = compactTrace(trace)),
        onProposal: (proposal) =>
          setMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), role: "assistant", kind: "confirm", status: "pending", ...proposal },
          ]),
        onChart: (chart) =>
          setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", kind: "chart", chart }]),
        onChange: (note) =>
          setMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), role: "assistant", kind: "action", ...note },
          ]),
      });
      reply = {
        id: crypto.randomUUID(),
        role: "assistant",
        kind: "text",
        text,
        ...(kept.trace ? { trace: kept.trace } : {}),
      };
    } catch (error) {
      if (controller.signal.aborted) return;
      const text =
        error instanceof AssistantError ? error.message : "Something went wrong. Try again.";
      reply = { id: crypto.randomUUID(), role: "assistant", kind: "notice", text };
    }
    request.current = null;
    setMessages((m) => [...m, reply]);
    setWorking(false);
  }

  // Reverses one change from its green line. A failure shows as a notice.
  async function undo(line: Extract<ChatMessage, { kind: "action" }>) {
    if (!line.undoTokens?.length) return;
    try {
      for (const token of line.undoTokens) await undoChange(token, queryClient);
      setMessages((m) => m.map((x) => (x.id === line.id ? { ...line, undone: true } : x)));
    } catch (error) {
      const text = error instanceof Error ? error.message : "Couldn't undo that. Try again.";
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", kind: "notice", text }]);
    }
  }

  // The person tapped the main button on a confirm card: do it, then show the green line.
  async function confirmCard(card: Extract<ChatMessage, { kind: "confirm" }>) {
    try {
      if (card.action === "add") return await confirmAdd(card);
      const { count, undo_tokens } = await deleteConfirmed(
        card.rows.map((r) => r.id),
        queryClient,
      );
      const noun = count === 1 ? "transaction" : "transactions";
      setMessages((m) => [
        ...m.map((x) => (x.id === card.id ? { ...card, status: "done" as const } : x)),
        {
          id: crypto.randomUUID(),
          role: "assistant",
          kind: "action",
          label: count === 0 ? "Nothing to delete" : `Deleted ${count} ${noun}`,
          ...(undo_tokens.length ? { undoTokens: undo_tokens } : {}),
        },
      ]);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Couldn't do that. Try again.";
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", kind: "notice", text }]);
    }
  }

  const confirmAdd = (card: Extract<ChatMessage, { kind: "confirm"; action: "add" }>) =>
    saveEntries(card.id, card.entries, card.summary);

  // Saves the entries of a card the person confirmed, then marks the card answered
  // and shows the green line.
  async function saveEntries(cardId: string, entries: NewEntry[], summary?: string) {
    const { count, undoTokens, failure } = await addConfirmed(entries, queryClient);
    const noun = count === 1 ? "transaction" : "transactions";
    setMessages((m) => [
      ...(count > 0
        ? m.map((x) => (x.id === cardId && "status" in x ? { ...x, status: "done" as const } : x))
        : m),
      ...(count > 0
        ? [
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              kind: "action" as const,
              label: `Added ${count} ${noun}`,
              ...(summary ? { detail: summary } : {}),
              ...(undoTokens.length ? { undoTokens } : {}),
            },
          ]
        : []),
      ...(failure
        ? [
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              kind: "notice" as const,
              text:
                count > 0
                  ? `Added ${count} of ${entries.length}, then it stopped: ${failure}`
                  : `Nothing was added: ${failure}`,
            },
          ]
        : []),
    ]);
  }

  function keep(card: Extract<ChatMessage, { kind: "confirm" } | { kind: "review" }>) {
    setMessages((m) => m.map((x) => (x.id === card.id ? { ...card, status: "kept" as const } : x)));
  }

  // A small picture of the photo for the chat bubble. Best effort: no picture is fine.
  const previewOf = (attachment: Attachment) =>
    "file" in attachment && !isPdf(attachment.file)
      ? imageToDataUrl(attachment.file, true).catch(() => undefined)
      : Promise.resolve(undefined);

  // A photo, PDF or pasted statement. Sent alone, it is read and laid out for
  // checking; nothing is saved from here. Sent with a message, Penny takes the
  // message and what is in the picture together, and keeps both in mind.
  async function attach(attachment: Attachment, caption?: string) {
    if (caption && "file" in attachment) return attachWithMessage(attachment.file, caption);

    const lines = "text" in attachment ? attachment.text.split("\n").filter((l) => l.trim()).length : 0;
    const placeholder =
      "text" in attachment
        ? `Statement to read (${lines} ${lines === 1 ? "line" : "lines"})`
        : isPdf(attachment.file)
          ? "PDF to read"
          : "Photo to read";
    const lineId = crypto.randomUUID();
    const image = await previewOf(attachment);
    setMessages((m) => [
      ...m,
      { id: lineId, role: "user", local: true, text: placeholder, ...(image ? { image } : {}) },
    ]);
    setPhrase(READING_PHRASE);
    setWorking(true);

    const controller = new AbortController();
    request.current = controller;
    let reply: ChatMessage;
    try {
      if ("text" in attachment && attachment.text.length > MAX_STATEMENT_CHARS) {
        throw new AssistantError("That's too long to read in one go. Send it in smaller parts.");
      }
      let firstPageOnly = false;
      let input: { image: string } | { text: string };
      if ("text" in attachment) {
        input = { text: attachment.text };
      } else if (isPdf(attachment.file)) {
        const pdf = await readPdf(attachment.file);
        firstPageOnly = "firstPageOnly" in pdf;
        input = "text" in pdf ? { text: pdf.text } : { image: pdf.image };
        if ("text" in input && input.text.length > MAX_STATEMENT_CHARS) {
          throw new AssistantError("That PDF has too much text to read in one go. Send fewer pages.");
        }
      } else {
        input = { image: await imageToDataUrl(attachment.file) };
      }
      try {
        const { extraction, skipped } = await readDocument(input, conversationId, controller.signal);
        const built = await buildReview(extraction, skipped, queryClient);
        const review = firstPageOnly
          ? { ...built, warnings: ["This PDF is a scan, so I could only read its first page.", ...built.warnings] }
          : built;
        reply = { id: crypto.randomUUID(), role: "assistant", kind: "review", ...review };
      } catch (error) {
        // Not a receipt or statement. A picture is still worth remembering: put it in
        // words so the person can ask about it.
        if (!(error instanceof NothingToReadError) || !("image" in input)) throw error;
        const digest = await describeImage(input.image, conversationId, controller.signal);
        setMessages((m) => m.map((x) => (x.id === lineId && x.role === "user" ? { ...x, digest } : x)));
        reply = {
          id: crypto.randomUUID(),
          role: "assistant",
          kind: "text",
          text: "That doesn't look like a receipt or a statement, but I've looked at it and I'll remember it. Ask me anything about it, or tell me what to do with it.",
        };
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const text =
        error instanceof AssistantError ? error.message : "Something went wrong. Try again.";
      reply = { id: crypto.randomUUID(), role: "assistant", kind: "notice", text };
    }
    request.current = null;
    setMessages((m) => [...m, reply]);
    setWorking(false);
  }

  // A photo or PDF sent with a message of its own: what is in it is put into words
  // (or its text is taken), kept with the message, and Penny answers both together.
  async function attachWithMessage(file: File, caption: string) {
    const pdf = isPdf(file);
    const id = crypto.randomUUID();
    const image = await previewOf({ file });
    const shown: ChatMessage = {
      id,
      role: "user",
      text: pdf ? `${file.name}\n${caption}` : caption,
      ...(image ? { image } : {}),
    };
    setMessages([...messages, shown]);
    setPhrase(READING_PHRASE);
    setWorking(true);

    const controller = new AbortController();
    request.current = controller;
    let digest: string;
    try {
      if (pdf) {
        const read = await readPdf(file);
        digest =
          "text" in read
            ? read.text.length > MAX_KEPT_PDF_CHARS
              ? `${read.text.slice(0, MAX_KEPT_PDF_CHARS)}\n[The rest of the PDF was left out.]`
              : read.text
            : `(A scanned PDF: only the first page was read.)\n${await describeImage(read.image, conversationId, controller.signal)}`;
      } else {
        digest = await describeImage(await imageToDataUrl(file), conversationId, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const text =
        error instanceof AssistantError ? error.message : "Something went wrong. Try again.";
      request.current = null;
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", kind: "notice", text }]);
      setWorking(false);
      return;
    }

    const withDigest: ChatMessage = { ...shown, digest };
    setMessages((m) => m.map((x) => (x.id === id ? withDigest : x)));
    setPhrase(THINKING_PHRASE);
    await answer([...messages, withDigest], controller);
  }

  const reviewHandlers: ReviewHandlers = {
    onChange: (next) => setMessages((m) => m.map((x) => (x.id === next.id ? next : x))),
    onAccount: async (card, accountId) => {
      const rows = await recheckDuplicates({ accountId, rows: card.rows }, queryClient);
      setMessages((m) => m.map((x) => (x.id === card.id ? { ...card, accountId, rows } : x)));
    },
    onConfirm: (card, entries) => saveEntries(card.id, entries),
    onSkip: keep,
  };

  function resetChat() {
    stop();
    try {
      sessionStorage.removeItem(ACTIVE_CHAT_KEY);
    } catch {
      // Nothing to clear.
    }
    justOpened.current = null;
    saved.current = null;
    setMessages([]);
    setConversationId(crypto.randomUUID());
  }

  function newChat() {
    persist();
    resetChat();
  }

  // The chat that is open was deleted from the list: leave it, and don't let the
  // next message or the leave-the-screen save bring it back.
  function chatDeleted(id: string) {
    if (id === latest.current.id) resetChat();
  }

  async function openChat(id: string) {
    try {
      persist();
      const opened = await loadChat(id);
      stop();
      justOpened.current = opened;
      setMessages(opened);
      setConversationId(id);
      setShowHistory(false);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Couldn't open that chat.";
      // It may have been deleted elsewhere; refresh the lists so it stops showing.
      void queryClient.invalidateQueries({ queryKey: chatKeys.all });
      setShowHistory(false);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", kind: "notice", text }]);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-ink">
      <header
        className={`flex shrink-0 items-center justify-between px-2 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))] ${
          inChat ? "border-b border-line" : ""
        }`}
      >
        <div className="flex w-[5.5rem]">
          <button
            type="button"
            onClick={goBack}
            aria-label="Back"
            className="flex size-11 items-center justify-center rounded-full transition active:bg-surface-2"
          >
            <ChevronLeft size={24} />
          </button>
        </div>
        <span className="flex items-center gap-2.5 text-base font-semibold">
          <Mascot size={28} animate={!inChat} />
          Penny
        </span>
        <div className="flex w-[5.5rem] justify-end">
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            aria-label="Your chats"
            className="flex size-11 items-center justify-center rounded-full transition active:bg-surface-2"
          >
            <History size={21} />
          </button>
          {inChat ? (
            <button
              type="button"
              onClick={newChat}
              aria-label="New chat"
              className="flex size-11 items-center justify-center rounded-full transition active:bg-surface-2"
            >
              <Plus size={22} />
            </button>
          ) : (
            <span className="size-11" aria-hidden="true" />
          )}
        </div>
      </header>

      {inChat ? (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div
            role="log"
            aria-label="Conversation"
            className="mx-auto flex min-h-full w-full max-w-md flex-col justify-end gap-3.5 px-4 py-4"
          >
            {saveFailed && (
              <p
                role="status"
                className="self-center rounded-full bg-surface-2 px-3.5 py-1.5 text-xs font-medium text-ink-2"
              >
                Couldn&apos;t save this chat yet. It will try again with your next message.
              </p>
            )}
            {messages.map((m, i) => (
              <MessageRow
                key={m.id}
                message={m}
                previous={messages[i - 1]}
                onUndo={undo}
                onConfirm={confirmCard}
                onKeep={keep}
                review={reviewHandlers}
              />
            ))}
            {working && <WorkingRow phrase={phrase} />}
            <div ref={end} />
          </div>
        </div>
      ) : (
        <div className="relative flex flex-1 flex-col items-center overflow-y-auto px-4 py-2">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[70%]"
            style={{
              background:
                "radial-gradient(60% 55% at 50% 38%, rgb(244 197 66 / 0.13) 0%, transparent 70%)",
            }}
          />
          {[
            ["12%", "14%", "var(--ink-3)", "4s", "0s"],
            ["86%", "20%", "#f4c542", "5s", "0.8s"],
            ["20%", "46%", "var(--ink-3)", "6s", "1.4s"],
            ["90%", "44%", "var(--ink-3)", "4.5s", "2s"],
          ].map(([left, top, color, dur, delay]) => (
            <span
              key={`${left}-${top}`}
              aria-hidden="true"
              className="absolute size-[3px] rounded-full"
              style={{
                left,
                top,
                background: color,
                animation: `twinkle ${dur} ease-in-out ${delay} infinite`,
              }}
            />
          ))}

          <div className="relative my-auto flex w-full max-w-md flex-col items-center gap-5">
            <button
              type="button"
              onClick={greet}
              aria-label="Say hi to Penny"
              className="enter-pop relative flex size-[min(8rem,18dvh)] shrink-0 items-center justify-center transition active:scale-95"
            >
              <span
                aria-hidden="true"
                className="absolute size-[140%] rounded-full"
                style={{
                  background: "radial-gradient(closest-side, rgb(244 197 66 / 0.28), transparent)",
                  animation: "glow-pulse 3.6s ease-in-out infinite",
                }}
              />
              <Mascot
                size="100%"
                mood={hello ? "happy" : "idle"}
                className="relative drop-shadow-[0_14px_18px_rgb(12_31_25/0.22)]"
              />
            </button>

            <div className="relative text-center">
              <Greeting className="text-sm font-medium text-ink-2" />
              <h1 className="mt-1.5 text-[1.5rem] font-semibold leading-tight tracking-tight">
                What can I do
                <br />
                for your money?
              </h1>
            </div>

            <ul className="relative grid w-full grid-cols-2 gap-2.5">
              {STARTERS.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => send(prompt)}
                    className="flex h-full min-h-14 w-full items-center gap-2.5 rounded-[1.5rem] bg-surface px-4 py-3 text-left text-sm font-semibold leading-snug transition active:scale-[0.97]"
                  >
                    <span className="size-2 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>

            {recent.length > 0 && (
              <section aria-label="Recent chats" className="relative w-full">
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Pick up where you left off</h2>
                  <button
                    type="button"
                    onClick={() => setShowHistory(true)}
                    className="rounded-full px-2 py-1 text-xs font-semibold text-gold-text transition active:bg-surface-2"
                  >
                    All chats
                  </button>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {recent.map((chat) => (
                    <li key={chat.id}>
                      <button
                        type="button"
                        onClick={() => openChat(chat.id)}
                        className="flex h-12 w-full items-center gap-3 rounded-full bg-surface px-4 text-left transition active:scale-[0.98]"
                      >
                        <MessageSquare size={16} className="shrink-0 text-gold-text" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{chat.title}</span>
                        <span className="shrink-0 text-xs text-ink-3">{dayLabel(localDateKey(chat.updatedAt))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-md shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <Composer busy={working} onSend={send} onAttach={attach} onStop={stop} />
        {!inChat && (
          <p className="mt-2 text-center text-[0.7rem] text-ink-3">
            Penny only sees what each question needs. Not financial advice.
          </p>
        )}
      </div>

      {showHistory && (
        <HistorySheet
          currentId={conversationId}
          onOpen={openChat}
          onDeleted={chatDeleted}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
