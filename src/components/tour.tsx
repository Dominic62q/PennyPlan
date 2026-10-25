"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInstallMode } from "@/components/install-guide";
import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/ui/mascot";
import { TOUR_EVENT, finishTour, tourPending } from "@/lib/tour";

type Step = {
  id: string;
  // Matches a data-tour attribute. Without one the card sits in the middle.
  target?: string;
  title: string;
  body: string;
  // The person taps the highlighted thing themselves to move on.
  interactive?: boolean;
  action?: string;
};

type Box = { top: number; left: number; width: number; height: number };

const PAD = 6;
const CARD_W = 320;
const GAP = 14;
const GIVE_UP_MS = 1200;

// The tour only makes sense on Home, where its targets live.
const isHome = (path: string) => path === "/" || path.endsWith("/dev-preview/home");

const sameBox = (a: Box | null, b: Box) =>
  a !== null &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

const find = (target: string) =>
  document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

// A short walk around the app for a brand-new account: it dims the screen,
// lights up one thing at a time and says what it is for. It waits for the
// welcome splash, skips anything not on screen, and can be skipped at any step.
export function Tour() {
  const pathname = usePathname();
  const install = useInstallMode();
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [cardH, setCardH] = useState(180);
  const card = useRef<HTMLDivElement>(null);

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [
      {
        id: "welcome",
        title: "Welcome to Penny Plan",
        body: "Here is a quick look around. It takes under a minute and you can skip it any time.",
        action: "Show me",
      },
      {
        id: "balance",
        target: "balance",
        title: "Your total balance",
        body: "Every account added together. Tap the eye to hide it when someone is looking.",
      },
      {
        id: "accounts",
        target: "accounts",
        title: "Your accounts",
        body: "Cash, bank, mobile money. Add each one so Penny knows where your money lives.",
      },
      {
        id: "actions",
        target: "actions",
        title: "Record money",
        body: "Spend, Receive or Move money between your own accounts.",
      },
      {
        id: "add",
        target: "add",
        title: "The plus button",
        body: "Tap it from any screen to record an entry in a few taps.",
      },
      {
        id: "penny",
        target: "penny",
        title: "Ask Penny",
        body: "Type or speak, like “add 45 for lunch”. Penny can also read a receipt photo.",
      },
      {
        id: "profile",
        target: "profile",
        interactive: true,
        title: "Tap your profile",
        body: "Open it now. It holds your accounts, bills, categories and settings.",
      },
    ];
    if (install !== "none") {
      list.push({
        id: "install",
        target: "install",
        title: install === "ios" ? "Add it to your Home Screen" : "Install Penny Plan",
        body:
          install === "ios"
            ? "In Safari tap Share, then Add to Home Screen. Penny Plan then opens like any other app."
            : install === "android"
              ? "Open your browser menu ⋮ and choose Install app or Add to Home screen. It then opens like any other app."
              : "Tap Install to put it on your home screen. It opens faster and keeps working on a weak connection.",
      });
    }
    list.push({
      id: "done",
      title: "You're all set",
      body: "Start by adding an account, then record your first entry. Penny is one tap away if you get stuck.",
      action: "Start using it",
    });
    return list;
  }, [install]);

  const step = index === null ? null : steps[index];
  const onHome = isHome(pathname);
  const lit = step !== null && onHome;

  function end() {
    finishTour();
    setIndex(null);
    setBox(null);
    // The profile sheet may still be open behind the last step.
    if (document.querySelector('[role="dialog"][aria-label="Profile"]')) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    }
  }

  function go(to: number) {
    setBox(null);
    if (to >= steps.length) end();
    else setIndex(to);
  }

  // Start when a new account has just arrived (or the tour was asked for again),
  // once the splash has gone.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const begin = () => {
      clearTimeout(timer);
      const wait = () => {
        const splash = document.documentElement.dataset.launch || document.querySelector(".launch-overlay");
        if (splash && tries++ < 48) {
          timer = setTimeout(wait, 250);
          return;
        }
        timer = setTimeout(() => setIndex(0), 500);
      };
      tries = 0;
      wait();
    };
    if (tourPending()) begin();
    window.addEventListener(TOUR_EVENT, begin);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(TOUR_EVENT, begin);
    };
  }, []);

  // The screen size, for placing the card.
  useEffect(() => {
    const read = () => setView({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  // Follow the highlighted thing while it moves (scrolling, sheets sliding in);
  // skip a step whose target never shows up.
  useEffect(() => {
    if (!lit || !step.target) return;
    const target = step.target;
    const started = performance.now();
    let found = false;
    let scrolled = false;
    let frame = 0;
    const tick = () => {
      const el = find(target);
      const r = el?.getBoundingClientRect();
      if (el && r && r.width > 0 && r.height > 0) {
        found = true;
        if (!scrolled) {
          scrolled = true;
          if (r.top < 90 || r.bottom > window.innerHeight - 150) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        setBox((prev) => (sameBox(prev, next) ? prev : next));
      } else if (!found && performance.now() - started > GIVE_UP_MS) {
        go((index ?? 0) + 1);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
    // go() only reads index and steps, which are already dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, index, steps]);

  // A step the person completes by tapping the highlighted button.
  const tracking = lit && step.interactive === true && box !== null;
  useEffect(() => {
    if (!tracking || !step?.target || index === null) return;
    const el = find(step.target);
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const done = () => {
      timer = setTimeout(() => go(index + 1), 350);
    };
    el.addEventListener("click", done);
    return () => {
      el.removeEventListener("click", done);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, index]);

  // The card's own height decides whether it fits below or above the highlight.
  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [index, box, view.w]);

  if (!lit || (step.target && !box)) return null;

  const hole = box
    ? {
        top: box.top - PAD,
        left: box.left - PAD,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
      }
    : null;
  const w = Math.min(CARD_W, view.w - 32);
  let left = (view.w - w) / 2;
  let top = (view.h - cardH) / 2;
  let arrow: { x: number; below: boolean } | null = null;
  if (hole) {
    const centre = hole.left + hole.width / 2;
    left = Math.min(Math.max(centre - w / 2, 16), view.w - w - 16);
    const below = hole.top + hole.height + GAP + cardH < view.h - 12;
    top = below ? hole.top + hole.height + GAP : Math.max(12, hole.top - GAP - cardH);
    arrow = { x: Math.min(Math.max(centre - left, 24), w - 24), below };
  }

  // The wrapper lets taps through; only the dim areas, the ring and the card catch them.
  const dim = "pointer-events-auto fixed bg-black/60 transition-all duration-300 ease-out";
  const total = steps.length;

  return (
    <div className="pointer-events-none fixed inset-0 z-[90]" role="dialog" aria-modal="false" aria-label="App tour">
      {hole ? (
        <>
          <div className={dim} style={{ top: 0, left: 0, width: view.w, height: Math.max(0, hole.top) }} />
          <div
            className={dim}
            style={{ top: hole.top + hole.height, left: 0, width: view.w, height: Math.max(0, view.h - hole.top - hole.height) }}
          />
          <div className={dim} style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div
            className={dim}
            style={{ top: hole.top, left: hole.left + hole.width, width: Math.max(0, view.w - hole.left - hole.width), height: hole.height }}
          />
          {/* A ring around the highlight. Taps reach it only when the step asks for one;
              otherwise this layer swallows them so the tour is not left by accident. */}
          <div
            className={`fixed rounded-[1.25rem] ring-2 ring-gold transition-all duration-300 ease-out ${
              step.interactive ? "pointer-events-none" : "pointer-events-auto"
            }`}
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          />
        </>
      ) : (
        <div className="pointer-events-auto fixed inset-0 bg-black/60" />
      )}

      <div
        ref={card}
        className="pointer-events-auto fixed rounded-[1.5rem] bg-surface-2 p-5 shadow-pop ring-1 ring-line transition-[top,left] duration-300 ease-out"
        style={{ top, left, width: w }}
      >
        {arrow && (
          <span
            aria-hidden
            className="absolute size-3 rotate-45 bg-surface-2"
            style={{
              left: arrow.x - 6,
              ...(arrow.below ? { top: -6 } : { bottom: -6 }),
            }}
          />
        )}
        {!hole && (
          <div className="mb-3 flex justify-center">
            <Mascot size={64} mood="happy" />
          </div>
        )}
        <p className={`text-xs font-medium text-ink-3 ${hole ? "" : "text-center"}`}>
          {index! + 1} of {total}
        </p>
        <h2 className={`mt-1 text-lg font-semibold ${hole ? "" : "text-center"}`}>{step.title}</h2>
        <p className={`mt-1.5 text-sm leading-relaxed text-ink-2 ${hole ? "" : "text-center"}`}>
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          {step.id !== "done" ? (
            <button
              type="button"
              onClick={end}
              className="min-h-11 px-2 text-sm font-semibold text-ink-3 transition active:scale-95"
            >
              Skip tour
            </button>
          ) : (
            <span />
          )}
          {step.interactive ? (
            <span className="text-sm font-medium text-gold-text">Tap it to continue</span>
          ) : (
            <Button size="sm" onClick={() => go(index! + 1)}>
              {step.action ?? "Next"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
