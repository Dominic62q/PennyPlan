import { DEFAULT_LOCALE } from "@/lib/money";

export type KeypadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "."
  | "back";

const MAX_LENGTH = 14;

// The amount is kept as the text typed so far ("12.5"), never as a float.
// `digits` is how many decimals the currency has (2 for GHS, 0 for JPY).
export function pressKey(current: string, key: KeypadKey, digits: number) {
  if (key === "back") return current.slice(0, -1);

  if (key === ".") {
    if (digits === 0 || current.includes(".")) return current;
    return current === "" ? "0." : `${current}.`;
  }

  if (current.length >= MAX_LENGTH) return current;
  const dot = current.indexOf(".");
  if (dot !== -1 && current.length - dot - 1 >= digits) return current;
  // No leading zeros: "0" then "5" becomes "5".
  if (current === "0") return key === "0" ? current : key;
  return current + key;
}

// "1234.5" -> "1,234.5"; keeps a trailing "." while the person is typing.
export function displayAmount(raw: string, locale = DEFAULT_LOCALE) {
  const [whole = "", fraction] = raw.split(".");
  const grouped = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(Number(whole === "" ? "0" : whole));
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
