"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, LogOut, Tags, Wallet } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { InstallCard } from "@/components/install-guide";
import { NameSheet } from "@/components/name-sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { useDisplayName } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import { applyTheme, readTheme, subscribeTheme, type ThemeChoice } from "@/lib/theme";

function useUserEmail() {
  return useQuery({
    queryKey: ["auth", "user"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await createClient().auth.getUser();
      return data.user?.email ?? null;
    },
  }).data;
}

function AppearanceSetting() {
  const choice = useSyncExternalStore(subscribeTheme, readTheme, () => "light" as ThemeChoice);
  return (
    <div>
      <p className="mb-2 px-1 text-sm font-semibold text-ink-2">Appearance</p>
      <Segmented<ThemeChoice>
        label="Appearance"
        value={choice}
        onChange={applyTheme}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "auto", label: "Auto" },
        ]}
      />
    </div>
  );
}

// The round initial in the corner of the main screens. Opens a sheet with the
// account, shortcuts to Accounts, Categories and Bills, install help and sign out.
export function ProfileButton() {
  const email = useUserEmail();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const { ready, displayName, name } = useDisplayName();
  const initial = (name[0] ?? email?.[0] ?? "P").toUpperCase();

  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut();
    try {
      sessionStorage.removeItem("pp:launched");
      sessionStorage.removeItem("penny-active-chat");
    } catch {
      // Nothing to clear without storage.
    }
    // A full page load, not router.replace: the app keeps screens you left alive
    // in memory, so a soft navigation would bring this open sheet and dialog (and
    // the last person's cached data) straight back after the next sign-in.
    window.location.replace("/login");
  }

  const links = [
    { href: "/accounts", label: "Accounts", hint: "Cash, bank, mobile money", icon: Wallet },
    { href: "/categories", label: "Categories", hint: "Icons, colours, groups", icon: Tags },
    { href: "/bills", label: "Bills", hint: "Rent, subscriptions, salary", icon: CalendarClock },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Profile and settings"
        className="flex size-11 items-center justify-center rounded-full bg-gold text-base font-bold text-on-gold shadow-[0_4px_14px_-4px_rgb(244_197_66/0.6)] transition active:scale-95"
      >
        {initial}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Profile">
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex items-center gap-4 rounded-3xl bg-surface-2 p-4">
            <span className="flex size-14 items-center justify-center rounded-full bg-gold text-xl font-bold text-on-gold">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{displayName ?? "Welcome"}</p>
              <p className="truncate text-sm text-ink-2">{email ?? "…"}</p>
            </div>
          </div>

          <button
            type="button"
            disabled={!ready}
            onClick={() => setNaming(true)}
            className="flex min-h-14 items-center gap-3 rounded-3xl border border-line px-4 text-left transition active:bg-surface-2"
          >
            <span className="flex-1">
              <span className="block font-semibold">What Penny calls you</span>
              <span className="block text-sm text-ink-2">{displayName ?? "Add your first name"}</span>
            </span>
            <ChevronRight size={18} className="text-ink-3" />
          </button>

          <ul className="overflow-hidden rounded-3xl border border-line">
            {links.map(({ href, label, hint, icon: Icon }) => (
              <li key={href} className="border-b border-line last:border-b-0">
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-16 items-center gap-3 px-4 transition active:bg-surface-2"
                >
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-surface-2 text-ink-2">
                    <Icon size={20} />
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold">{label}</span>
                    <span className="block text-sm text-ink-2">{hint}</span>
                  </span>
                  <ChevronRight size={18} className="text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>

          <AppearanceSetting />

          <InstallCard />

          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-expense-soft font-semibold text-expense transition active:scale-[0.98]"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </Sheet>

      <NameSheet open={naming} onClose={() => setNaming(false)} current={displayName} />

      <ConfirmDialog
        open={confirming}
        title="Sign out of Penny Plan?"
        confirmLabel="Sign out"
        busyLabel="Signing out…"
        danger
        busy={busy}
        onConfirm={() => void signOut()}
        onCancel={() => setConfirming(false)}
      >
        You&apos;ll need your email and password to get back in. Your data stays safe.
      </ConfirmDialog>
    </>
  );
}
