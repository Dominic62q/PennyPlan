import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUserWithFixtures } from "./helpers/db";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

type Row = Record<string, unknown>;

async function one<T = Row>(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

const accountId = async (uid: string) =>
  (await one<{ id: string }>(
    "select id from accounts where user_id = $1 and name = 'Cash'",
    [uid],
  )).id;

const categoryId = async (uid: string, name: string, kind = "expense") =>
  (await one<{ id: string }>(
    "select id from categories where user_id = $1 and name = $2 and kind = $3",
    [uid, name, kind],
  )).id;

function addTx(
  uid: string,
  o: {
    account: string;
    type?: string;
    amount: number;
    at: string;
    category?: string | null;
    deleted?: boolean;
  },
) {
  return asUser(db, uid, () =>
    db.query(
      `insert into transactions
         (user_id, account_id, type, amount, currency, occurred_at, category_id, deleted_at)
       values ($1, $2, $3, $4, 'GHS', $5, $6, $7)`,
      [
        uid,
        o.account,
        o.type ?? "expense",
        o.amount,
        o.at,
        o.category ?? null,
        o.deleted ? new Date().toISOString() : null,
      ],
    ),
  );
}

const setBudget = (uid: string, category: string | null, amount: number) =>
  asUser(db, uid, () =>
    one<{ set_budget: string }>("select set_budget($1, $2)", [category, amount]),
  ).then((r) => r.set_budget);

const progress = (uid: string, month: string) =>
  asUser(db, uid, async () => {
    const { rows } = await db.query<{
      category_id: string | null;
      amount: string | number;
      spent: string | number;
    }>("select category_id, amount, spent from budget_progress($1)", [month]);
    return rows.map((r) => ({ ...r, amount: Number(r.amount), spent: Number(r.spent) }));
  });

describe("budgets", () => {
  it("set_budget creates a budget, then updates the same one", async () => {
    const uid = await createUserWithFixtures(db);
    const food = await categoryId(uid, "Food & Dining");

    const first = await setBudget(uid, food, 50_000);
    const second = await setBudget(uid, food, 80_000);
    expect(second).toBe(first);

    const rows = await asUser(db, uid, async () =>
      (await db.query<{ amount: string }>("select amount from budgets")).rows,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(80_000);
  });

  it("allows one overall budget and keeps it to one row", async () => {
    const uid = await createUserWithFixtures(db);
    const a = await setBudget(uid, null, 300_000);
    const b = await setBudget(uid, null, 350_000);
    expect(b).toBe(a);
    const { rows } = await asUser(db, uid, () =>
      db.query("select 1 from budgets where category_id is null"),
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects an income category and a zero amount", async () => {
    const uid = await createUserWithFixtures(db);
    const salary = await categoryId(uid, "Salary", "income");
    const food = await categoryId(uid, "Food & Dining");
    await expect(setBudget(uid, salary, 10_000)).rejects.toThrow();
    await expect(setBudget(uid, food, 0)).rejects.toThrow();
    await expect(setBudget(uid, food, -5)).rejects.toThrow();
  });

  it("rejects a category that belongs to someone else", async () => {
    const mine = await createUserWithFixtures(db);
    const theirs = await createUserWithFixtures(db);
    const theirFood = await categoryId(theirs, "Food & Dining");
    await expect(setBudget(mine, theirFood, 10_000)).rejects.toThrow();
  });

  it("counts subcategories towards a parent budget, but not the reverse", async () => {
    const uid = await createUserWithFixtures(db);
    const acct = await accountId(uid);
    const food = await categoryId(uid, "Food & Dining");
    const groceries = await categoryId(uid, "Groceries");
    const fees = await categoryId(uid, "Fees & Charges");

    await addTx(uid, { account: acct, amount: 1_000, at: "2026-03-05T10:00:00Z", category: food });
    await addTx(uid, { account: acct, amount: 2_500, at: "2026-03-06T10:00:00Z", category: groceries });
    await addTx(uid, { account: acct, amount: 700, at: "2026-03-07T10:00:00Z", category: fees });

    await setBudget(uid, food, 10_000);
    await setBudget(uid, groceries, 4_000);

    const rows = await progress(uid, "2026-03-15");
    const byCat = Object.fromEntries(rows.map((r) => [r.category_id, r.spent]));
    expect(byCat[food]).toBe(3_500);
    expect(byCat[groceries]).toBe(2_500);
  });

  it("overall budget counts every expense, including uncategorised", async () => {
    const uid = await createUserWithFixtures(db);
    const acct = await accountId(uid);
    const food = await categoryId(uid, "Food & Dining");
    await addTx(uid, { account: acct, amount: 1_000, at: "2026-03-05T10:00:00Z", category: food });
    await addTx(uid, { account: acct, amount: 400, at: "2026-03-06T10:00:00Z" });
    await setBudget(uid, null, 5_000);

    const [overall] = await progress(uid, "2026-03-01");
    expect(overall.category_id).toBeNull();
    expect(overall.spent).toBe(1_400);
  });

  it("ignores income, transfers, deleted rows and other months", async () => {
    const uid = await createUserWithFixtures(db);
    const acct = await accountId(uid);
    const savings = (await asUser(db, uid, () =>
      one<{ id: string }>(
        "insert into accounts (user_id, name, type) values ($1, 'Savings', 'savings') returning id",
        [uid],
      ),
    )).id;
    const salary = await categoryId(uid, "Salary", "income");

    await addTx(uid, { account: acct, amount: 1_000, at: "2026-03-05T10:00:00Z" });
    await addTx(uid, { account: acct, type: "income", amount: 90_000, at: "2026-03-05T10:00:00Z", category: salary });
    await addTx(uid, { account: acct, amount: 5_000, at: "2026-03-06T10:00:00Z", deleted: true });
    await addTx(uid, { account: acct, amount: 6_000, at: "2026-02-28T10:00:00Z" });
    await addTx(uid, { account: acct, amount: 7_000, at: "2026-04-02T10:00:00Z" });
    const group = randomUUID();
    await asUser(db, uid, () =>
      db.query("select create_transfer($1, $2, $3, 20000)", [group, acct, savings]),
    );
    await setBudget(uid, null, 50_000);

    const [overall] = await progress(uid, "2026-03-20");
    expect(overall.spent).toBe(1_000);
  });

  it("starts and ends months at midnight Ghana time", async () => {
    const uid = await createUserWithFixtures(db);
    const acct = await accountId(uid);
    await addTx(uid, { account: acct, amount: 100, at: "2026-03-31T23:59:59Z" });
    await addTx(uid, { account: acct, amount: 200, at: "2026-04-01T00:00:00Z" });
    await setBudget(uid, null, 5_000);

    expect((await progress(uid, "2026-03-10"))[0].spent).toBe(100);
    expect((await progress(uid, "2026-04-10"))[0].spent).toBe(200);
  });

  it("keeps budgets private to their owner", async () => {
    const a = await createUserWithFixtures(db);
    const b = await createUserWithFixtures(db);
    await setBudget(a, null, 9_000);

    expect(await progress(b, "2026-03-01")).toHaveLength(0);
    const { rows } = await asUser(db, b, () => db.query("select 1 from budgets"));
    expect(rows).toHaveLength(0);
    await asUser(db, b, () => db.query("delete from budgets"));
    expect(await progress(a, "2026-03-01")).toHaveLength(1);
  });

  it("is closed to signed-out callers", async () => {
    await expect(
      asAnon(db, () => db.query("select * from budget_progress('2026-03-01')")),
    ).rejects.toThrow();
    await expect(
      asAnon(db, () => db.query("select monthly_report('2026-03-01')")),
    ).rejects.toThrow();
    await expect(
      asAnon(db, () => db.query("select set_budget(null, 100)")),
    ).rejects.toThrow();
  });

  it("writes budget changes to the audit log", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await setBudget(uid, null, 1_000);
    await setBudget(uid, null, 2_000);
    const { rows } = await db.query<{ action: string }>(
      "select action from audit_log where row_id = $1 order by created_at, action desc",
      [id],
    );
    expect(rows.map((r) => r.action).sort()).toEqual(["insert", "update"]);
  });
});

describe("monthly_report", () => {
  const report = (uid: string, month: string) =>
    asUser(db, uid, () =>
      one<{ monthly_report: Record<string, unknown> }>(
        "select monthly_report($1) as monthly_report",
        [month],
      ),
    ).then((r) => r.monthly_report as {
      month: string;
      income: number;
      expense: number;
      count: number;
      prev_income: number;
      prev_expense: number;
      categories: { category_id: string | null; name: string; amount: number; count: number }[];
      daily: { day: string; amount: number }[];
      trend: { month: string; income: number; expense: number }[];
    });

  it("totals the month, compares it with the last and rolls up categories", async () => {
    const uid = await createUserWithFixtures(db);
    const acct = await accountId(uid);
    const food = await categoryId(uid, "Food & Dining");
    const groceries = await categoryId(uid, "Groceries");
    const salary = await categoryId(uid, "Salary", "income");

    await addTx(uid, { account: acct, type: "income", amount: 100_000, at: "2026-03-01T08:00:00Z", category: salary });
    await addTx(uid, { account: acct, amount: 1_000, at: "2026-03-05T10:00:00Z", category: food });
    await addTx(uid, { account: acct, amount: 2_500, at: "2026-03-05T12:00:00Z", category: groceries });
    await addTx(uid, { account: acct, amount: 400, at: "2026-03-20T12:00:00Z" });
    await addTx(uid, { account: acct, type: "income", amount: 80_000, at: "2026-02-01T08:00:00Z", category: salary });
    await addTx(uid, { account: acct, amount: 9_000, at: "2026-02-10T08:00:00Z", category: food });

    const r = await report(uid, "2026-03-18");
    expect(r.month).toBe("2026-03-01");
    expect(r.income).toBe(100_000);
    expect(r.expense).toBe(3_900);
    expect(r.count).toBe(4);
    expect(r.prev_income).toBe(80_000);
    expect(r.prev_expense).toBe(9_000);

    expect(r.categories.map((c) => [c.name, c.amount, c.count])).toEqual([
      ["Food & Dining", 3_500, 2],
      ["Uncategorised", 400, 1],
    ]);
  });

  it("returns one daily entry per day, zero-filled", async () => {
    const uid = await createUserWithFixtures(db);
    const acct = await accountId(uid);
    await addTx(uid, { account: acct, amount: 300, at: "2026-03-05T10:00:00Z" });
    await addTx(uid, { account: acct, amount: 200, at: "2026-03-05T22:00:00Z" });
    await addTx(uid, { account: acct, amount: 50, at: "2026-03-31T23:00:00Z" });

    const r = await report(uid, "2026-03-01");
    expect(r.daily).toHaveLength(31);
    expect(r.daily[0]).toEqual({ day: "2026-03-01", amount: 0 });
    expect(r.daily[4]).toEqual({ day: "2026-03-05", amount: 500 });
    expect(r.daily[30]).toEqual({ day: "2026-03-31", amount: 50 });
  });

  it("returns a six month trend in order, ending on the chosen month", async () => {
    const uid = await createUserWithFixtures(db);
    const acct = await accountId(uid);
    const salary = await categoryId(uid, "Salary", "income");
    await addTx(uid, { account: acct, type: "income", amount: 5_000, at: "2025-12-10T10:00:00Z", category: salary });
    await addTx(uid, { account: acct, amount: 700, at: "2026-03-10T10:00:00Z" });
    await addTx(uid, { account: acct, amount: 999, at: "2025-09-30T10:00:00Z" });

    const r = await report(uid, "2026-03-01");
    expect(r.trend.map((t) => t.month)).toEqual([
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(r.trend[2]).toEqual({ month: "2025-12-01", income: 5_000, expense: 0 });
    expect(r.trend[5]).toEqual({ month: "2026-03-01", income: 0, expense: 700 });
  });

  it("is empty, not an error, for someone with no data", async () => {
    const uid = await createUserWithFixtures(db);
    const r = await report(uid, "2026-03-01");
    expect(r.income).toBe(0);
    expect(r.expense).toBe(0);
    expect(r.categories).toEqual([]);
    expect(r.trend).toHaveLength(6);
  });

  it("only reports on the signed-in user's data", async () => {
    const a = await createUserWithFixtures(db);
    const b = await createUserWithFixtures(db);
    await addTx(a, { account: await accountId(a), amount: 1_234, at: "2026-03-05T10:00:00Z" });
    expect((await report(b, "2026-03-01")).expense).toBe(0);
    expect((await report(a, "2026-03-01")).expense).toBe(1_234);
  });
});
