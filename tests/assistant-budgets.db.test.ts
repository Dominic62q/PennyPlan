import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUserWithFixtures } from "./helpers/db";

let db: PGlite;
let uid: string;
let other: string;
let groceries: string;
let salary: string;

beforeAll(async () => {
  db = await createTestDb();
  uid = await createUserWithFixtures(db);
  other = await createUserWithFixtures(db);
  const one = async (sql: string) => (await db.query<{ id: string }>(sql, [uid])).rows[0].id;
  groceries = await one("select id from categories where user_id = $1 and name = 'Groceries'");
  salary = await one("select id from categories where user_id = $1 and name = 'Salary'");
});

afterAll(async () => {
  await db.close();
});

type Result = { id: string; undo_token: string; previous_amount: number | null };

const setBudget = (category: string | null, amount: number, user = uid) =>
  asUser(db, user, async () => {
    const { rows } = await db.query<{ r: Result }>("select assistant_set_budget($1, $2) as r", [category, amount]);
    return rows[0].r;
  });

const removeBudget = (category: string | null, user = uid) =>
  asUser(db, user, async () => {
    const { rows } = await db.query<{ r: Result }>("select assistant_remove_budget($1) as r", [category]);
    return rows[0].r;
  });

const undo = (token: string, user = uid) =>
  asUser(db, user, () => db.query("select assistant_undo($1)", [token]));

const budgetFor = async (category: string | null, user = uid) =>
  (
    await db.query<{ id: string; amount: number }>(
      "select id, amount from budgets where user_id = $1 and category_id is not distinct from $2",
      [user, category],
    )
  ).rows[0];

describe("assistant_set_budget", () => {
  it("creates a budget as the assistant with a token, and undo removes it", async () => {
    const result = await setBudget(groceries, 50000);
    expect(result.previous_amount).toBeNull();
    expect(await budgetFor(groceries)).toMatchObject({ id: result.id, amount: 50000 });

    const { rows } = await db.query<{ actor: string; action: string }>(
      "select actor, action from audit_log where id = $1",
      [result.undo_token],
    );
    expect(rows).toEqual([{ actor: "assistant", action: "insert" }]);

    await undo(result.undo_token);
    expect(await budgetFor(groceries)).toBeUndefined();
  });

  it("changes an existing budget, reports the old amount, and undo puts it back", async () => {
    await setBudget(groceries, 50000);
    const result = await setBudget(groceries, 70000);
    expect(result.previous_amount).toBe(50000);
    expect((await budgetFor(groceries)).amount).toBe(70000);

    await undo(result.undo_token);
    expect((await budgetFor(groceries)).amount).toBe(50000);
    await removeBudget(groceries);
  });

  it("sets the overall budget with no category", async () => {
    const result = await setBudget(null, 300000);
    expect((await budgetFor(null)).amount).toBe(300000);
    await undo(result.undo_token);
    expect(await budgetFor(null)).toBeUndefined();
  });

  it("refuses income categories, other people's categories and silly amounts", async () => {
    await expect(setBudget(salary, 10000)).rejects.toThrow(/open spending categories/);
    await expect(setBudget(groceries, 10000, other)).rejects.toThrow(/open spending categories/);
    await expect(setBudget(groceries, 0)).rejects.toThrow(/out of range/);
  });

  it("won't undo a budget that was changed afterwards", async () => {
    const first = await setBudget(groceries, 40000);
    await setBudget(groceries, 45000);
    await expect(undo(first.undo_token)).rejects.toThrow(/changed since/);
    expect((await budgetFor(groceries)).amount).toBe(45000);
    await removeBudget(groceries);
  });

  it("won't undo someone else's change", async () => {
    const result = await setBudget(groceries, 40000);
    await expect(undo(result.undo_token, other)).rejects.toThrow(/nothing to undo/);
    await removeBudget(groceries);
  });
});

describe("assistant_remove_budget", () => {
  it("removes a budget and undo brings it back", async () => {
    await setBudget(groceries, 60000);
    const result = await removeBudget(groceries);
    expect(result.previous_amount).toBe(60000);
    expect(await budgetFor(groceries)).toBeUndefined();

    await undo(result.undo_token);
    expect((await budgetFor(groceries)).amount).toBe(60000);
    await removeBudget(groceries);
  });

  it("says so when there is no budget", async () => {
    await expect(removeBudget(groceries)).rejects.toThrow(/no budget set/);
  });

  it("won't undo a removal once a new budget exists", async () => {
    await setBudget(groceries, 60000);
    const result = await removeBudget(groceries);
    await setBudget(groceries, 10000);
    await expect(undo(result.undo_token)).rejects.toThrow(/set again/);
    await removeBudget(groceries);
  });
});
