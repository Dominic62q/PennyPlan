"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { WELCOME_KEY } from "@/components/launch-overlay";
import { Logo } from "@/components/ui/logo";
import { Mascot } from "@/components/ui/mascot";
import { Spinner } from "@/components/ui/spinner";
import { SCENE_GREEN, WelcomeScene } from "@/components/welcome-scene";
import {
  friendlyAuthError,
  parseEmail,
  parseName,
  parseNewPassword,
  parsePassword,
} from "@/lib/auth/schema";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "register";
type Step = "welcome" | "form";

// A white field with a label that sits inside it and floats up once the field
// is focused or filled (the empty placeholder lets CSS tell the two apart).
const fieldClass =
  "peer h-14 w-full rounded-2xl border border-line-strong bg-surface px-4 pb-1 pt-5 text-base text-ink outline-none transition focus:border-[var(--hero-to)] focus:ring-4 focus:ring-[var(--hero-to)]/15";
const labelClass =
  "pointer-events-none absolute left-4 top-3 text-xs font-medium text-ink-3 transition-all peer-placeholder-shown:top-[1.0625rem] peer-placeholder-shown:text-base peer-focus:top-3 peer-focus:text-xs peer-focus:text-ink-2";

// Little cards drifting around Penny: made-up numbers that show what the app does.
function Floaty({
  className,
  tilt,
  delay,
  drift,
  children,
}: {
  className: string;
  tilt: number;
  delay: number;
  drift: number;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={`absolute z-20 ${className}`}
      style={{ transform: `rotate(${tilt}deg)`, animation: `fade-up 0.6s ease ${delay}ms both` }}
    >
      <div
        className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-2.5 text-[#10241d] shadow-[0_10px_30px_-10px_rgb(0_0_0/0.5)]"
        style={{ animation: `float-slow ${drift}s ease-in-out ${-drift / 2}s infinite` }}
      >
        {children}
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (mode: Mode) => void }) {
  const [happy, setHappy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function greet() {
    setHappy(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHappy(false), 1600);
  }

  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden text-white"
      style={{ background: SCENE_GREEN }}
    >
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))]">
        <header className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="text-lg font-bold tracking-tight">Penny Plan</span>
        </header>

        <div className="relative my-4 flex min-h-0 flex-1 items-center justify-center">
          <Floaty className="left-0 top-[8%]" tilt={-5} delay={500} drift={7}>
            <span>
              <span className="block text-xs text-[#5b6b64]">Spent in October</span>
              <span className="block text-base font-bold tabular-nums">GH₵3,420</span>
            </span>
          </Floaty>
          <Floaty className="right-0 top-[38%]" tilt={4} delay={650} drift={8}>
            <span>
              <span className="block text-xs text-[#5b6b64]">Netflix</span>
              <span className="block text-base font-bold text-[#a32d2d]">Due today</span>
            </span>
          </Floaty>
          <Floaty className="bottom-[6%] left-[6%]" tilt={-3} delay={800} drift={9}>
            <span className="w-32">
              <span className="flex items-baseline justify-between text-xs text-[#5b6b64]">
                Food budget <b className="font-bold text-[#10241d]">72%</b>
              </span>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#e6e8e0]">
                <span className="block h-full w-[72%] rounded-full bg-[#148259]" />
              </span>
            </span>
          </Floaty>

          <button
            type="button"
            onClick={greet}
            aria-label="Say hi to Penny"
            className="relative z-10 transition active:scale-95"
            style={{ animation: "pop-in 0.6s cubic-bezier(0.2, 0.9, 0.2, 1) 0.15s both" }}
          >
            <span className="block size-[min(11.5rem,25dvh)]">
              <Mascot size="100%" mood={happy ? "happy" : "idle"} />
            </span>
          </button>
        </div>

        <div style={{ animation: "fade-up 0.6s ease 0.4s both" }}>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight">
            Know where every pesewa goes.
          </h1>
          <p className="mt-3 text-base text-white/70">
            Budgets, bills and an assistant that does the typing.
          </p>
        </div>

        <div
          className="mt-7 flex flex-col gap-3"
          style={{ animation: "fade-up 0.6s ease 0.55s both" }}
        >
          <button
            type="button"
            onClick={() => onPick("register")}
            className="min-h-14 rounded-2xl bg-gold text-base font-semibold text-on-gold transition active:scale-[0.98]"
          >
            Create account
          </button>
          <button
            type="button"
            onClick={() => onPick("signin")}
            className="min-h-14 rounded-2xl border border-white/30 text-base font-semibold text-white transition active:scale-[0.98] active:bg-white/10"
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}

