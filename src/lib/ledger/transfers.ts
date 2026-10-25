import type { LedgerTransaction } from "./types";

// A transfer is stored as two rows (out of one account, into another) sharing a
// transferGroupId. Lists show it as one entry: the out leg, with the in leg beside it.
export type ListEntry = {
  tx: LedgerTransaction;
  // The matching transfer_in leg, when both legs are in the list.
  to: LedgerTransaction | null;
};

export function mergeTransfers(transactions: LedgerTransaction[]): ListEntry[] {
  const legs = new Map<string, { out?: LedgerTransaction; in?: LedgerTransaction }>();
  for (const t of transactions) {
    if (!t.transferGroupId) continue;
    const pair = legs.get(t.transferGroupId) ?? {};
    if (t.type === "transfer_out") pair.out = t;
    else if (t.type === "transfer_in") pair.in = t;
    legs.set(t.transferGroupId, pair);
  }

  const entries: ListEntry[] = [];
  for (const t of transactions) {
    const pair = t.transferGroupId ? legs.get(t.transferGroupId) : undefined;
    if (!pair?.out || !pair.in) {
      entries.push({ tx: t, to: null });
    } else if (t === pair.out) {
      entries.push({ tx: t, to: pair.in });
    }
    // The in leg of a complete pair is folded into the out leg's entry.
  }
  return entries;
}
