// Android and desktop Chrome/Edge fire `beforeinstallprompt` once the app is
// installable. We keep the event so an Install button can trigger it later.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function initInstallPrompt() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function subscribeInstallPrompt(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function canPromptInstall() {
  return deferred !== null;
}

export async function promptInstall() {
  if (!deferred) return;
  const event = deferred;
  deferred = null;
  emit();
  await event.prompt();
  await event.userChoice.catch(() => {});
}
