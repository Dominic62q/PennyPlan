import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUserWithFixtures } from "./helpers/db";

let db: PGlite;
let uid: string;
let other: string;
let cash: string;
let groceries: string;
let salary: string;

beforeAll(async () => {
  db = await createTestDb();
  uid = await createUserWithFixtures(db);
  other = await createUserWithFixtures(db);
  const one = async (sql: string, user: string) =>
    (await db.query<{ id: string }>(sql, [user])).rows[0].id;
  cash = await one("select id from accounts where user_id = $1", uid);
  groceries = await one("select id from categories where user_id = $1 and name = 'Groceries'", uid);
  salary = await one("select id from categories where user_id = $1 and name = 'Salary'", uid);
});

afterAll(async () => {
  await db.close();
});

type Result = { id: string; undo_token: string };

const add = (id: string, o: { type?: string; amount?: number; category?: string | null; payee?: string | null } = {}, user = uid) =>
  asUser(db, user, async () => {
    const { rows } = await db.query<{ r: Result }>(
      "select assistant_add_transaction($1, $2, $3, $4, $5, $6, $7, null) as r",
      [id, cash, o.type ?? "expense", o.amount ?? 4500, "2026-10-23T10:00:00Z", o.category ?? null, o.payee ?? "Chop Bar"],
    );
    return rows[0].r;
  });

const update = (id: string, patch: Record<string, unknown>) =>
  asUser(db, uid, async () => {
    const { rows } = await db.query<{ r: Result }>(
      "select assistant_update_transaction($1, $2::jsonb) as r",
      [id, JSON.stringify(patch)],
    );
    return rows[0].r;
  });

const undo = (token: string, user = uid) =>
  asUser(db, user, () => db.query("select assistant_undo($1)", [token]));

const row = async (id: string) =>
  (await db.query<Record<string, unknown>>("select * from transactions where id = $1", [id])).rows[0];

describe("assistant_add_transaction", () => {
  it("adds the row as the assistant and hands back a token for its audit entry", async () => {
    const id = randomUUID();
    const result = await add(id, { category: groceries });
    expect(result.id).toBe(id);
    expect(await row(id)).toMatchObject({ amount: 4500, currency: "GHS", source: "assistant", payee: "Chop Bar" });
    const { rows } = await db.query<{ id: string; actor: string; action: string }>(
      "select id, actor, action from audit_log where row_id = $1",
      [id],
    );
    expect(rows).toEqual([{ id: result.undo_token, actor: "assistant", action: "insert" }]);
  });

  it("lands a retry on the same row", async () => {
    const id = randomUUID();
    const first = await add(id);
    const second = await add(id);
    expect(second.undo_token).toBe(first.undo_token);
    const { rows } = await db.query("select 1 from transactions where id = $1", [id]);
    expect(rows).toHaveLength(1);
  });

  it("refuses accounts that aren't the person's and categories of the wrong kind", async () => {
    const id = randomUUID();
    await expect(add(id, {}, other)).rejects.toThrow(/account was not found/);
    await expect(add(id, { type: "income", category: groceries })).rejects.toThrow();
    await expect(add(id, { type: "transfer_out" })).rejects.toThrow(/Only expenses and income/);
    await expect(add(id, { amount: 0 })).rejects.toThrow();
    expect(await row(id)).toBeUndefined();
  });
});

