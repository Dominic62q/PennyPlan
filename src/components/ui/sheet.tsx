"use client";

import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const CLOSE_MS = 240;

// A bottom sheet: slides up, closes on backdrop tap, Escape, the X, or a drag
// down on the handle. Content scrolls inside; the page behind is locked.
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  // Mount on open; keep mounted through the exit animation.
  useEffect(() => {
    if (open) {
      lastFocus.current = document.activeElement as HTMLElement | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      setClosing(false);
      setDragY(0);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const id = setTimeout(() => {
      setMounted(false);
      setClosing(false);
      lastFocus.current?.focus?.();
    }, CLOSE_MS);
    return () => clearTimeout(id);
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, onClose]);

  const onPointerDown = useCallback((e: PointerEvent) => {
    startY.current = e.clientY;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging) return;
      setDragY(Math.max(0, e.clientY - startY.current));
    },
    [dragging],
  );
  const onPointerUp = useCallback(() => {
    setDragging(false);
    if (dragY > 110) onClose();
    else setDragY(0);
  }, [dragY, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity duration-200"
        style={{
          animation: closing ? undefined : "fade-in 0.25s ease both",
          opacity: closing ? 0 : 1 - Math.min(dragY / 400, 0.6),
        }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[2rem] bg-surface shadow-pop outline-none"
        style={{
          transform: closing ? "translateY(100%)" : `translateY(${dragY}px)`,
          transition: dragging
            ? "none"
            : `transform ${CLOSE_MS}ms cubic-bezier(0.2, 0.9, 0.2, 1)`,
          animation: closing || dragY ? undefined : "sheet-up 0.34s cubic-bezier(0.2, 0.9, 0.2, 1) both",
        }}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center px-5 pt-3 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="h-1.5 w-10 rounded-full bg-line-strong" />
          <div className="mt-3 flex w-full items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              onPointerDown={(e) => e.stopPropagation()}
              className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink-2"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
