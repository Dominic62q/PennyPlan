"use client";

import { ArrowUp, Camera, FileDown, FileText, Image as ImageIcon, Mic, Plus, Square, X } from "lucide-react";
import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { useDictation } from "@/lib/assistant/dictation";

const MAX_HEIGHT = 120;

export type Attachment = { file: File } | { text: string };

// The message bar. While Penny is working the send button becomes Stop. The plus
// button hands her a receipt photo, a screenshot, or a pasted statement to read.
export function Composer({
  busy,
  onSend,
  onAttach,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onAttach: (attachment: Attachment) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [statement, setStatement] = useState(false);
  const [menu, setMenu] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const pdf = useRef<HTMLInputElement>(null);
  const ready = text.trim() !== "" && !busy;
  const voice = useDictation();

  // Talk instead of typing: the words land in the box for checking, and nothing
  // is sent until the person taps send.
  function toggleVoice() {
    if (voice.listening) return voice.stop();
    voice.start(text, (spoken) => {
      setText(spoken);
      requestAnimationFrame(grow);
    });
    field.current?.blur();
  }

  function grow() {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!ready) return;
    voice.stop();
    if (statement) onAttach({ text: text.trim() });
    else onSend(text.trim());
    setText("");
    setStatement(false);
    requestAnimationFrame(grow);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line. A pasted statement is many lines,
    // so there Enter just adds one.
    if (event.key === "Enter" && !event.shiftKey && !statement && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function picked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMenu(false);
    if (file) onAttach({ file });
  }

  function startStatement() {
    setMenu(false);
    setStatement(true);
    field.current?.focus();
  }

  const item =
    "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition active:bg-surface-3 disabled:opacity-50";

  return (
    <div className="relative">
      {menu && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setMenu(false)}
          />
          <div
            role="menu"
            className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-2xl border border-line-strong bg-surface-2 p-1.5 shadow-pop"
          >
            <button type="button" role="menuitem" className={item} onClick={() => camera.current?.click()}>
              <Camera size={19} className="text-gold-text" /> Scan a receipt
            </button>
            <button type="button" role="menuitem" className={item} onClick={() => gallery.current?.click()}>
              <ImageIcon size={19} className="text-gold-text" /> Receipt or statement photo
            </button>
            <button type="button" role="menuitem" className={item} onClick={() => pdf.current?.click()}>
              <FileDown size={19} className="text-gold-text" /> Statement PDF
            </button>
            <button type="button" role="menuitem" className={item} onClick={startStatement}>
              <FileText size={19} className="text-gold-text" /> Paste statement text
            </button>
          </div>
        </>
      )}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={picked} />
      <input ref={pdf} type="file" accept="application/pdf,.pdf" hidden onChange={picked} />

      {statement && (
        <p className="mb-1.5 flex items-center justify-between rounded-full bg-surface-2 py-1 pl-3.5 pr-1.5 text-xs font-medium text-ink-2">
          Paste your statement, then send
          <button
            type="button"
            onClick={() => setStatement(false)}
            aria-label="Cancel statement"
            className="flex size-7 items-center justify-center rounded-full active:bg-surface-3"
          >
            <X size={15} />
          </button>
        </p>
      )}

      {(voice.listening || voice.error) && (
        <p
          role="status"
          className="mb-1.5 flex items-center justify-between rounded-full bg-surface-2 py-1 pl-3.5 pr-1.5 text-xs font-medium text-ink-2"
        >
          {voice.error ?? "Listening… tap the mic when you're done, then check it and send."}
          {voice.error && (
            <button
              type="button"
              onClick={voice.clearError}
              aria-label="Dismiss"
              className="flex size-7 shrink-0 items-center justify-center rounded-full active:bg-surface-3"
            >
              <X size={15} />
            </button>
          )}
        </p>
      )}

      <form
        onSubmit={submit}
        className="flex items-end gap-1 rounded-[1.75rem] bg-surface-2 p-1.5 pl-1.5 shadow-pop ring-1 ring-line"
      >
        <button
          type="button"
          onClick={() => setMenu((m) => !m)}
          disabled={busy}
          aria-label="Add a receipt or statement"
          aria-expanded={menu}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition active:scale-90 active:bg-surface-3 disabled:opacity-50"
        >
          <Plus size={22} />
        </button>
        <label className="sr-only" htmlFor="assistant-input">
          Message Penny
        </label>
        <textarea
          id="assistant-input"
          ref={field}
          rows={1}
          value={text}
          placeholder={statement ? "Paste statement text" : "Ask or add anything"}
          autoComplete="off"
          enterKeyHint={statement ? "enter" : "send"}
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={onKeyDown}
          className="min-h-11 flex-1 resize-none self-center bg-transparent py-2.5 text-base leading-snug text-ink outline-none placeholder:text-ink-3"
        />
        {voice.supported && !busy && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={voice.listening ? "Stop listening" : "Speak your message"}
            aria-pressed={voice.listening}
            className={`relative flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${
              voice.listening ? "bg-expense text-white" : "text-ink-2 active:bg-surface-3"
            }`}
          >
            {voice.listening && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full border-2 border-expense"
                style={{ animation: "halo 1.4s ease-out infinite" }}
              />
            )}
            {voice.listening ? <Square size={16} fill="currentColor" /> : <Mic size={21} />}
          </button>
        )}
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-gold transition active:scale-90"
          >
            <span className="size-3.5 rounded-[3px] bg-gold" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!ready}
            aria-label="Send"
            className={`flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${
              ready ? "bg-gold text-on-gold" : "bg-surface-3 text-ink-3"
            }`}
          >
            <ArrowUp size={22} strokeWidth={2.8} />
          </button>
        )}
      </form>
    </div>
  );
}