// A welcome screen first, then a focused email-and-password page. All inside
// the app window; no magic link, so the installed iPhone app never has to hand
// off to Safari.
export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const registering = mode === "register";

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  function pick(next: Mode) {
    switchMode(next);
    setStep("form");
    window.scrollTo(0, 0);
  }

  function enterApp() {
    try {
      sessionStorage.setItem(WELCOME_KEY, registering ? "new" : "back");
    } catch {
      // Without storage the home screen just skips the welcome splash.
    }
    // Let the celebration play, then hand over to the splash that looks the same.
    setLeaving(true);
    router.prefetch("/");
    window.setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 1500);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const parsedEmail = parseEmail(email);
    if (!parsedEmail.success) {
      setError(parsedEmail.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }
    const parsedPassword = registering
      ? parseNewPassword(password)
      : parsePassword(password);
    if (!parsedPassword.success) {
      setError(parsedPassword.error.issues[0]?.message ?? "Enter your password");
      return;
    }

    const parsedName = registering ? parseName(name) : null;
    if (parsedName && !parsedName.success) {
      setError(
        name.trim() ? (parsedName.error.issues[0]?.message ?? "Enter a valid name") : "Enter your first name",
      );
      return;
    }

    setBusy(true);
    const auth = createClient().auth;

    if (registering) {
      const { data, error: authError } = await auth.signUp({
        email: parsedEmail.data,
        password: parsedPassword.data,
        // Read by the new-user trigger, which stores it as the profile's display name.
        options: { data: { display_name: parsedName?.success ? parsedName.data : undefined } },
      });
      if (authError) {
        setBusy(false);
        setError(friendlyAuthError(authError));
        return;
      }
      if (!data.session) {
        // Supabase still has "Confirm email" switched on.
        setBusy(false);
        setNotice("Account created. Confirm your email with the link we sent, then sign in.");
        setMode("signin");
        return;
      }
    } else {
      const { error: authError } = await auth.signInWithPassword({
        email: parsedEmail.data,
        password: parsedPassword.data,
      });
      if (authError) {
        setBusy(false);
        setError(friendlyAuthError(authError));
        return;
      }
    }

    enterApp();
  }

  return (
    <>
      {step === "welcome" ? (
        <Welcome onPick={pick} />
      ) : (
        <div
          className="relative flex min-h-dvh flex-col bg-bg"
          style={{ animation: "fade-in 0.3s ease both" }}
        >
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.25rem))]">
            <header className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep("welcome")}
                disabled={busy}
                className="-ml-3 flex min-h-11 items-center gap-0.5 rounded-xl pl-2 pr-3 text-[0.95rem] font-semibold text-ink-2 transition active:bg-surface-2"
              >
                <ChevronLeft size={20} />
                Back
              </button>
              <Mascot size={40} animate={false} />
            </header>

            <div key={mode} className="mt-8" style={{ animation: "fade-up 0.45s ease both" }}>
              <h1 className="text-[2rem] font-bold leading-tight tracking-tight">
                {registering ? "Create your account" : "Welcome back"}
              </h1>
              <p className="mt-2 text-base text-ink-2">
                {registering
                  ? "Start planning your money in under a minute."
                  : "Sign in to pick up where you left off."}
              </p>
            </div>

            <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
              {registering && (
                <div className="relative">
                  <input
                    id="login-name"
                    type="text"
                    name="given-name"
                    autoComplete="given-name"
                    autoCapitalize="words"
                    autoCorrect="off"
                    maxLength={40}
                    required
                    placeholder=" "
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={fieldClass}
                  />
                  <label htmlFor="login-name" className={labelClass}>
                    First name
                  </label>
                </div>
              )}

              <div className="relative">
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                  placeholder=" "
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClass}
                />
                <label htmlFor="login-email" className={labelClass}>
                  Email
                </label>
              </div>

              <div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={show ? "text" : "password"}
                    name="password"
                    autoComplete={registering ? "new-password" : "current-password"}
                    required
                    placeholder=" "
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${fieldClass} pr-20`}
                  />
                  <label htmlFor="login-password" className={labelClass}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Hide password" : "Show password"}
                    aria-pressed={show}
                    className="absolute right-2 top-1/2 flex h-10 -translate-y-1/2 items-center rounded-xl px-3 text-sm font-semibold text-ink-2 transition active:bg-surface-2"
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </div>
                {registering && (
                  <p className="mt-2 px-1 text-sm text-ink-3">Use at least 8 characters.</p>
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-2xl bg-expense-soft px-4 py-3 text-sm font-medium text-expense"
                  style={{ animation: "pop-in 0.35s ease both" }}
                >
                  {error}
                </p>
              )}
              {notice && (
                <p
                  role="status"
                  className="rounded-2xl bg-income-soft px-4 py-3 text-sm font-medium text-income"
                  style={{ animation: "pop-in 0.35s ease both" }}
                >
                  {notice}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-2 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--hero-to)] text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-70"
              >
                {busy && <Spinner />}
                {busy
                  ? registering
                    ? "Creating account…"
                    : "Signing in…"
                  : registering
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>

            <div className="mt-auto pt-10 text-center">
              <p className="text-[0.95rem] text-ink-2">
                {registering ? "Already have an account?" : "New to Penny Plan?"}{" "}
                <button
                  type="button"
                  onClick={() => switchMode(registering ? "signin" : "register")}
                  className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-line-strong underline-offset-4"
                >
                  {registering ? "Sign in" : "Create an account"}
                </button>
              </p>
              <p className="mt-1 text-sm text-ink-3">Your money data stays private to your account.</p>
            </div>
          </div>
        </div>
      )}

      {/* Green grows out from the button and Penny celebrates while the app loads. */}
      {leaving && (
        <div
          className="fixed inset-0 z-[100]"
          style={{ animation: "scene-reveal 0.65s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
        >
          <WelcomeScene
            title={registering ? "Welcome to Penny Plan" : "Welcome back"}
            subtitle={registering ? "Let's give every pesewa a plan." : "Good to see you again."}
          />
        </div>
      )}
    </>
  );
}
