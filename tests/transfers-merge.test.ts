import { describe, expect, it } from "vitest";
import { mergeTransfers } from "@/lib/ledger/transfers";
import type { LedgerTransaction } from "@/lib/ledger/types";

function tx(over: Partial<LedgerTransaction>): LedgerTransaction {
  return {
    id: "t",
    accountId: "a",
    type: "expense",
    amount: 100,
    currency: "GHS",
    occurredAt: "2026-10-20T10:00:00.000Z",
    categoryId: null,
    payee: null,
    note: null,
    transferGroupId: null,
    deletedAt: null,
    ...over,
  };
}

describe("mergeTransfers", () => {
  it("folds both legs of a transfer into one entry on the out leg", () => {
    const out = tx({ id: "o", type: "transfer_out", accountId: "momo", transferGroupId: "g" });
    const into = tx({ id: "i", type: "transfer_in", accountId: "cash", transferGroupId: "g" });
    const fee = tx({ id: "f", amount: 175 });

    const entries = mergeTransfers([into, fee, out]);

    expect(entries.map((e) => e.tx.id)).toEqual(["f", "o"]);
    expect(entries[1].to).toBe(into);
    expect(entries[0].to).toBeNull();
  });

  it("keeps a lone leg as it is when its partner is not in the list", () => {
    const out = tx({ id: "o", type: "transfer_out", transferGroupId: "g" });
    expect(mergeTransfers([out])).toEqual([{ tx: out, to: null }]);
  });

  it("does not mix up two different transfers", () => {
    const a = [
      tx({ id: "o1", type: "transfer_out", transferGroupId: "g1" }),
      tx({ id: "i1", type: "transfer_in", transferGroupId: "g1" }),
    ];
    const b = [
      tx({ id: "o2", type: "transfer_out", transferGroupId: "g2" }),
      tx({ id: "i2", type: "transfer_in", transferGroupId: "g2" }),
    ];
    const entries = mergeTransfers([...a, ...b]);
    expect(entries.map((e) => [e.tx.id, e.to?.id])).toEqual([
      ["o1", "i1"],
      ["o2", "i2"],
    ]);
  });
});
