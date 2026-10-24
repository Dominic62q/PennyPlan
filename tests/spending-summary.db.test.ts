import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUserWithFixtures } from "./helpers/db";

let db: PGlite;
let uid: string;
let other: string;

beforeAll(async () => {
  db = await createTestDb();
  uid = await createUserWithFixtures(db);
  other = await createUserWithFixtures(db);
  await add(uid, "expense", 4500, "2026-10-03T10:00:00Z", "Groceries", "Chop Bar");
  await add(uid, "expense", 2000, "2026-10-03T18:00:00Z", "Food & Dining", "chop bar ");
  await add(uid, "expense", 1500, "2026-10-12T10:00:00Z", "Mobile money fees", null);
  await add(uid, "expense", 9900, "2026-09-20T10:00:00Z", "Groceries", "Melcom");
  await add(uid, "income", 500000, "2026-10-01T09:00:00Z", "Salary", "Employer");
  await add(uid, "expense", 7000, "2026-10-05T10:00:00Z", "Groceries", "Deleted", true);
  await add(other, "expense", 123456, "2026-10-04T10:00:00Z", "Groceries", "Someone else");
});

afterAll(async () => {
  await db.close();
});

async function add(
  user: string,
  type: string,
  amount: number,
  at: string,
  category: string,
  payee: string | null,
  deleted = false,
) {
  await db.query(
    `insert into transactions (user_id, account_id, type, amount, currency, occurred_at, category_id, payee, deleted_at)
     select $1, a.id, $2, $3, 'GHS', $4, c.id, $5, $7
       from accounts a, categories c
      where a.user_id = $1 and a.name = 'Cash' and c.user_id = $1 and c.name = $6`,
    [user, type, amount, at, payee, category, deleted ? new Date().toISOString() : null],
  );
}

type Summary = {
  total: number;
  count: number;
  group_count: number;
  groups: { id: string | null; label: string; amount: number; count: number }[];
};

async function summary(from: string, to: string, type = "expense", group = "category") {
  return asUser(db, uid, async () => {
    const { rows } = await db.query<{ s: Summary }>(
      "select spending_summary($1::date, $2::date, $3, $4) as s",
      [from, to, type, group],
    );
    return rows[0].s;
  });
}

describe("spending_summary", () => {
  it("totals a range and rolls subcategories into their parent", async () => {
    const s = await summary("2026-10-01", "2026-10-31");
    expect(s.total).toBe(8000);
    expect(s.count).toBe(3);
    // Groceries and Food & Dining are one group; the fees category is another.
    expect(s.groups.map((g) => [g.label, g.amount])).toEqual([
      ["Food & Dining", 6500],
      ["Fees & Charges", 1500],
    ]);
  });

  it("keeps subcategories apart on request", async () => {
    const s = await summary("2026-10-01", "2026-10-31", "expense", "subcategory");
    expect(s.groups.map((g) => g.label).sort()).toEqual([
      "Food & Dining",
      "Groceries",
      "Mobile money fees",
    ]);
  });

  it("groups payees ignoring case and spaces, and names the missing one", async () => {
    const s = await summary("2026-10-01", "2026-10-31", "expense", "payee");
    expect(s.groups.map((g) => [g.label.trim().toLowerCase(), g.amount])).toEqual([
      ["chop bar", 6500],
      ["no payee", 1500],
    ]);
  });

  it("groups over time in order, and by month across a boundary", async () => {
    const days = await summary("2026-10-01", "2026-10-31", "expense", "day");
    expect(days.groups.map((g) => g.label)).toEqual(["2026-10-03", "2026-10-12"]);
    const months = await summary("2026-09-01", "2026-10-31", "expense", "month");
    expect(months.groups.map((g) => [g.label, g.amount])).toEqual([
      ["2026-09", 9900],
      ["2026-10", 8000],
    ]);
  });

  it("handles income, empty ranges, and leaves out deleted rows and other people", async () => {
    expect((await summary("2026-10-01", "2026-10-31", "income")).total).toBe(500000);
    const empty = await summary("2025-01-01", "2025-01-31");
    expect(empty).toMatchObject({ total: 0, count: 0, groups: [] });
    expect((await summary("2026-10-01", "2026-10-31")).total).toBe(8000);
  });

  it("includes both end dates", async () => {
    expect((await summary("2026-10-12", "2026-10-12")).total).toBe(1500);
  });
});
