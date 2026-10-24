import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";

// One place for the loading and error states every screen shows. Pass a
// `skeleton` shaped like the screen; the default is a list of rows.
export function QueryState({
  isPending,
  error,
  retry,
  skeleton,
  children,
}: {
  isPending: boolean;
  error: Error | null;
  retry: () => void;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  if (isPending) return <>{skeleton ?? <ListSkeleton />}</>;
  if (error) {
    return (
      <div
        role="alert"
        className="enter flex flex-col items-center gap-3 rounded-3xl border border-line bg-surface px-6 py-8 text-center shadow-card"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-expense-soft text-expense">
          <WifiOff size={22} />
        </span>
        <div>
          <p className="font-semibold">Couldn&apos;t load this</p>
          <p className="mt-1 text-sm text-ink-2">Check your connection and try again.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
