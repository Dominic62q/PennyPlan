export type ThemeChoice = "light" | "dark" | "auto";

export const THEME_KEY = "penny-theme";
const CHANGE_EVENT = "penny-theme-change";

// Light is the default. "auto" follows the phone. This runs before first paint
// (inline in the root layout) so there is no flash of the wrong theme.
export const THEME_SCRIPT = `try{var c=localStorage.getItem("${THEME_KEY}");var d=c==="dark"||(c==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "dark" || stored === "auto" ? stored : "light";
  } catch {
    return "light";
  }
}

// Stores the choice and applies it to the page straight away.
export function applyTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
  const dark = choice === "dark" || (choice === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// For useSyncExternalStore: lets a screen show the current choice.
export function subscribeTheme(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}
