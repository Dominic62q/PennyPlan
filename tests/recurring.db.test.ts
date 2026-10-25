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

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

const accountId = async (uid: string) =>
  (await one<{ id: string }>("select id from accounts where user_id = $1 and name = 'Cash'", [uid])).id;

const categoryId = async (uid: string, name: string, kind = "expense") =>
  (await one<{ id: string }>(
    "select id from categories where user_id = $1 and name = $2 and kind = $3",
    [uid, name, kind],
  )).id;

type RuleOptions = {
  kind?: string;
  name?: string;
  amount?: number;
  category?: string | null;
  frequency?: string;
  every?: number;
  due: string;
  end?: string | null;
  auto?: boolean;
  paused?: boolean;
};

// Inserts the way the app does: the anchor day is the day of the first due date.
async function addRule(uid: string, o: RuleOptions) {
  const account = await accountId(uid);
  return asUser(db, uid, () =>
    one<{ id: string }>(
      `insert into recurring_rules
         (user_id, kind, name, amount, currency, account_id, category_id, frequency,
          repeat_every, anchor_day, next_due, end_date, auto_post, paused_at)
       values ($1, $2, $3, $4, 'GHS', $5, $6, $7, $8, extract(day from $9::date), $9, $10, $11, $12)
       returning id`,
      [
        uid,
        o.kind ?? "expense",
        o.name ?? "Rent",
        o.amount ?? 150_000,
        account,
        o.category ?? null,
        o.frequency ?? "monthly",
        o.every ?? 1,
        o.due,
        o.end ?? null,
        o.auto ?? false,
        o.paused ? new Date().toISOString() : null,
      ],
    ),
  ).then((r) => r.id);
}

const postDue = (uid: string, today: string) =>
  asUser(db, uid, () =>
    one<{ post_due_recurring: number }>("select post_due_recurring($1::date)", [today]),
  ).then((r) => r.post_due_recurring);

const ruleDue = (uid: string, id: string) =>
  asUser(db, uid, () =>
    one<{ next_due: string }>("select to_char(next_due, 'YYYY-MM-DD') as next_due from recurring_rules where id = $1", [id]),
  ).then((r) => r.next_due);

const recurringTx = (uid: string) =>
  asUser(db, uid, async () =>
    (await db.query<{
      amount: string;
      type: string;
      source: string;
      payee: string;
      day: string;
    }>(
      `select amount, type, source, payee,
              to_char(occurred_at at time zone 'Africa/Accra', 'YYYY-MM-DD') as day
         from transactions where source = 'recurring' order by occurred_at`,
    )).rows,
  );

describe("recurring_advance", () => {
  const advance = (due: string, freq: string, every: number, anchor: number) =>
    one<{ d: string }>(
      "select to_char(recurring_advance($1::date, $2, $3, $4), 'YYYY-MM-DD') as d",
      [due, freq, every, anchor],
    ).then((r) => r.d);

  it("adds whole weeks", async () => {
    expect(await advance("2026-03-06", "weekly", 1, 6)).toBe("2026-03-13");
    expect(await advance("2026-03-06", "weekly", 2, 6)).toBe("2026-03-20");
  });

  it("adds months, clamping to short months and recovering the anchor day", async () => {
    expect(await advance("2026-01-31", "monthly", 1, 31)).toBe("2026-02-28");
    expect(await advance("2026-02-28", "monthly", 1, 31)).toBe("2026-03-31");
    expect(await advance("2026-03-31", "monthly", 1, 31)).toBe("2026-04-30");
    expect(await advance("2028-01-31", "monthly", 1, 31)).toBe("2028-02-29");
    expect(await advance("2026-10-15", "monthly", 3, 15)).toBe("2027-01-15");
  });

  it("adds years, keeping 29 February to leap years", async () => {
    expect(await advance("2026-05-10", "yearly", 1, 10)).toBe("2027-05-10");
    expect(await advance("2028-02-29", "yearly", 1, 29)).toBe("2029-02-28");
    expect(await advance("2031-02-28", "yearly", 1, 29)).toBe("2032-02-29");
  });
});

