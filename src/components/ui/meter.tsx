// Budget progress. The fill carries severity (accent, then warning, then
// danger); the track is a lighter step of the surface so state reads across the
// whole bar. Never colour alone: callers pair it with a text status.
export type MeterTone = "ok" | "warn" | "over";

export function meterTone(ratio: number): MeterTone {
  if (ratio >= 1) return "over";
  if (ratio >= 0.8) return "warn";
  return "ok";
}

const FILL: Record<MeterTone, string> = {
  ok: "bg-income",
  warn: "bg-warning",
  over: "bg-expense",
};

export function Meter({
  ratio,
  label,
  className = "",
}: {
  ratio: number;
  label: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(ratio, 1));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className={`h-2.5 w-full overflow-hidden rounded-full bg-surface-2 ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-700 ease-out ${FILL[meterTone(ratio)]}`}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
