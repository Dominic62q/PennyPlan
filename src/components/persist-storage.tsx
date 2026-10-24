"use client";

import { useEffect } from "react";
import { initInstallPrompt } from "@/lib/pwa/install-prompt";

// Runs once for the whole app: asks the browser not to evict offline data and
// starts listening for the install prompt so it isn't missed on later pages.
export function PersistStorage() {
  useEffect(() => {
    initInstallPrompt();
    navigator.storage?.persist?.().catch(() => {});
  }, []);
  return null;
}
