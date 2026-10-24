"use client";

import { AlertCircle, Check } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Toast = {
  id: number;
  message: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void };
};

type ToastApi = {
  show: (
    message: string,
    options?: { tone?: Toast["tone"]; action?: Toast["action"]; ms?: number },
  ) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast() {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}

// One message at a time, floating above the bottom bar. Used for confirmations
// and the Undo after a delete.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback<ToastApi["show"]>((message, options) => {
    if (timer.current) clearTimeout(timer.current);
    nextId.current += 1;
    setToast({
      id: nextId.current,
      message,
      tone: options?.tone ?? "info",
      action: options?.action,
    });
    timer.current = setTimeout(() => setToast(null), options?.ms ?? 6000);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(7.75rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4"
      >
        <AnimatePresence mode="wait">
          {toast && (
            <m.div
              key={toast.id}
              role={toast.tone === "error" ? "alert" : "status"}
              initial={{ opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 520, damping: 34 }}
              className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-full py-2.5 pl-4 pr-2 text-sm font-medium shadow-pop ${
                toast.tone === "error"
                  ? "bg-expense text-white"
                  : "bg-ink text-bg"
              }`}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                  toast.tone === "error" ? "bg-white/20" : "bg-income text-white"
                }`}
              >
                {toast.tone === "error" ? <AlertCircle size={16} /> : <Check size={16} strokeWidth={3} />}
              </span>
              <span className="flex-1">{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.run();
                    dismiss();
                  }}
                  className="min-h-11 shrink-0 rounded-full px-3 font-bold text-gold-text"
                >
                  {toast.action.label}
                </button>
              )}
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
