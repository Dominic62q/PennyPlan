import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUserWithFixtures } from "./helpers/db";

let db: PGlite;
let uid: string;
let other: string;
let cash: string;
let savings: string;
let usd: string;
let otherCash: string;
let fees: string;
let salary: string;

beforeAll(async () => {
  db = await createTestDb();
  uid = await createUserWithFixtures(db);
  other = await createUserWithFixtures(db);
  const one = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
  cash = await one("select id from accounts where user_id = $1 and name = 'Cash'", [uid]);
  otherCash = await one("select id from accounts where user_id = $1 and name = 'Cash'", [other]);
  fees = await one("select id from categories where user_id = $1 and name = 'Fees & Charges'", [uid]);
  salary = await one("select id from categories where user_id = $1 and name = 'Salary'", [uid]);
  savings = await one("insert into accounts (user_id, name, type) values ($1, 'Savings', 'savings') returning id", [uid]);
  usd = await one(
    "insert into accounts (user_id, name, type, currency) values ($1, 'Dollars', 'bank', 'USD') returning id",
    [uid],
  );
});

afterAll(async () => {
  await db.close();
});

type Result = { id: string; undo_token: string };

const transfer = (
  o: { id?: string; from?: string; to?: string; out?: number; in?: number | null; fee?: number | null; feeCategory?: string | null; note?: string | null } = {},
  user = uid,
) =>
  asUser(db, user, async () =>
    (
      await db.query<{ r: Result }>(
        "select assistant_create_transfer($1, $2, $3, $4, $5, now(), $6, $7, $8) as r",
        [o.id ?? randomUUID(), o.from ?? cash, o.to ?? savings, o.out ?? 20000, o.in ?? null, o.note ?? null, o.fee ?? null, o.feeCategory ?? null],
      )
    ).rows[0].r,
  );
const undo = (token: string, user = uid) => asUser(db, user, () => db.query("select assistant_undo($1)", [token]));

const rows = async (group: string) =>
  (
    await db.query<Record<string, unknown>>(
      "select * from transactions where transfer_group_id = $1 or idempotency_key = $2 order by idempotency_key",
      [group, `${group}:fee`],
    )
  ).rows;
const balance = async (account: string) =>
  Number((await db.query<{ balance: string }>("select balance from account_balances where account_id = $1", [account])).rows[0].balance);

describe("assistant transfers", () => {
  it("moves money between two accounts as the assistant, and undo hides both sides", async () => {
    const [cashBefore, savingsBefore] = [await balance(cash), await balance(savings)];
    const r = await transfer({ out: 20000, note: "Rainy day" });
    const both = await rows(r.id);
    expect(both).toHaveLength(2);
    expect(both).toContainEqual(expect.objectContaining({ type: "transfer_out", account_id: cash, amount: 20000, source: "assistant", note: "Rainy day" }));
    expect(both).toContainEqual(expect.objectContaining({ type: "transfer_in", account_id: savings, amount: 20000, source: "assistant" }));
    expect(await balance(cash)).toBe(cashBefore - 20000);
    expect(await balance(savings)).toBe(savingsBefore + 20000);

    const { rows: audit } = await db.query("select actor, action, table_name from audit_log where id = $1", [r.undo_token]);
    expect(audit).toEqual([{ actor: "assistant", action: "insert", table_name: "transactions" }]);

    await undo(r.undo_token);
    expect((await rows(r.id)).every((t) => t.deleted_at !== null)).toBe(true);
    expect(await balance(cash)).toBe(cashBefore);
    expect(await balance(savings)).toBe(savingsBefore);
  });

  it("records a fee on the sending account, and undo hides it too", async () => {
    const cashBefore = await balance(cash);
    const r = await transfer({ out: 10000, fee: 150, feeCategory: fees });
    const fee = (await rows(r.id)).find((t) => t.type === "expense");
    expect(fee).toMatchObject({ account_id: cash, amount: 150, category_id: fees, source: "assistant" });
    expect(await balance(cash)).toBe(cashBefore - 10150);

    await undo(r.undo_token);
    expect(await balance(cash)).toBe(cashBefore);
    expect((await rows(r.id)).every((t) => t.deleted_at !== null)).toBe(true);
  });

  it("lands a retry with the same group id on the same transfer", async () => {
    const id = randomUUID();
    const first = await transfer({ id });
    const second = await transfer({ id });
    expect(second.undo_token).toBe(first.undo_token);
    expect(await rows(id)).toHaveLength(2);
  });

  it("refuses the same account, archived or unknown accounts, and bad amounts", async () => {
    await expect(transfer({ to: cash })).rejects.toThrow(/two different accounts/);
    await expect(transfer({ from: otherCash })).rejects.toThrow(/not found, or it is archived/);
    await db.query("update accounts set archived_at = now() where id = $1", [savings]);
    await expect(transfer()).rejects.toThrow(/not found, or it is archived/);
    await db.query("update accounts set archived_at = null where id = $1", [savings]);
    await expect(transfer({ out: 0 })).rejects.toThrow(/out of range/);
    await expect(transfer({ out: 100, fee: -5 })).rejects.toThrow(/out of range/);
    await expect(transfer({ out: 100, fee: 5, feeCategory: salary })).rejects.toThrow(/fee category/);
  });

  it("needs the amount received when the currencies differ", async () => {
    await expect(transfer({ to: usd, out: 120000 })).rejects.toThrow();
    const r = await transfer({ to: usd, out: 120000, in: 10000 });
    const both = await rows(r.id);
    expect(both).toContainEqual(expect.objectContaining({ type: "transfer_in", account_id: usd, amount: 10000, currency: "USD" }));
    await undo(r.undo_token);
  });

  it("refuses to undo a transfer that was edited afterwards", async () => {
    const r = await transfer({ out: 500 });
    await db.query("update transactions set note = 'edited' where transfer_group_id = $1 and type = 'transfer_in'", [r.id]);
    await expect(undo(r.undo_token)).rejects.toThrow(/changed since/);
    expect((await rows(r.id)).every((t) => t.deleted_at === null)).toBe(true);
  });

  it("can't be undone by someone else, or called while signed out", async () => {
    const r = await transfer({ out: 700 });
    await expect(undo(r.undo_token, other)).rejects.toThrow(/nothing to undo/);
    await expect(
      asAnon(db, () => db.query("select assistant_create_transfer($1, $2, $3, 100)", [randomUUID(), cash, savings])),
    ).rejects.toThrow();
  });
});
