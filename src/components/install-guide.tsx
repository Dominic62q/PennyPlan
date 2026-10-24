"use client";

import { Download, Share } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  canPromptInstall,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/pwa/install-prompt";

export type InstallMode = "none" | "prompt" | "ios";

function getMode(): InstallMode {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (isStandalone) return "none";

  // Android and desktop Chrome/Edge: a real install prompt is available.
  if (canPromptInstall()) return "prompt";

  // iOS Safari has no install prompt, so we explain the manual steps.
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIos ? "ios" : "none";
}

export function useInstallMode() {
  return useSyncExternalStore<InstallMode>(subscribeInstallPrompt, getMode, () => "none");
}

// How to install the app on this device: a real button where the browser
// allows it, the Share steps on iPhone, nothing once it is installed.
export function InstallCard() {
  const mode = useInstallMode();
  if (mode === "none") return null;

  return (
    <div className="rounded-3xl bg-gradient-to-br from-[var(--hero-from)] to-[var(--hero-to)] p-5 text-[var(--hero-ink)]">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-gold text-on-gold">
          <Download size={20} />
        </span>
        <h3 className="text-base font-semibold">
          {mode === "prompt" ? "Install Penny Plan" : "Install on your iPhone"}
        </h3>
      </div>
      {mode === "prompt" ? (
        <>
          <p className="mt-3 text-sm text-[var(--hero-ink-2)]">
            Add it to your home screen for quick access, even with a weak connection.
          </p>
          <Button className="mt-4" full onClick={() => void promptInstall()}>
            Install
          </Button>
        </>
      ) : (
        <>
          <ol className="mt-3 flex flex-col gap-2 text-sm text-[var(--hero-ink-2)]">
            <li className="flex items-center gap-2">
              <span className="font-semibold text-gold">1</span>
              Tap <Share size={15} className="inline" /> <b className="text-white">Share</b> in Safari
            </li>
            <li className="flex items-center gap-2">
              <span className="font-semibold text-gold">2</span>
              Choose <b className="text-white">Add to Home Screen</b>, then <b className="text-white">Add</b>
            </li>
            <li className="flex items-center gap-2">
              <span className="font-semibold text-gold">3</span>
              Open Penny Plan from your Home Screen
            </li>
          </ol>
          <p className="mt-3 text-xs text-[var(--hero-ink-2)]">
            Installing keeps your data safer offline and is needed for reminders.
          </p>
        </>
      )}
    </div>
  );
}
