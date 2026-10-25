import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUserWithFixtures } from "./helpers/db";

let db: PGlite;
let uid: string;
let other: string;
let cash: string;
let food: string;
let groceries: string;
let salary: string;

beforeAll(async () => {
  db = await createTestDb();
  uid = await createUserWithFixtures(db);
  other = await createUserWithFixtures(db);
  const one = async (sql: string) => (await db.query<{ id: string }>(sql, [uid])).rows[0].id;
  cash = await one("select id from accounts where user_id = $1 and name = 'Cash'");
  food = await one("select id from categories where user_id = $1 and name = 'Food & Dining'");
  groceries = await one("select id from categories where user_id = $1 and name = 'Groceries'");
  salary = await one("select id from categories where user_id = $1 and name = 'Salary'");
});

afterAll(async () => {
  await db.close();
});

type Result = { id: string; undo_token: string; active_bills?: number; open_subcategories?: number };

const call = (sql: string, params: unknown[], user = uid) =>
  asUser(db, user, async () => (await db.query<{ r: Result }>(sql, params)).rows[0].r);

const createAccount = (name: string, o: { id?: string; type?: string; opening?: number } = {}, user = uid) =>
  call("select assistant_create_account($1, $2, $3, 'GHS', $4) as r", [o.id ?? randomUUID(), name, o.type ?? "savings", o.opening ?? 0], user);
const updateAccount = (id: string, patch: Record<string, unknown>, user = uid) =>
  call("select assistant_update_account($1, $2::jsonb) as r", [id, JSON.stringify(patch)], user);
const createCategory = (name: string, kind = "expense", parent: string | null = null, user = uid) =>
  call("select assistant_create_category($1, $2, $3, $4) as r", [randomUUID(), name, kind, parent], user);
const updateCategory = (id: string, patch: Record<string, unknown>, user = uid) =>
  call("select assistant_update_category($1, $2::jsonb) as r", [id, JSON.stringify(patch)], user);
const undo = (token: string, user = uid) =>
  asUser(db, user, () => db.query("select assistant_undo($1)", [token]));

const account = async (id: string) =>
  (await db.query<Record<string, unknown>>("select * from accounts where id = $1", [id])).rows[0];
const category = async (id: string) =>
  (await db.query<Record<string, unknown>>("select * from categories where id = $1", [id])).rows[0];

