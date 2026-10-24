"use client";

import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Mascot } from "@/components/ui/mascot";

const CHECK_EVERY_MS = 30 * 60_000;

// When a new version has been deployed, the browser downloads it quietly and parks
// it as the "waiting" service worker. This tells the person and, on tap, lets it
// take over and reloads, so nobody keeps running yesterday's code (or its stale
// cache) until they happen to close every tab.
export function UpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;

    // A worker only counts as an update when another one already controls the page;
    // on the very first visit there is nothing to refresh.
    const offer = (worker: ServiceWorker | null) => {
      if (!cancelled && worker && navigator.serviceWorker.controller) setWaiting(worker);
    };

    const watch = (reg: ServiceWorkerRegistration) => {
      offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const incoming = reg.installing;
        incoming?.addEventListener("statechange", () => {
          if (incoming.state === "installed") offer(incoming);
        });
      });
    };

    void navigator.serviceWorker.ready.then((reg) => {
      if (cancelled) return;
      registration = reg;
      watch(reg);
    });

    // Browsers only look for a new version when the app is opened, which an
    // installed app can go days without. Look again whenever it comes back to the
    // front and every half hour while it stays open.
    const check = () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, CHECK_EVERY_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, []);

  function refresh() {
    if (!waiting) return;
    setApplying(true);
    // The new worker takes control, then the page reloads onto its files.
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
      once: true,
    });
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  if (!waiting) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[95] px-3">
      <div
        role="status"
        className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-full bg-surface-3 p-2 pl-5 shadow-pop"
        style={{ animation: "fade-up 0.4s ease both" }}
      >
        <Mascot size={34} animate={false} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">A new version is ready</p>
          <p className="text-xs text-ink-2">Refresh to get the latest.</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={applying}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-gold px-5 text-sm font-bold text-on-gold transition active:scale-95 disabled:opacity-60"
        >
          <RefreshCw size={15} className={applying ? "animate-spin" : ""} aria-hidden="true" />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setWaiting(null)}
          disabled={applying}
          aria-label="Not now"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-ink-3 transition active:bg-surface-2"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
