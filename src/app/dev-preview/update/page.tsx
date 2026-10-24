"use client";

import { useEffect, useState } from "react";
import { UpdatePrompt } from "@/components/update-prompt";

// The "new version" banner with a pretend service worker standing in for a real
// deploy, since dev has none. Tapping Refresh logs what it sent, then reloads.
// Dev only (the layout above 404s in production).
export default function UpdatePreview() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const listeners: Array<() => void> = [];
    const waiting = {
      postMessage: (message: unknown) => {
        sessionStorage.setItem("update-preview-sent", JSON.stringify(message));
        listeners.forEach((fn) => fn());
      },
    };
    const registration = {
      waiting,
      addEventListener: () => undefined,
      update: () => Promise.resolve(),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: {},
        ready: Promise.resolve(registration),
        // The page reloads when the new worker takes control.
        addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
      },
    });
    // The stand-in must exist before the banner mounts, so this has to follow it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, []);

  return (
    <main className="p-6">
      <p className="text-sm text-ink-2">
        What Refresh sends is stored in sessionStorage as <code>update-preview-sent</code>.
      </p>
      {ready && <UpdatePrompt />}
    </main>
  );
}
