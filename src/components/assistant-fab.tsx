"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Mascot } from "@/components/ui/mascot";

const HINT_KEY = "penny-hint-seen";
const HINT_MS = 6_000;

// Penny, one tap away on every main page: a small floating coin above the bottom
// bar. The first time in a session it says what it is for, then settles down.
export function AssistantFab() {
  const [hint, setHint] = useState(false);
  const [tucked, setTucked] = useState(false);

  // Out of the way while reading down a list; back as soon as they scroll up.
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 80 || y < last - 6) setTucked(false);
      else if (y > last + 6) setTucked(true);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(HINT_KEY) === "1";
      sessionStorage.setItem(HINT_KEY, "1");
    } catch {
      // Private mode: show the hint once per page load instead.
    }
    if (seen) return;
    const show = setTimeout(() => setHint(true), 1_800);
    const hide = setTimeout(() => setHint(false), 1_800 + HINT_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6.25rem+env(safe-area-inset-bottom))] z-30 px-4">
      <div
        className={`mx-auto flex max-w-md items-end justify-end gap-2 transition duration-300 ${
          tucked ? "translate-x-[5.5rem] opacity-0" : ""
        }`}
      >
        {hint && (
          <p
            role="status"
            className="enter-pop mb-3 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-semibold shadow-pop"
          >
            Ask Penny anything
          </p>
        )}
        <Link
          href="/assistant"
          aria-label="Ask Penny"
          className="pointer-events-auto relative flex size-[3.75rem] items-center justify-center rounded-full bg-[#0b1f1a] shadow-[0_10px_26px_-6px_rgb(0_0_0/0.55)] ring-2 ring-gold/70 transition active:scale-90"
        >
          <Mascot size="78%" />
        </Link>
      </div>
    </div>
  );
}