describe("post_due_recurring", () => {
  it("posts every missed occurrence, dated on its due day, and moves the rule on", async () => {
    const uid = await createUserWithFixtures(db);
    const rent = await categoryId(uid, "Food & Dining");
    const id = await addRule(uid, { due: "2026-01-31", auto: true, category: rent });

    expect(await postDue(uid, "2026-04-02")).toBe(3);
    const rows = await recurringTx(uid);
    expect(rows.map((r) => r.day)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(rows.every((r) => r.type === "expense" && r.payee === "Rent")).toBe(true);
    expect(Number(rows[0].amount)).toBe(150_000);
    expect(await ruleDue(uid, id)).toBe("2026-04-30");
  });

  it("is safe to run again", async () => {
    const uid = await createUserWithFixtures(db);
    await addRule(uid, { due: "2026-03-01", auto: true });
    expect(await postDue(uid, "2026-03-01")).toBe(1);
    expect(await postDue(uid, "2026-03-01")).toBe(0);
    expect(await postDue(uid, "2026-03-20")).toBe(0);
    expect(await recurringTx(uid)).toHaveLength(1);
  });

  it("posts income as income", async () => {
    const uid = await createUserWithFixtures(db);
    const salary = await categoryId(uid, "Salary", "income");
    await addRule(uid, { kind: "income", name: "Salary", amount: 400_000, category: salary, due: "2026-03-25", auto: true });
    expect(await postDue(uid, "2026-03-25")).toBe(1);
    const [row] = await recurringTx(uid);
    expect(row.type).toBe("income");
    expect(Number(row.amount)).toBe(400_000);
  });

  it("leaves bills that need a tap, paused rules and future dates alone", async () => {
    const uid = await createUserWithFixtures(db);
    await addRule(uid, { due: "2026-03-01", auto: false });
    await addRule(uid, { due: "2026-03-01", auto: true, paused: true });
    await addRule(uid, { due: "2026-03-10", auto: true });
    expect(await postDue(uid, "2026-03-05")).toBe(0);
  });

  it("stops at the end date", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await addRule(uid, { due: "2026-01-10", auto: true, end: "2026-02-15" });
    expect(await postDue(uid, "2026-06-01")).toBe(2);
    expect(await ruleDue(uid, id)).toBe("2026-03-10");
    expect(await postDue(uid, "2026-09-01")).toBe(0);
  });

  it("only touches the signed-in user's rules", async () => {
    const a = await createUserWithFixtures(db);
    const b = await createUserWithFixtures(db);
    await addRule(a, { due: "2026-03-01", auto: true });
    expect(await postDue(b, "2026-03-05")).toBe(0);
    expect(await recurringTx(a)).toHaveLength(0);
    expect(await postDue(a, "2026-03-05")).toBe(1);
  });
});

