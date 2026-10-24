import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES as DB_ACCOUNT_TYPES } from "@/db/schema/accounts";
import { TRANSACTION_TYPES as DB_TRANSACTION_TYPES } from "@/db/schema/transactions";
import {
  accountInputSchema,
  transactionInputSchema,
  transactionPatchSchema,
  transferInputSchema,
} from "@/lib/ledger/schemas";
import {
  ACCOUNT_TYPES,
  TRANSACTION_TYPES,
  signedAmount,
} from "@/lib/ledger/types";

const id = () => crypto.randomUUID();
const now = "2026-10-23T10:00:00.000Z";

const validTx = () => ({
  id: id(),
  accountId: id(),
  type: "expense" as const,
  amount: 4550,
  currency: "GHS",
  occurredAt: now,
});

describe("constants stay in step with the database schema", () => {
  it("account types match", () => {
    expect([...ACCOUNT_TYPES]).toEqual([...DB_ACCOUNT_TYPES]);
  });
  it("transaction types match", () => {
    expect([...TRANSACTION_TYPES]).toEqual([...DB_TRANSACTION_TYPES]);
  });
});

describe("transactionInputSchema", () => {
  it("accepts a valid expense and fills optional fields with null", () => {
    const parsed = transactionInputSchema.parse(validTx());
    expect(parsed.categoryId).toBeNull();
    expect(parsed.payee).toBeNull();
    expect(parsed.note).toBeNull();
  });

  it("rejects zero, negative, fractional and oversized amounts", () => {
    for (const amount of [0, -5, 10.5, 100_000_000_000_000]) {
      expect(transactionInputSchema.safeParse({ ...validTx(), amount }).success).toBe(false);
    }
  });

  it("does not allow a transfer type through the plain add path", () => {
    expect(
      transactionInputSchema.safeParse({ ...validTx(), type: "transfer_out" }).success,
    ).toBe(false);
  });

  it("trims text and turns blanks into null", () => {
    const parsed = transactionInputSchema.parse({
      ...validTx(),
      payee: "  Melcom  ",
      note: "   ",
    });
    expect(parsed.payee).toBe("Melcom");
    expect(parsed.note).toBeNull();
  });

  it("rejects over-long text and bad ids and currencies", () => {
    expect(transactionInputSchema.safeParse({ ...validTx(), payee: "x".repeat(121) }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ ...validTx(), accountId: "nope" }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ ...validTx(), currency: "ghs" }).success).toBe(false);
  });
});

describe("transactionPatchSchema", () => {
  it("leaves untouched fields undefined so they are not overwritten", () => {
    const parsed = transactionPatchSchema.parse({ amount: 100 });
    expect(parsed.payee).toBeUndefined();
    expect(parsed.categoryId).toBeUndefined();
  });

  it("lets a field be cleared with null or blank text", () => {
    const parsed = transactionPatchSchema.parse({ categoryId: null, payee: "" });
    expect(parsed.categoryId).toBeNull();
    expect(parsed.payee).toBeNull();
  });
});

describe("transferInputSchema", () => {
  const base = () => ({
    groupId: id(),
    fromAccountId: id(),
    toAccountId: id(),
    amountOut: 5000,
    occurredAt: now,
  });

  it("accepts two different accounts", () => {
    expect(transferInputSchema.safeParse(base()).success).toBe(true);
  });

  it("rejects the same account on both sides", () => {
    const same = id();
    const result = transferInputSchema.safeParse({
      ...base(),
      fromAccountId: same,
      toAccountId: same,
    });
    expect(result.success).toBe(false);
  });
});

describe("accountInputSchema", () => {
  it("defaults the opening balance to zero and allows a negative one", () => {
    const base = { id: id(), name: " Savings ", type: "savings" as const, currency: "GHS" };
    expect(accountInputSchema.parse(base)).toMatchObject({ name: "Savings", openingBalance: 0 });
    expect(accountInputSchema.parse({ ...base, openingBalance: -2500 }).openingBalance).toBe(-2500);
  });

  it("rejects an empty name and an unknown type", () => {
    const base = { id: id(), name: "A", type: "bank" as const, currency: "GHS" };
    expect(accountInputSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(accountInputSchema.safeParse({ ...base, type: "crypto" }).success).toBe(false);
  });
});

describe("signedAmount", () => {
  it("adds income and transfers in, subtracts the rest", () => {
    expect(signedAmount({ type: "income", amount: 10 })).toBe(10);
    expect(signedAmount({ type: "transfer_in", amount: 10 })).toBe(10);
    expect(signedAmount({ type: "expense", amount: 10 })).toBe(-10);
    expect(signedAmount({ type: "transfer_out", amount: 10 })).toBe(-10);
  });
});
