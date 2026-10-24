import { useSyncExternalStore } from "react";

// "Hide balance": a per-phone choice for showing money in public. Kept in
// localStorage; every screen that shows it follows through a change event.
const KEY = "penny-hide-balance";
const CHANGE_EVENT = "penny-privacy-change";

function read() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function setBalanceHidden(hidden: boolean) {
  try {
    localStorage.setItem(KEY, hidden ? "1" : "0");
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useBalanceHidden() {
  return useSyncExternalStore(subscribe, read, () => false);
}
