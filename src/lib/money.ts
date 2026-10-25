// Money is always an integer count of minor units (pesewas, cents) plus an
// ISO currency code. Never a float, and never arithmetic by the assistant.

export const DEFAULT_CURRENCY = "GHS";
export const DEFAULT_LOCALE = "en-GH";

// Largest value we accept: stays far inside Number.MAX_SAFE_INTEGER.
export const MAX_MINOR_UNITS = 99_999_999_999_999;

export function minorUnitDigits(currency: string, locale = DEFAULT_LOCALE) {
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency })
      .resolvedOptions().maximumFractionDigits ?? 2
  );
}

// Like parseMoney, but a leading "-" is allowed (money owed on a card or loan).
export function parseSignedMoney(input: string, currency = DEFAULT_CURRENCY) {
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-");
  const minor = parseMoney(negative ? trimmed.slice(1) : trimmed, currency);
  return minor === null ? null : negative ? -minor : minor;
}

// "1,240.50" or "45" -> minor units. Returns null for anything ambiguous.
export function parseMoney(input: string, currency = DEFAULT_CURRENCY) {
  const digits = minorUnitDigits(currency);
  const cleaned = input.trim().replace(/[\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > digits) return null;

  const minor = Number(whole + fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR_UNITS) return null;
  return minor;
}

export function formatMoney(
  minor: number,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
) {
  const digits = minorUnitDigits(currency, locale);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

// Plain "45.50" for editing in an input.
export function minorToInput(minor: number, currency = DEFAULT_CURRENCY) {
  const digits = minorUnitDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}