describe("accounts", () => {
  it("creates an account as the assistant with an opening balance, and undo deletes it", async () => {
    const result = await createAccount("Susu", { opening: 25000 });
    expect(await account(result.id)).toMatchObject({ name: "Susu", type: "savings", currency: "GHS", opening_balance: 25000 });
    const { rows } = await db.query("select actor, action from audit_log where id = $1", [result.undo_token]);
    expect(rows).toEqual([{ actor: "assistant", action: "insert" }]);

    await undo(result.undo_token);
    expect(await account(result.id)).toBeUndefined();
  });

  it("lands a retry with the same id on the same account", async () => {
    const id = randomUUID();
    const first = await createAccount("Retry", { id });
    const second = await createAccount("Retry", { id });
    expect(second.undo_token).toBe(first.undo_token);
    const { rows } = await db.query("select 1 from accounts where id = $1", [id]);
    expect(rows).toHaveLength(1);
    await undo(first.undo_token);
  });

  it("refuses a name already in use (any case), an empty name, and a bad type", async () => {
    await expect(createAccount("cash")).rejects.toThrow(/already have an account/);
    await expect(createAccount("   ")).rejects.toThrow(/1 to 60 characters/);
    await expect(createAccount("Odd", { type: "crypto" })).rejects.toThrow();
    // Another person's "Cash" doesn't count against this person's names.
    const mine = await createAccount("Only mine", {}, other);
    expect(mine.id).toBeTruthy();
  });

  it("renames, archives and restores, each undoable", async () => {
    const { id } = await createAccount("Old card", { type: "bank" });
    const renamed = await updateAccount(id, { name: "New card" });
    expect((await account(id)).name).toBe("New card");
    await undo(renamed.undo_token);
    expect((await account(id)).name).toBe("Old card");

    const archived = await updateAccount(id, { archived: true });
    expect((await account(id)).archived_at).not.toBeNull();
    await undo(archived.undo_token);
    expect((await account(id)).archived_at).toBeNull();

    await updateAccount(id, { archived: true });
    const restored = await updateAccount(id, { archived: false });
    expect((await account(id)).archived_at).toBeNull();
    await undo(restored.undo_token);
    expect((await account(id)).archived_at).not.toBeNull();
  });

  it("changes the opening balance (moving the balance by the difference), and undo puts it back", async () => {
    const { id } = await createAccount("Opening test", { opening: 10000 });
    await db.query(
      `insert into transactions (user_id, account_id, type, amount, currency, occurred_at)
       values ($1, $2, 'expense', 2500, 'GHS', now())`,
      [uid, id],
    );
    const balance = async () =>
      Number((await db.query<{ balance: string }>("select balance from account_balances where account_id = $1", [id])).rows[0].balance);
    expect(await balance()).toBe(7500);

    const changed = await updateAccount(id, { opening_balance: 20000 });
    expect((await account(id)).opening_balance).toBe(20000);
    expect(await balance()).toBe(17500);
    const { rows } = await db.query("select actor, action from audit_log where id = $1", [changed.undo_token]);
    expect(rows).toEqual([{ actor: "assistant", action: "update" }]);

    await undo(changed.undo_token);
    expect((await account(id)).opening_balance).toBe(10000);
    expect(await balance()).toBe(7500);

    // A negative opening balance (money owed) is fine; fractions and non-numbers are not.
    await updateAccount(id, { opening_balance: -5000 });
    expect((await account(id)).opening_balance).toBe(-5000);
    await expect(updateAccount(id, { opening_balance: 1.5 })).rejects.toThrow(/out of range/);
    await expect(updateAccount(id, { opening_balance: "12" })).rejects.toThrow(/must be a number/);
    await expect(updateAccount(id, { opening_balance: 100000000000000 })).rejects.toThrow(/out of range/);
  });

  it("counts the live bills on an account it archives", async () => {
    const { id } = await createAccount("Bills acct", { type: "bank" });
    await db.query(
      `insert into recurring_rules (user_id, kind, name, amount, currency, account_id, frequency, anchor_day, next_due)
       values ($1, 'expense', 'Rent', 100000, 'GHS', $2, 'monthly', 1, '2026-12-01')`,
      [uid, id],
    );
    expect((await updateAccount(id, { archived: true })).active_bills).toBe(1);
  });

  it("won't undo a creation once the account has entries, or a rename once it changed", async () => {
    const used = await createAccount("Used");
    await db.query(
      `insert into transactions (user_id, account_id, type, amount, currency, occurred_at)
       values ($1, $2, 'expense', 100, 'GHS', now())`,
      [uid, used.id],
    );
    await expect(undo(used.undo_token)).rejects.toThrow(/used since/);

    const { id } = await createAccount("Twice");
    const first = await updateAccount(id, { name: "Twice A" });
    await updateAccount(id, { name: "Twice B" });
    await expect(undo(first.undo_token)).rejects.toThrow(/changed since/);
    expect((await account(id)).name).toBe("Twice B");
  });

  it("refuses unknown fields, empty patches, other people's accounts and other people's tokens", async () => {
    await expect(updateAccount(cash, { currency: "USD" })).rejects.toThrow(/can't be changed this way/);
    await expect(updateAccount(cash, {})).rejects.toThrow(/Nothing to change/);
    await expect(updateAccount(cash, { name: "Hacked" }, other)).rejects.toThrow(/not found/);
    const mine = await createAccount("Private");
    await expect(undo(mine.undo_token, other)).rejects.toThrow(/nothing to undo/);
  });
});

describe("categories", () => {
  it("creates a top-level category and a subcategory, and undo deletes them", async () => {
    const top = await createCategory("Pets");
    const sub = await createCategory("Vet", "expense", top.id);
    expect(await category(sub.id)).toMatchObject({ name: "Vet", kind: "expense", parent_id: top.id });
    const { rows } = await db.query("select actor, action from audit_log where id = $1", [sub.undo_token]);
    expect(rows).toEqual([{ actor: "assistant", action: "insert" }]);

    await undo(sub.undo_token);
    expect(await category(sub.id)).toBeUndefined();
    await undo(top.undo_token);
    expect(await category(top.id)).toBeUndefined();
  });

  it("checks the parent: same kind, top level, open and the person's own", async () => {
    await expect(createCategory("Bonus", "income", food)).rejects.toThrow(/open top-level income category/);
    await expect(createCategory("Deep", "expense", groceries)).rejects.toThrow(/open top-level expense category/);
    await expect(createCategory("Sneaky", "expense", food, other)).rejects.toThrow(/open top-level expense category/);
    const archived = await createCategory("Closed");
    await updateCategory(archived.id, { archived: true });
    await expect(createCategory("Child", "expense", archived.id)).rejects.toThrow(/open top-level/);
  });

  it("refuses duplicates in the same place but allows the same name elsewhere", async () => {
    await expect(createCategory("food & dining")).rejects.toThrow(/already a category/);
    await expect(createCategory("Groceries", "expense", food)).rejects.toThrow(/already a category/);
    // "Salary" exists as income; an expense category may share the name.
    const same = await createCategory("Salary", "expense");
    await undo(same.undo_token);
    await expect(createCategory("   ")).rejects.toThrow(/1 to 60 characters/);
    await expect(createCategory("Odd", "transfer")).rejects.toThrow(/income or expense/);
  });

  it("renames, archives and restores, each undoable, and reports open subcategories", async () => {
    const top = await createCategory("Garden");
    await createCategory("Seeds", "expense", top.id);
    const renamed = await updateCategory(top.id, { name: "Gardening" });
    expect((await category(top.id)).name).toBe("Gardening");
    await undo(renamed.undo_token);
    expect((await category(top.id)).name).toBe("Garden");

    const archived = await updateCategory(top.id, { archived: true });
    expect(archived.open_subcategories).toBe(1);
    expect((await category(top.id)).archived_at).not.toBeNull();
    await undo(archived.undo_token);
    expect((await category(top.id)).archived_at).toBeNull();
  });

  it("won't undo a creation once it is used by a budget, entry or subcategory", async () => {
    const budgeted = await createCategory("Budgeted");
    await db.query("insert into budgets (user_id, category_id, amount) values ($1, $2, 1000)", [uid, budgeted.id]);
    await expect(undo(budgeted.undo_token)).rejects.toThrow(/used since/);

    const parent = await createCategory("Parent");
    await createCategory("Kid", "expense", parent.id);
    await expect(undo(parent.undo_token)).rejects.toThrow(/used since/);

    const spent = await createCategory("Spent on");
    await db.query(
      `insert into transactions (user_id, account_id, type, amount, currency, occurred_at, category_id)
       values ($1, $2, 'expense', 100, 'GHS', now(), $3)`,
      [uid, cash, spent.id],
    );
    await expect(undo(spent.undo_token)).rejects.toThrow(/used since/);
  });

  it("refuses unknown fields, other people's categories and income-kind surprises", async () => {
    await expect(updateCategory(salary, { kind: "expense" })).rejects.toThrow(/can't be changed this way/);
    await expect(updateCategory(salary, { name: "X" }, other)).rejects.toThrow(/not found/);
  });
});
