import { minorUnitDigits } from "@/lib/money";

// Rounds the top of a chart axis up to a tidy number (1, 2, 2.5 or 5 times a
// power of ten), so the gridlines read as 500, 1K, 2.5K and never 3,137.
export function niceMax(maxMinor: number, currency: string) {
  const unit = 10 ** minorUnitDigits(currency);
  const major = Math.max(maxMinor, 1) / unit;
  const pow = 10 ** Math.floor(Math.log10(major));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= major) ?? 10 * pow;
  return Math.round(step * unit);
}
