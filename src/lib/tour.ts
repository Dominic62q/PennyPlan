// The first-run tour is offered once, to a brand-new account. This device
// remembers whether it is waiting to run or already finished.
const KEY = "penny-tour";
export const TOUR_EVENT = "penny-tour-start";

// Sign-up marks the tour as waiting; the Home screen starts it.
export function queueTour() {
  try {
    localStorage.setItem(KEY, "pending");
  } catch {
    // Without storage there is no way to remember it, so no tour.
  }
}

export function tourPending() {
  try {
    return localStorage.getItem(KEY) === "pending";
  } catch {
    return false;
  }
}

export function finishTour() {
  try {
    localStorage.setItem(KEY, "done");
  } catch {
    // Same as above.
  }
}

// "Take the tour again" from the Profile sheet.
export function startTour() {
  queueTour();
  window.dispatchEvent(new Event(TOUR_EVENT));
}
