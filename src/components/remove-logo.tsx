"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { useState } from "react";
import { IconTile } from "@/components/ui/category-badge";
import { useToast } from "@/components/toast";
import { removeLogo, type LogoKind } from "@/lib/ledger/logos";
import type { Logo } from "@/lib/ledger/logo";
import { ledgerKeys } from "@/lib/queries";

// Shows the brand logo a category or bill has been given, with a way to take it off
// (the normal icon comes back, and a logo isn't looked for again until it is renamed).
export function RemoveLogo({ kind, id, logo }: { kind: LogoKind; id: string; logo: Logo | null }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!logo || gone) return null;

  async function remove() {
    setBusy(true);
    try {
      await removeLogo(kind, id);
      setGone(true);
      await queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Couldn't remove that logo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
      <IconTile icon={Tag} color="#868e96" size="sm" logo={logo} />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{logo.title} logo</p>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="min-h-11 rounded-full px-3 text-sm font-semibold text-ink-2 transition active:bg-surface disabled:opacity-60"
      >
        Remove
      </button>
    </div>
  );
}
