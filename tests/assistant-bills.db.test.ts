import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUserWithFixtures } from "./helpers/db";

let db: PGlite;
let uid: string;
let other: string;
let cash: string;
let usd: string;
let food: string;
let groceries: string;
let salary: string;
let otherCash: string;

beforeAll(async () => {
  db = await createTestDb();
  uid = await createUserWithFixtures(db);
  other = await createUserWithFixtures(db);
  const one = async (sql: string, user = uid) => (await db.query<{ id: string }>(sql, [user])).rows[0].id;
  cash = await one("select id from accounts where user_id = $1 and name = 'Cash'");
  food = await one("select id from categories where user_id = $1 and name = 'Food & Dining'");
  groceries = await one("select id from categories where user_id = $1 and name = 'Groceries'");
  salary = await one("select id from categories where user_id = $1 and name = 'Salary'");
  otherCash = await one("select id from accounts where user_id = $1 and name = 'Cash'", other);
  usd = (
    await db.query<{ id: string }>(
      "insert into accounts (user_id, name, type, currency) values ($1, 'Dollars', 'bank', 'USD') returning id",
      [uid],
    )
  ).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

type Result = {
  id: string;
  undo_token: string;
  transaction_id?: string;
  paid_for?: string;
  skipped?: string;
};

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const call = (sql: string, params: unknown[], user = uid) =>
  asUser(db, user, async () => (await db.query<{ r: Result }>(sql, params)).rows[0].r);

type Make = {
  id?: string;
  kind?: string;
  amount?: number;
  account?: string;
  category?: string | null;
  frequency?: string;
  every?: number;
  first?: string;
  end?: string | null;
  auto?: boolean;
};
const createBill = (name: string, o: Make = {}, user = uid) =>
  call("select assistant_create_bill($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11) as r", [
    o.id ?? randomUUID(),
    o.kind ?? "expense",
    name,
    o.amount ?? 15000,
    o.account ?? cash,
    o.category === undefined ? food : o.category,
    o.frequency ?? "monthly",
    o.every ?? 1,
    o.first ?? day(5),
    o.end ?? null,
    o.auto ?? false,
  ], user);
const updateBill = (id: string, patch: Record<string, unknown>, user = uid) =>
  call("select assistant_update_bill($1, $2::jsonb) as r", [id, JSON.stringify(patch)], user);
const payBill = (id: string, amount: number | null = null, user = uid) =>
  call("select assistant_pay_bill($1, $2) as r", [id, amount], user);
const payBillOn = (id: string, paidAt: Date, user = uid) =>
  call("select assistant_pay_bill($1, null, $2::timestamptz) as r", [id, paidAt.toISOString()], user);
const skipBill = (id: string, user = uid) => call("select assistant_skip_bill($1) as r", [id], user);
const undo = (token: string, user = uid) =>
  asUser(db, user, () => db.query("select assistant_undo($1)", [token]));

const bill = async (id: string) =>
  (await db.query<Record<string, unknown>>("select * from recurring_rules where id = $1", [id])).rows[0];
const entries = async (id: string) =>
  (
    await db.query<Record<string, unknown>>(
      "select * from transactions where idempotency_key like $1 order by created_at",
      [`rec:${id}:%`],
    )
  ).rows;
const dateOf = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

describe("creating bills", () => {
  it("creates a bill as the assistant, taking the currency from the account, and undo deletes it", async () => {
    const first = day(7);
    const r = await createBill("Rent", { amount: 120000, first, category: food, end: day(400) });
    const row = await bill(r.id);
    expect(row).toMatchObject({
      kind: "expense",
      name: "Rent",
      amount: 120000,
      currency: "GHS",
      account_id: cash,
      category_id: food,
      frequency: "monthly",
      repeat_every: 1,
      anchor_day: Number(first.slice(8)),
      auto_post: false,
      paused_at: null,
    });
    expect(dateOf(row.next_due)).toBe(first);
    const { rows } = await db.query("select actor, action from audit_log where id = $1", [r.undo_token]);
    expect(rows).toEqual([{ actor: "assistant", action: "insert" }]);

    await undo(r.undo_token);
    expect(await bill(r.id)).toBeUndefined();
  });

  it("takes a first due date of today, an income bill and no category", async () => {
    const r = await createBill("Salary", { kind: "income", category: salary, first: day(0), frequency: "weekly", every: 2 });
    expect(await bill(r.id)).toMatchObject({ kind: "income", category_id: salary, frequency: "weekly", repeat_every: 2 });
    const none = await createBill("Misc", { category: null });
    expect((await bill(none.id)).category_id).toBeNull();
  });

  it("lands a retry with the same id on the same bill", async () => {
    const id = randomUUID();
    const first = await createBill("Retry", { id });
    const second = await createBill("Retry", { id });
    expect(second.undo_token).toBe(first.undo_token);
    const { rows } = await db.query("select 1 from recurring_rules where id = $1", [id]);
    expect(rows).toHaveLength(1);
  });

  it("refuses a past date, bad numbers, and an end before the start", async () => {
    await expect(createBill("Old", { first: day(-1) })).rejects.toThrow(/can't be in the past/);
    await expect(createBill("Zero", { amount: 0 })).rejects.toThrow(/out of range/);
    await expect(createBill("Odd", { frequency: "daily" })).rejects.toThrow(/weekly, monthly or yearly/);
    await expect(createBill("Many", { every: 13 })).rejects.toThrow(/weekly, monthly or yearly/);
    await expect(createBill("Ends", { first: day(10), end: day(3) })).rejects.toThrow(/end date/);
    await expect(createBill("   ")).rejects.toThrow(/1 to 60 characters/);
    await expect(createBill("Kind", { kind: "transfer" })).rejects.toThrow(/expense or income/);
  });

  it("refuses accounts and categories that don't fit", async () => {
    await expect(createBill("Theirs", { account: otherCash })).rejects.toThrow(/account was not found/);
    await expect(createBill("Wrong kind", { category: salary })).rejects.toThrow(/wrong kind/);
    await db.query("update accounts set archived_at = now() where id = $1", [usd]);
    await expect(createBill("Archived", { account: usd })).rejects.toThrow(/account was not found/);
    await db.query("update accounts set archived_at = null where id = $1", [usd]);
    expect((await createBill("Dollar bill", { account: usd })).id).toBeTruthy();
  });

  it("can't be called while signed out", async () => {
    await expect(
      asAnon(db, () =>
        db.query("select assistant_create_bill($1, 'expense', 'X', 100, $2, null, 'monthly', 1, $3::date)", [
          randomUUID(),
          cash,
          day(3),
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe("changing bills", () => {
  it("renames, changes the amount, category and account, each undoable", async () => {
    const { id } = await createBill("Water", { amount: 4000, category: food });
    const renamed = await updateBill(id, { name: "  Water bill " });
    expect((await bill(id)).name).toBe("Water bill");
    await undo(renamed.undo_token);
    expect((await bill(id)).name).toBe("Water");

    const amount = await updateBill(id, { amount: 5500 });
    expect((await bill(id)).amount).toBe(5500);
    await undo(amount.undo_token);
    expect((await bill(id)).amount).toBe(4000);

    const cat = await updateBill(id, { category_id: groceries });
    expect((await bill(id)).category_id).toBe(groceries);
    const cleared = await updateBill(id, { category_id: null });
    expect((await bill(id)).category_id).toBeNull();
    await undo(cleared.undo_token);
    expect((await bill(id)).category_id).toBe(groceries);
    await undo(cat.undo_token).catch(() => undefined);
  });

  it("pauses and resumes, sets auto-post, and sets and clears an end date", async () => {
    const { id } = await createBill("Gym", { first: day(2) });
    const paused = await updateBill(id, { paused: true });
    expect((await bill(id)).paused_at).not.toBeNull();
    await undo(paused.undo_token);
    expect((await bill(id)).paused_at).toBeNull();

    await updateBill(id, { auto_post: true });
    expect((await bill(id)).auto_post).toBe(true);

    const ended = await updateBill(id, { end_date: day(200) });
    expect(dateOf((await bill(id)).end_date)).toBe(day(200));
    await undo(ended.undo_token);
    expect((await bill(id)).end_date).toBeNull();
    await updateBill(id, { end_date: day(200) });
    await updateBill(id, { end_date: null });
    expect((await bill(id)).end_date).toBeNull();
  });

  it("refuses schedule changes, unknown fields, empty patches and bad values", async () => {
    const { id } = await createBill("Strict", { first: day(4) });
    await expect(updateBill(id, { next_due: day(9) })).rejects.toThrow(/can't be changed/);
    await expect(updateBill(id, { frequency: "weekly" })).rejects.toThrow(/can't be changed/);
    await expect(updateBill(id, {})).rejects.toThrow(/Nothing to change/);
    await expect(updateBill(id, { name: "" })).rejects.toThrow(/1 to 60 characters/);
    await expect(updateBill(id, { amount: 0 })).rejects.toThrow(/out of range/);
    await expect(updateBill(id, { end_date: day(1) })).rejects.toThrow(/before the next due date/);
    await expect(updateBill(id, { category_id: salary })).rejects.toThrow(/wrong kind/);
    await expect(updateBill(id, { account_id: usd })).rejects.toThrow(/another currency/);
    await expect(updateBill(id, { account_id: otherCash })).rejects.toThrow(/account was not found/);
  });

  it("won't touch another person's bill", async () => {
    const mine = await createBill("Mine");
    await expect(updateBill(mine.id, { name: "Stolen" }, other)).rejects.toThrow(/bill was not found/);
    await expect(payBill(mine.id, null, other)).rejects.toThrow(/bill was not found/);
    await expect(skipBill(mine.id, other)).rejects.toThrow(/bill was not found/);
  });

  it("refuses to undo once the bill has been changed again", async () => {
    const { id } = await createBill("Twice", { amount: 1000 });
    const first = await updateBill(id, { amount: 2000 });
    await updateBill(id, { amount: 3000 });
    await expect(undo(first.undo_token)).rejects.toThrow(/changed since/);
    expect((await bill(id)).amount).toBe(3000);
  });
});

describe("paying and skipping", () => {
  it("records the payment, moves the due date on, and undo takes both back", async () => {
    const first = day(1);
    const { id } = await createBill("Internet", { amount: 25000, first, category: food });
    const paid = await payBill(id);
    expect(dateOf(paid.paid_for)).toBe(first);

    const rows = await entries(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "expense",
      amount: 25000,
      currency: "GHS",
      account_id: cash,
      category_id: food,
      payee: "Internet",
      source: "recurring",
      deleted_at: null,
      idempotency_key: `rec:${id}:${first}`,
    });
    const expected = (
      await db.query<{ d: Date }>("select recurring_advance($1::date, 'monthly', 1, $2) as d", [
        first,
        Number(first.slice(8)),
      ])
    ).rows[0].d;
    expect(dateOf((await bill(id)).next_due)).toBe(dateOf(expected));
    const { rows: audit } = await db.query("select actor from audit_log where id = $1", [paid.undo_token]);
    expect(audit).toEqual([{ actor: "assistant" }]);

    await undo(paid.undo_token);
    expect(dateOf((await bill(id)).next_due)).toBe(first);
    const after = await db.query<{ deleted_at: Date | null; idempotency_key: string | null }>(
      "select deleted_at, idempotency_key from transactions where id = $1",
      [paid.transaction_id],
    );
    expect(after.rows[0].deleted_at).not.toBeNull();
    expect(after.rows[0].idempotency_key).toBeNull();

    // The same payment can be recorded again afterwards.
    const again = await payBill(id);
    expect(dateOf(again.paid_for)).toBe(first);
    expect((await entries(id)).filter((e) => e.deleted_at === null)).toHaveLength(1);
  });

  it("records the amount actually paid when given one, and pays income bills as income", async () => {
    const { id } = await createBill("Electricity", { amount: 8000, first: day(0) });
    await payBill(id, 9250);
    expect((await entries(id))[0].amount).toBe(9250);
    expect((await bill(id)).amount).toBe(8000);

    const pay = await createBill("Wages", { kind: "income", category: salary, amount: 500000, first: day(0) });
    await payBill(pay.id);
    expect((await entries(pay.id))[0]).toMatchObject({ type: "income", amount: 500000 });
    await expect(payBill(pay.id, -5)).rejects.toThrow(/out of range/);
  });

  it("dates a late payment on the day it was made, still for the due date, and undo works", async () => {
    const first = day(0);
    const { id } = await createBill("Late rent", { amount: 90000, first });
    const paidOn = new Date(Date.now() - 3 * 86_400_000);
    const paid = await payBillOn(id, paidOn);

    const [row] = await entries(id);
    expect(new Date(row.occurred_at as Date).toISOString()).toBe(paidOn.toISOString());
    expect(row.idempotency_key).toBe(`rec:${id}:${first}`);

    await undo(paid.undo_token);
    expect(dateOf((await bill(id)).next_due)).toBe(first);
  });

  it("refuses a payment dated in the future", async () => {
    const { id } = await createBill("Early", { first: day(0) });
    await expect(payBillOn(id, new Date(Date.now() + 5 * 86_400_000))).rejects.toThrow(/today or an earlier day/i);
    expect(await entries(id)).toHaveLength(0);
  });

  it("refuses to pay or skip a paused, ended or archived-account bill", async () => {
    const paused = await createBill("Paused", { first: day(0) });
    await updateBill(paused.id, { paused: true });
    await expect(payBill(paused.id)).rejects.toThrow(/paused/);
    await expect(skipBill(paused.id)).rejects.toThrow(/paused/);

    const ended = await createBill("Ended", { first: day(0), end: day(0) });
    await payBill(ended.id);
    await expect(payBill(ended.id)).rejects.toThrow(/has ended/);
    await expect(skipBill(ended.id)).rejects.toThrow(/has ended/);

    const acct = (
      await db.query<{ id: string }>(
        "insert into accounts (user_id, name, type) values ($1, 'Soon gone', 'cash') returning id",
        [uid],
      )
    ).rows[0].id;
    const orphan = await createBill("Orphan", { account: acct, first: day(0) });
    await db.query("update accounts set archived_at = now() where id = $1", [acct]);
    await expect(payBill(orphan.id)).rejects.toThrow(/archived/);
  });

  it("won't record the same occurrence twice", async () => {
    const { id } = await createBill("Posted", { first: day(0) });
    const bump = (await bill(id)).next_due as Date;
    // The app already posted this occurrence, so the key is taken.
    await db.query(
      `insert into transactions (user_id, account_id, type, amount, currency, occurred_at, source, idempotency_key)
       values ($1, $2, 'expense', 100, 'GHS', now(), 'recurring', $3)`,
      [uid, cash, `rec:${id}:${dateOf(bump)}`],
    );
    await expect(payBill(id)).rejects.toThrow(/already recorded/);
  });

  it("skips an occurrence without recording anything, and undo puts the date back", async () => {
    const first = day(2);
    const { id } = await createBill("Skippable", { first });
    const skipped = await skipBill(id);
    expect(dateOf(skipped.skipped)).toBe(first);
    expect(dateOf((await bill(id)).next_due) > first).toBe(true);
    expect(await entries(id)).toHaveLength(0);

    await undo(skipped.undo_token);
    expect(dateOf((await bill(id)).next_due)).toBe(first);
  });

  it("refuses to undo a payment whose entry was edited, or after the bill changed", async () => {
    const edited = await createBill("Edited", { first: day(0) });
    const paid = await payBill(edited.id);
    await db.query("update transactions set note = 'changed by hand' where id = $1", [paid.transaction_id]);
    await expect(undo(paid.undo_token)).rejects.toThrow(/has been edited/);
    expect((await entries(edited.id))[0].deleted_at).toBeNull();

    const moved = await createBill("Moved", { first: day(0) });
    const first = await payBill(moved.id);
    await updateBill(moved.id, { amount: 777 });
    await expect(undo(first.undo_token)).rejects.toThrow(/changed since/);
    expect((await entries(moved.id)).filter((e) => e.deleted_at === null)).toHaveLength(1);
  });

  it("restores everything a patch changed, including a pause, when undone together with nothing else", async () => {
    const { id } = await createBill("Combined", { first: day(3), amount: 100 });
    const patch = await updateBill(id, { name: "Combined 2", amount: 200, auto_post: true, paused: true, end_date: day(90) });
    await undo(patch.undo_token);
    expect(await bill(id)).toMatchObject({ name: "Combined", amount: 100, auto_post: false, paused_at: null, end_date: null });
  });

  it("refuses to undo a bill's creation once it has recorded entries", async () => {
    const r = await createBill("Used", { first: day(0) });
    await payBill(r.id);
    await expect(undo(r.undo_token)).rejects.toThrow();
    expect(await bill(r.id)).toBeDefined();
  });
});