describe("assistant_update_transaction", () => {
  it("changes only the named fields and can clear one", async () => {
    const id = randomUUID();
    await add(id, { category: groceries, payee: "Melcom" });
    const result = await update(id, { amount: 5000, category_id: null });
    expect(await row(id)).toMatchObject({ amount: 5000, category_id: null, payee: "Melcom" });
    const { rows } = await db.query<{ actor: string }>("select actor from audit_log where id = $1", [result.undo_token]);
    expect(rows[0].actor).toBe("assistant");
  });

  it("rejects unknown fields, empty patches, other people's rows and bad categories", async () => {
    const id = randomUUID();
    await add(id, { category: groceries });
    await expect(update(id, { deleted_at: null })).rejects.toThrow(/can't be changed/);
    await expect(update(id, {})).rejects.toThrow(/Nothing to change/);
    await expect(update(randomUUID(), { amount: 1 })).rejects.toThrow(/not found/);
    await expect(update(id, { category_id: salary })).rejects.toThrow();
    expect(await row(id)).toMatchObject({ amount: 4500 });
  });
});

describe("assistant_undo", () => {
  it("hides an added transaction again", async () => {
    const id = randomUUID();
    const { undo_token } = await add(id);
    await undo(undo_token);
    expect((await row(id)).deleted_at).not.toBeNull();
  });

  it("puts an edited transaction back as it was", async () => {
    const id = randomUUID();
    await add(id, { category: groceries, payee: "Melcom", amount: 4500 });
    const { undo_token } = await update(id, { amount: 9900, payee: "KFC", category_id: null });
    await undo(undo_token);
    expect(await row(id)).toMatchObject({ amount: 4500, payee: "Melcom", category_id: groceries, deleted_at: null });
  });

  it("won't overwrite a change made since, and can't be used twice", async () => {
    const id = randomUUID();
    const { undo_token } = await add(id);
    await asUser(db, uid, () => db.query("update transactions set note = 'edited by hand' where id = $1", [id]));
    await expect(undo(undo_token)).rejects.toThrow(/changed since/);
    expect((await row(id)).deleted_at).toBeNull();

    const id2 = randomUUID();
    const second = await add(id2);
    await undo(second.undo_token);
    await expect(undo(second.undo_token)).rejects.toThrow(/changed since/);
  });

  it("only works on the person's own assistant changes", async () => {
    const id = randomUUID();
    const { undo_token } = await add(id);
    await expect(undo(undo_token, other)).rejects.toThrow(/nothing to undo/);
    await expect(undo(randomUUID())).rejects.toThrow(/nothing to undo/);
    // A change the person made themselves has no assistant token.
    const { rows } = await db.query<{ id: string }>(
      `insert into transactions (user_id, account_id, type, amount, currency)
       values ($1, $2, 'expense', 100, 'GHS') returning id`,
      [uid, cash],
    );
    const audit = await db.query<{ id: string }>("select id from audit_log where row_id = $1", [rows[0].id]);
    await expect(undo(audit.rows[0].id)).rejects.toThrow(/nothing to undo/);
  });
});

describe("assistant_delete_transactions", () => {
  const remove = (ids: string[], user = uid) =>
    asUser(db, user, async () => {
      const { rows } = await db.query<{ r: { count: number; undo_tokens: string[] } }>(
        "select assistant_delete_transactions($1::uuid[]) as r",
        [ids],
      );
      return rows[0].r;
    });

  it("hides the rows, gives a token for each, and undo brings them back", async () => {
    const a = randomUUID();
    const b = randomUUID();
    await add(a);
    await add(b);
    const result = await remove([a, b]);
    expect(result.count).toBe(2);
    expect(result.undo_tokens).toHaveLength(2);
    expect((await row(a)).deleted_at).not.toBeNull();
    for (const token of result.undo_tokens) await undo(token);
    expect((await row(a)).deleted_at).toBeNull();
    expect((await row(b)).deleted_at).toBeNull();
  });

  it("only touches the person's own live, non-transfer rows", async () => {
    const mine = randomUUID();
    await add(mine);
    expect((await remove([mine], other)).count).toBe(0);
    expect((await row(mine)).deleted_at).toBeNull();
    expect((await remove([mine])).count).toBe(1);
    expect((await remove([mine])).count).toBe(0);
    await expect(remove([])).rejects.toThrow(/Nothing to delete/);
    await expect(remove(Array.from({ length: 21 }, () => randomUUID()))).rejects.toThrow(/too many/);
  });
});
