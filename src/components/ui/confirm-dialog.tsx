"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

// A small centred question: two buttons, Cancel first and focused so a stray
// Enter never does the risky thing. Backdrop tap and Escape cancel, except while
// the action is running. Sits above sheets, and swallows Escape so a sheet
// underneath stays open.
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const latest = useRef({ busy, onCancel });
  useEffect(() => {
    latest.current = { busy, onCancel };
  });

  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!latest.current.busy) latest.current.onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      back.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <button
        type="button"
        aria-label={cancelLabel}
        tabIndex={-1}
        disabled={busy}
        onClick={onCancel}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        style={{ animation: "fade-in 0.2s ease both" }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="relative w-full max-w-sm rounded-[1.75rem] bg-surface p-6 shadow-pop"
        style={{ animation: "pop-in 0.25s cubic-bezier(0.2, 0.9, 0.2, 1) both" }}
      >
        <h2 id="confirm-title" className="text-xl font-bold tracking-tight">
          {title}
        </h2>
        {children && (
          <div id="confirm-body" className="mt-2 text-[0.95rem] leading-snug text-ink-2">
            {children}
          </div>
        )}
        <div className="mt-6 flex gap-3">
          <button
            ref={cancel}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-12 flex-1 rounded-2xl border border-line-strong font-semibold transition active:scale-[0.98] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <Button
            variant={danger ? "danger" : "primary"}
            full
            loading={busy}
            onClick={onConfirm}
            className={danger ? "flex-1 bg-expense! text-bg!" : "flex-1"}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