describe("pay_recurring and skip_recurring", () => {
  const pay = (uid: string, id: string, due: string, amount: number | null = null) =>
    asUser(db, uid, () =>
      one<{ pay_recurring: string | null }>("select pay_recurring($1, $2::date, $3)", [id, due, amount]),
    ).then((r) => r.pay_recurring);

  it("posts the bill and moves to the next one", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await addRule(uid, { due: "2026-03-15", amount: 18_000, name: "ECG" });
    expect(await pay(uid, id, "2026-03-15")).toBeTruthy();
    expect(await ruleDue(uid, id)).toBe("2026-04-15");
    const [row] = await recurringTx(uid);
    expect(Number(row.amount)).toBe(18_000);
    expect(row.payee).toBe("ECG");
  });

  it("uses the amount actually paid when it differs", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await addRule(uid, { due: "2026-03-15", amount: 18_000 });
    await pay(uid, id, "2026-03-15", 21_350);
    expect(Number((await recurringTx(uid))[0].amount)).toBe(21_350);
  });

  it("dates a late payment on the day it was made, for the original due date", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await addRule(uid, { due: "2026-03-15", amount: 18_000 });
    const late = await asUser(db, uid, () =>
      one<{ pay_recurring: string | null }>(
        "select pay_recurring($1, $2::date, null, $3::timestamptz)",
        [id, "2026-03-15", "2026-03-18T12:00:00Z"],
      ),
    );
    expect(late.pay_recurring).toBeTruthy();
    expect((await recurringTx(uid))[0].day).toBe("2026-03-18");
    expect(await ruleDue(uid, id)).toBe("2026-04-15");
  });

  it("refuses a payment dated in the future", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await addRule(uid, { due: "2026-03-15" });
    await expect(
      asUser(db, uid, () =>
        one("select pay_recurring($1, $2::date, null, now() + interval '5 days')", [id, "2026-03-15"]),
      ),
    ).rejects.toThrow(/today or an earlier day/i);
    expect(await ruleDue(uid, id)).toBe("2026-03-15");
  });

  it("does nothing the second time for the same due date", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await addRule(uid, { due: "2026-03-15" });
    await pay(uid, id, "2026-03-15");
    expect(await pay(uid, id, "2026-03-15")).toBeNull();
    expect(await recurringTx(uid)).toHaveLength(1);
    expect(await ruleDue(uid, id)).toBe("2026-04-15");
  });

  it("rejects a zero amount", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await addRule(uid, { due: "2026-03-15" });
    await expect(pay(uid, id, "2026-03-15", 0)).rejects.toThrow();
    expect(await ruleDue(uid, id)).toBe("2026-03-15");
  });

  it("skips an occurrence without recording anything", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await addRule(uid, { due: "2026-03-15" });
    const skipped = await asUser(db, uid, () =>
      one<{ skip_recurring: boolean }>("select skip_recurring($1, '2026-03-15'::date)", [id]),
    );
    expect(skipped.skip_recurring).toBe(true);
    expect(await ruleDue(uid, id)).toBe("2026-04-15");
    expect(await recurringTx(uid)).toHaveLength(0);
  });

  it("cannot be used on someone else's rule", async () => {
    const mine = await createUserWithFixtures(db);
    const theirs = await createUserWithFixtures(db);
    const id = await addRule(theirs, { due: "2026-03-15" });
    await expect(pay(mine, id, "2026-03-15")).rejects.toThrow();
    await expect(
      asUser(db, mine, () => db.query("select skip_recurring($1, '2026-03-15'::date)", [id])),
    ).rejects.toThrow();
  });
});

describe("recurring_rules table", () => {
  it("rejects bad frequencies, amounts and mismatched categories", async () => {
    const uid = await createUserWithFixtures(db);
    const salary = await categoryId(uid, "Salary", "income");
    await expect(addRule(uid, { due: "2026-03-01", frequency: "daily" })).rejects.toThrow();
    await expect(addRule(uid, { due: "2026-03-01", amount: 0 })).rejects.toThrow();
    await expect(addRule(uid, { due: "2026-03-01", every: 13 })).rejects.toThrow();
    // An expense rule cannot use an income category.
    await expect(addRule(uid, { due: "2026-03-01", category: salary })).rejects.toThrow();
  });

  it("keeps rules private and closed to signed-out callers", async () => {
    const a = await createUserWithFixtures(db);
    const b = await createUserWithFixtures(db);
    await addRule(a, { due: "2026-03-01" });
    const { rows } = await asUser(db, b, () => db.query("select 1 from recurring_rules"));
    expect(rows).toHaveLength(0);
    await asUser(db, b, () => db.query("delete from recurring_rules"));
    expect((await asUser(db, a, () => db.query("select 1 from recurring_rules"))).rows).toHaveLength(1);

    await expect(asAnon(db, () => db.query("select post_due_recurring()"))).rejects.toThrow();
    // Row security leaves a signed-out caller with no rows at all.
    expect((await asAnon(db, () => db.query("select * from recurring_rules"))).rows).toHaveLength(0);
  });

  it("writes rule changes to the audit log", async () => {
    const uid = await createUserWithFixtures(db);
    const id = await addRule(uid, { due: "2026-03-01" });
    await asUser(db, uid, () => db.query("update recurring_rules set amount = 200000 where id = $1", [id]));
    const { rows } = await db.query<{ action: string }>(
      "select action from audit_log where row_id = $1",
      [id],
    );
    expect(rows.map((r) => r.action).sort()).toEqual(["insert", "update"]);
  });
});
