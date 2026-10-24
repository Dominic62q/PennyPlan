"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { WelcomeScene } from "@/components/welcome-scene";

export const LAUNCHED_KEY = "pp:launched";
export const WELCOME_KEY = "pp:welcome";

// Runs before first paint (see the inline script in the root layout) so a
// returning visitor never sees a flash of the splash.
export const LAUNCH_SCRIPT = `try{if(!location.pathname.startsWith("/login")&&!sessionStorage.getItem("${LAUNCHED_KEY}")&&!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.dataset.launch="1"}catch(e){}`;

type Mode = "launch" | "welcome";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const SHOW_MS = 1500;
const FADE_MS = 520;
// Page content waits for this long behind the splash (see .enter in globals.css).
const RELEASE_MS = 3200;

function clearLaunchFlag() {
  delete document.documentElement.dataset.launch;
}

// The first thing people see: the coin spins in, the check draws itself, then
// the splash lifts to reveal the screen, whose content rises in behind it. After
// sign-in it greets the person instead.
export function LaunchOverlay() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [done, setDone] = useState(false);
  const [fresh, setFresh] = useState(false);

  useIsoLayoutEffect(() => {
    let welcome = false;
    let launched = false;
    try {
      const arrival = sessionStorage.getItem(WELCOME_KEY);
      welcome = arrival !== null;
      setFresh(arrival === "new");
      launched = sessionStorage.getItem(LAUNCHED_KEY) === "1";
    } catch {
      // Storage blocked: skip the splash rather than show it on every visit.
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || (!welcome && launched)) {
      clearLaunchFlag();
      setDone(true);
      return;
    }

    try {
      sessionStorage.setItem(LAUNCHED_KEY, "1");
      sessionStorage.removeItem(WELCOME_KEY);
    } catch {
      // Same as above.
    }
    document.documentElement.dataset.launch = "1";
    setMode(welcome ? "welcome" : "launch");
  }, []);

  useEffect(() => {
    if (!mode) return;
    // The login page already celebrated, so after sign-in the splash only holds briefly.
    const show = mode === "welcome" ? 700 : SHOW_MS;
    const lift = setTimeout(() => setLeaving(true), show);
    const remove = setTimeout(() => setDone(true), show + FADE_MS);
    const release = setTimeout(clearLaunchFlag, RELEASE_MS);
    return () => {
      clearTimeout(lift);
      clearTimeout(remove);
      clearTimeout(release);
    };
  }, [mode]);

  if (done) return null;

  // Right after sign-in: the same scene the login page just showed, at rest, so
  // the redirect looks like nothing happened before it lifts away.
  if (mode === "welcome") {
    return (
      <div
        aria-hidden
        className="launch-overlay fixed inset-0 z-[100] flex-col overflow-hidden"
        style={{
          opacity: leaving ? 0 : 1,
          transform: leaving ? "scale(1.06)" : "none",
          transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
          pointerEvents: leaving ? "none" : "auto",
        }}
      >
        <WelcomeScene
          still
          title={fresh ? "Welcome to Penny Plan" : "Welcome back"}
          subtitle={fresh ? "Let's give every pesewa a plan." : "Good to see you again."}
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className="launch-overlay fixed inset-0 z-[100] flex-col items-center justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 90% at 50% 20%, #14503f 0%, #0a241d 55%, #06120e 100%)",
        opacity: leaving ? 0 : 1,
        transform: leaving ? "scale(1.06)" : "none",
        transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <span
        className="absolute size-[26rem] rounded-full bg-gold/20 blur-3xl"
        style={{ animation: "glow-pulse 2.4s ease-in-out infinite" }}
      />
      <Logo size={116} animate />
      <p
        className="relative mt-7 text-3xl font-bold tracking-tight text-white"
        style={{ animation: "fade-up 0.6s ease 0.9s both" }}
      >
        Penny Plan
      </p>
      <p
        className="relative mt-2 text-base text-white/70"
        style={{ animation: "fade-up 0.6s ease 1.05s both" }}
      >
        Every pesewa has a plan
      </p>
    </div>
  );
}
