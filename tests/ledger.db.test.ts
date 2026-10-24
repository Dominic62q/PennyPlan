import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  createTestDb,
  createUser as createBareUser,
  createUserWithFixtures,
  migrationStatements,
} from "./helpers/db";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

// --- helpers (run as a signed-in user unless noted) -----------------------

// Most tests need an account and some categories to work with.
const createUser = (database: PGlite) => createUserWithFixtures(database);

type Row = Record<string, unknown>;

async function one<T = Row>(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

const accountId = async (uid: string, name = "Cash") =>
  (await one<{ id: string }>(
    "select id from accounts where user_id = $1 and name = $2",
    [uid, name],
  )).id;

const categoryId = async (uid: string, name: string, kind = "expense") =>
  (await one<{ id: string }>(
    "select id from categories where user_id = $1 and name = $2 and kind = $3",
    [uid, name, kind],
  )).id;

const addAccount = (
  uid: string,
  name: string,
  opts: { type?: string; currency?: string; opening?: number } = {},
) =>
  asUser(db, uid, () =>
    one<{ id: string }>(
      `insert into accounts (user_id, name, type, currency, opening_balance)
       values ($1, $2, $3, $4, $5) returning id`,
      [uid, name, opts.type ?? "bank", opts.currency ?? "GHS", opts.opening ?? 0],
    ),
  ).then((r) => r.id);

function addTx(
  uid: string,
  o: {
    account: string;
    type?: string;
    amount: number;
    currency?: string;
    category?: string | null;
    group?: string | null;
    key?: string | null;
  },
) {
  return asUser(db, uid, () =>
    one<{ id: string }>(
      `insert into transactions
         (user_id, account_id, type, amount, currency, category_id, transfer_group_id, idempotency_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        uid,
        o.account,
        o.type ?? "expense",
        o.amount,
        o.currency ?? "GHS",
        o.category ?? null,
        o.group ?? null,
        o.key ?? null,
      ],
    ),
  ).then((r) => r.id);
}

// Runs several statements in one explicit transaction as `uid`, so deferred
// constraint triggers fire at COMMIT. Always leaves the connection clean.
async function inTransactionAs(uid: string, statements: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  try {
    await db.exec(`set role authenticated; begin; ${statements}; commit;`);
  } finally {
    await db.exec("rollback; reset role;");
    await db.exec("select set_config('request.jwt.claim.sub', '', false)");
  }
}

const balanceOf = async (uid: string, account: string) =>
  Number(
    (await asUser(db, uid, () =>
      one<{ balance: unknown }>(
        "select balance from account_balances where account_id = $1",
        [account],
      ),
    )).balance,
  );

function transfer(
  uid: string,
  o: {
    group?: string;
    from: string;
    to: string;
    out: number;
    in?: number | null;
    fee?: number | null;
    feeCategory?: string | null;
  },
) {
  const group = o.group ?? randomUUID();
  return asUser(db, uid, () =>
    db.query(
      "select create_transfer($1, $2, $3, $4, $5, now(), null, $6, $7)",
      [group, o.from, o.to, o.out, o.in ?? null, o.fee ?? null, o.feeCategory ?? null],
    ),
  ).then(() => group);
}

// --- new users start empty -----------------------------------------------

describe("new users start empty", () => {
  let uid: string;
  beforeAll(async () => {
    uid = await createBareUser(db);
  });

  it("creates no accounts, categories, transactions or history", async () => {
    for (const table of ["accounts", "categories", "transactions", "audit_log"]) {
      const row = await one<{ n: number }>(
        `select count(*)::int as n from ${table} where user_id = $1`,
        [uid],
      );
      expect(row.n, table).toBe(0);
    }
  });

  it("still creates the profile", async () => {
    const row = await one<{ n: number }>(
      "select count(*)::int as n from profiles where user_id = $1",
      [uid],
    );
    expect(row.n).toBe(1);
  });

  it("has no seeding function left to call", async () => {
    const row = await one<{ n: number }>(
      "select count(*)::int as n from pg_proc where proname = 'seed_user_defaults'",
    );
    expect(row.n).toBe(0);
  });

  it("audits the first thing a person creates", async () => {
    const id = randomUUID();
    await db.exec(`
      begin;
      insert into auth.users (id) values ('${id}');
      insert into accounts (user_id, name, type) values ('${id}', 'First', 'bank');
      commit;
    `);
    const rows = await db.query<{ table_name: string }>(
      "select table_name from audit_log where user_id = $1",
      [id],
    );
    expect(rows.rows).toEqual([{ table_name: "accounts" }]);
  });
});

// The part of migration 0005 that clears starter rows created by the old
// seeding. It must only remove rows nobody has used or changed.
describe("clean-up of old starter rows", () => {
  const cleanup = migrationStatements().find((s) => s.startsWith("-- Remove the starter rows") || s.includes("DO $$"));

  it("removes untouched starter rows and keeps anything a person used or changed", async () => {
    expect(cleanup).toBeTruthy();
    const fresh = await createUserWithFixtures(db);
    const used = await createUserWithFixtures(db);
    const edited = await createUserWithFixtures(db);

    await addTx(used, { account: await accountId(used), amount: 500 });
    await db.query(
      "update categories set name = 'Eating out' where user_id = $1 and name = 'Food & Dining'",
      [edited],
    );
    // Make the edit visible to the "never changed" check.
    await db.query(
      "update categories set updated_at = created_at + interval '1 second' where user_id = $1 and name = 'Eating out'",
      [edited],
    );

    await db.exec(cleanup!);

    const count = async (table: string, uid: string) =>
      (await one<{ n: number }>(
        `select count(*)::int as n from ${table} where user_id = $1`,
        [uid],
      )).n;

    expect(await count("accounts", fresh)).toBe(0);
    expect(await count("categories", fresh)).toBe(0);
    // Used: has a transaction, so nothing is removed.
    expect(await count("accounts", used)).toBe(1);
    expect(await count("categories", used)).toBe(5);
    // Edited: only the category the person renamed stays.
    expect(await count("categories", edited)).toBe(1);
    expect(await count("accounts", edited)).toBe(0);
  });
});

// --- isolation ------------------------------------------------------------

describe("row level security on ledger tables", () => {
  let alice: string;
  let bob: string;
  let aliceCash: string;
  let aliceTx: string;

  beforeAll(async () => {
    alice = await createUser(db);
    bob = await createUser(db);
    aliceCash = await accountId(alice);
    aliceTx = await addTx(alice, { account: aliceCash, amount: 1000 });
    await addTx(bob, { account: await accountId(bob), amount: 2000 });
  });

  it.each(["accounts", "categories", "transactions", "audit_log"])(
    "%s: users only see their own rows",
    async (table) => {
      const seen = await asUser(db, bob, () =>
        db.query<{ user_id: string }>(`select user_id from ${table}`),
      );
      expect(seen.rows.length).toBeGreaterThan(0);
      expect(seen.rows.every((r) => r.user_id === bob)).toBe(true);
    },
  );

  it("hides another user's balances", async () => {
    const { rows } = await asUser(db, bob, () =>
      db.query("select * from account_balances where account_id = $1", [aliceCash]),
    );
    expect(rows).toHaveLength(0);
  });

  it("does not let a user change or delete someone else's transaction", async () => {
    const upd = await asUser(db, bob, () =>
      db.query("update transactions set amount = 1 where id = $1", [aliceTx]),
    );
    expect(upd.affectedRows).toBe(0);
    const del = await asUser(db, bob, () =>
      db.query("delete from transactions where id = $1", [aliceTx]),
    );
    expect(del.affectedRows).toBe(0);
  });

  it("does not let a user post to someone else's account", async () => {
    await expect(addTx(bob, { account: aliceCash, amount: 500 })).rejects.toThrow(
      /transactions_account_fk/,
    );
  });

  it("does not let a user use someone else's category", async () => {
    const bobCash = await accountId(bob);
    const aliceFood = await categoryId(alice, "Food & Dining");
    await expect(
      addTx(bob, { account: bobCash, amount: 500, category: aliceFood }),
    ).rejects.toThrow(/transactions_category_fk/);
  });

  it("does not let a user write rows for someone else", async () => {
    await expect(
      asUser(db, bob, () =>
        db.query("insert into accounts (user_id, name, type) values ($1, 'Sneaky', 'cash')", [alice]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("makes the audit log read-only for users", async () => {
    await expect(
      asUser(db, alice, () =>
        db.query(
          "insert into audit_log (user_id, table_name, row_id, action) values ($1, 'x', $2, 'insert')",
          [alice, randomUUID()],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await asUser(db, alice, () =>
      db.query("update audit_log set actor = 'assistant'"),
    );
    expect(upd.affectedRows).toBe(0);
    const del = await asUser(db, alice, () => db.query("delete from audit_log"));
    expect(del.affectedRows).toBe(0);
  });

  it("shows nothing to signed-out visitors", async () => {
    for (const table of ["accounts", "categories", "transactions", "audit_log", "account_balances"]) {
      const { rows } = await asAnon(db, () => db.query(`select * from ${table}`));
      expect(rows, table).toHaveLength(0);
    }
  });

  it("blocks signed-out visitors from creating transfers", async () => {
    await expect(
      asAnon(db, () =>
        db.query("select create_transfer($1, $2, $3, 100)", [randomUUID(), aliceCash, aliceCash]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

// --- constraints ----------------------------------------------------------

describe("data rules", () => {
  let uid: string;
  let cash: string;

  beforeAll(async () => {
    uid = await createUser(db);
    cash = await accountId(uid);
  });

  it.each([0, -5])("rejects an amount of %i", async (amount) => {
    await expect(addTx(uid, { account: cash, amount })).rejects.toThrow(
      /transactions_amount_chk/,
    );
  });

  it("rejects a currency that differs from the account's", async () => {
    await expect(
      addTx(uid, { account: cash, amount: 100, currency: "USD" }),
    ).rejects.toThrow(/transactions_account_fk/);
  });

  it("rejects an expense filed under an income category", async () => {
    const salary = await categoryId(uid, "Salary", "income");
    await expect(
      addTx(uid, { account: cash, amount: 100, type: "expense", category: salary }),
    ).rejects.toThrow(/transactions_category_fk/);
    await expect(
      addTx(uid, {
        account: cash,
        amount: 100,
        type: "income",
        category: await categoryId(uid, "Food & Dining"),
      }),
    ).rejects.toThrow(/transactions_category_fk/);
  });

  it("accepts matching categories and uncategorised rows", async () => {
    await addTx(uid, {
      account: cash,
      amount: 100,
      type: "expense",
      category: await categoryId(uid, "Groceries"),
    });
    await addTx(uid, { account: cash, amount: 100, type: "income" });
    await addTx(uid, { account: cash, amount: 100, type: "expense" });
  });

  it("keeps transfer rows and plain rows apart", async () => {
    await expect(
      addTx(uid, { account: cash, amount: 100, type: "transfer_out" }),
    ).rejects.toThrow(/transactions_transfer_group_chk/);
    await expect(
      addTx(uid, { account: cash, amount: 100, type: "expense", group: randomUUID() }),
    ).rejects.toThrow(/transactions_transfer_group_chk/);
    await expect(
      addTx(uid, {
        account: cash,
        amount: 100,
        type: "transfer_out",
        group: randomUUID(),
        category: await categoryId(uid, "Groceries"),
      }),
    ).rejects.toThrow(/transactions_/);
  });

  it("refuses a repeated idempotency key", async () => {
    const key = randomUUID();
    await addTx(uid, { account: cash, amount: 100, key });
    await expect(addTx(uid, { account: cash, amount: 100, key })).rejects.toThrow(
      /transactions_user_idempotency_uq/,
    );
  });

  it("lets two users use the same idempotency key", async () => {
    const other = await createUser(db);
    const key = randomUUID();
    await addTx(uid, { account: cash, amount: 100, key });
    await addTx(other, { account: await accountId(other), amount: 100, key });
  });

  it("keeps account names unique per user, ignoring case", async () => {
    await expect(addAccount(uid, "cash")).rejects.toThrow(/accounts_user_name_uq/);
    const other = await createUser(db);
    await addAccount(other, "Savings Pot");
  });

  it("rejects bad account details", async () => {
    await expect(addAccount(uid, "X", { type: "piggy" })).rejects.toThrow(/accounts_type_chk/);
    await expect(addAccount(uid, "Y", { currency: "gh" })).rejects.toThrow(/accounts_currency_chk/);
    await expect(addAccount(uid, "   ")).rejects.toThrow(/accounts_name_chk/);
  });

  it("will not delete an account that has transactions", async () => {
    await expect(
      asUser(db, uid, () => db.query("delete from accounts where id = $1", [cash])),
    ).rejects.toThrow(/transactions_account_fk/);
  });

  it("will not delete a category that is in use", async () => {
    await expect(
      asUser(db, uid, async () =>
        db.query("delete from categories where id = $1", [await categoryId(uid, "Groceries")]),
      ),
    ).rejects.toThrow(/transactions_category_fk/);
  });

  describe("category tree", () => {
    it("allows two levels only", async () => {
      const food = await categoryId(uid, "Food & Dining");
      const groceries = await categoryId(uid, "Groceries");
      await expect(
        asUser(db, uid, () =>
          db.query(
            "insert into categories (user_id, name, kind, parent_id) values ($1, 'Deep', 'expense', $2)",
            [uid, groceries],
          ),
        ),
      ).rejects.toThrow(/two levels/);
      await expect(
        asUser(db, uid, () =>
          db.query("update categories set parent_id = $1 where id = $2", [
            groceries,
            food,
          ]),
        ),
      ).rejects.toThrow();
    });

    it("keeps subcategories on the same kind as the parent", async () => {
      const food = await categoryId(uid, "Food & Dining");
      await expect(
        asUser(db, uid, () =>
          db.query(
            "insert into categories (user_id, name, kind, parent_id) values ($1, 'Odd', 'income', $2)",
            [uid, food],
          ),
        ),
      ).rejects.toThrow(/categories_parent_fk/);
    });

    it("rejects duplicate names under the same parent, ignoring case", async () => {
      const food = await categoryId(uid, "Food & Dining");
      await expect(
        asUser(db, uid, () =>
          db.query(
            "insert into categories (user_id, name, kind, parent_id) values ($1, 'GROCERIES', 'expense', $2)",
            [uid, food],
          ),
        ),
      ).rejects.toThrow(/categories_user_kind_parent_name_uq/);
    });
  });

  it("bumps updated_at on a transaction update", async () => {
    const id = await addTx(uid, { account: cash, amount: 100 });
    const before = await one<{ updated_at: Date }>(
      "select updated_at from transactions where id = $1",
      [id],
    );
    await new Promise((r) => setTimeout(r, 20));
    await asUser(db, uid, () =>
      db.query("update transactions set note = 'x' where id = $1", [id]),
    );
    const after = await one<{ updated_at: Date }>(
      "select updated_at from transactions where id = $1",
      [id],
    );
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });
});

// --- balances -------------------------------------------------------------

describe("derived balances", () => {
  it("is the opening balance plus income minus expenses", async () => {
    const uid = await createUser(db);
    const acct = await addAccount(uid, "Bank", { opening: 10_000 });
    expect(await balanceOf(uid, acct)).toBe(10_000);

    await addTx(uid, { account: acct, type: "income", amount: 5_000 });
    const expense = await addTx(uid, { account: acct, type: "expense", amount: 2_000 });
    expect(await balanceOf(uid, acct)).toBe(13_000);

    await asUser(db, uid, () =>
      db.query("update transactions set deleted_at = now() where id = $1", [expense]),
    );
    expect(await balanceOf(uid, acct)).toBe(15_000);

    await asUser(db, uid, () =>
      db.query("update transactions set deleted_at = null where id = $1", [expense]),
    );
    expect(await balanceOf(uid, acct)).toBe(13_000);
  });

  it("can go negative (credit cards, overdrafts)", async () => {
    const uid = await createUser(db);
    const card = await addAccount(uid, "Card", { type: "credit_card" });
    await addTx(uid, { account: card, amount: 7_500 });
    expect(await balanceOf(uid, card)).toBe(-7_500);
  });

  it("reports a count of live transactions", async () => {
    const uid = await createUser(db);
    const acct = await addAccount(uid, "Counted");
    await addTx(uid, { account: acct, amount: 100 });
    const gone = await addTx(uid, { account: acct, amount: 100 });
    await asUser(db, uid, () =>
      db.query("update transactions set deleted_at = now() where id = $1", [gone]),
    );
    const row = await asUser(db, uid, () =>
      one<{ transaction_count: number }>(
        "select transaction_count from account_balances where account_id = $1",
        [acct],
      ),
    );
    expect(row.transaction_count).toBe(1);
  });
});

// --- transfers ------------------------------------------------------------

describe("transfers", () => {
  let uid: string;
  let momo: string;
  let bank: string;

  beforeAll(async () => {
    uid = await createUser(db);
    momo = await addAccount(uid, "MoMo", { type: "mobile_money", opening: 100_000 });
    bank = await addAccount(uid, "Bank", { opening: 0 });
  });

  it("moves money between two accounts", async () => {
    await transfer(uid, { from: momo, to: bank, out: 30_000 });
    expect(await balanceOf(uid, momo)).toBe(70_000);
    expect(await balanceOf(uid, bank)).toBe(30_000);
  });

  it("is safe to retry with the same group id", async () => {
    const group = randomUUID();
    await transfer(uid, { group, from: momo, to: bank, out: 1_000 });
    await transfer(uid, { group, from: momo, to: bank, out: 1_000 });
    const n = await one<{ n: number }>(
      "select count(*)::int as n from transactions where transfer_group_id = $1",
      [group],
    );
    expect(n.n).toBe(2);
  });

  it("records a fee as its own expense on the source account", async () => {
    const before = await balanceOf(uid, momo);
    const feeCategory = await categoryId(uid, "Mobile money fees");
    const group = await transfer(uid, {
      from: momo,
      to: bank,
      out: 10_000,
      fee: 150,
      feeCategory,
    });
    expect(await balanceOf(uid, momo)).toBe(before - 10_000 - 150);
    const fee = await one<{ amount: unknown; type: string; category_id: string }>(
      "select amount, type, category_id from transactions where idempotency_key = $1",
      [`${group}:fee`],
    );
    expect(Number(fee.amount)).toBe(150);
    expect(fee.type).toBe("expense");
    expect(fee.category_id).toBe(feeCategory);
  });

  it("rejects transfers that do not make sense", async () => {
    await expect(transfer(uid, { from: momo, to: momo, out: 100 })).rejects.toThrow(
      /two different accounts/,
    );
    await expect(
      transfer(uid, { from: momo, to: bank, out: 100, in: 99 }),
    ).rejects.toThrow(/must match/);
    await expect(transfer(uid, { from: momo, to: bank, out: 0 })).rejects.toThrow(
      /transactions_amount_chk/,
    );
  });

  it("needs the received amount when currencies differ", async () => {
    const usd = await addAccount(uid, "Dollars", { currency: "USD" });
    await expect(transfer(uid, { from: momo, to: usd, out: 1_000 })).rejects.toThrow(
      /amount received/,
    );
    const before = await balanceOf(uid, usd);
    await transfer(uid, { from: momo, to: usd, out: 15_000, in: 1_000 });
    expect(await balanceOf(uid, usd)).toBe(before + 1_000);
  });

  it("will not use another user's account", async () => {
    const other = await createUser(db);
    const theirs = await accountId(other);
    await expect(transfer(uid, { from: momo, to: theirs, out: 100 })).rejects.toThrow(
      /Account not found/,
    );
    await expect(transfer(other, { from: theirs, to: momo, out: 100 })).rejects.toThrow(
      /Account not found/,
    );
  });

  it("deletes and restores both sides together", async () => {
    const m0 = await balanceOf(uid, momo);
    const b0 = await balanceOf(uid, bank);
    const group = await transfer(uid, { from: momo, to: bank, out: 5_000, fee: 100 });
    expect(await balanceOf(uid, momo)).toBe(m0 - 5_100);

    await asUser(db, uid, () => db.query("select set_transfer_deleted($1, true)", [group]));
    expect(await balanceOf(uid, momo)).toBe(m0);
    expect(await balanceOf(uid, bank)).toBe(b0);

    await asUser(db, uid, () => db.query("select set_transfer_deleted($1, false)", [group]));
    expect(await balanceOf(uid, momo)).toBe(m0 - 5_100);
    expect(await balanceOf(uid, bank)).toBe(b0 + 5_000);
  });

  describe("pairing rules", () => {
    it("rejects half a transfer", async () => {
      await expect(
        addTx(uid, {
          account: momo,
          type: "transfer_out",
          amount: 100,
          group: randomUUID(),
        }),
      ).rejects.toThrow(/one outgoing and one incoming/);
    });

    it("rejects two outgoing sides", async () => {
      const group = randomUUID();
      await expect(
        inTransactionAs(
          uid,
          `insert into transactions (user_id, account_id, type, amount, currency, transfer_group_id)
             values ('${uid}', '${momo}', 'transfer_out', 100, 'GHS', '${group}'),
                    ('${uid}', '${bank}', 'transfer_out', 100, 'GHS', '${group}')`,
        ),
      ).rejects.toThrow(/one outgoing and one incoming/);
    });

    it("accepts a correctly paired transfer written by hand", async () => {
      const group = randomUUID();
      await inTransactionAs(
        uid,
        `insert into transactions (user_id, account_id, type, amount, currency, transfer_group_id)
           values ('${uid}', '${momo}', 'transfer_out', 100, 'GHS', '${group}'),
                  ('${uid}', '${bank}', 'transfer_in', 100, 'GHS', '${group}')`,
      );
      const n = await one<{ n: number }>(
        "select count(*)::int as n from transactions where transfer_group_id = $1",
        [group],
      );
      expect(n.n).toBe(2);
    });

    it("rejects both sides on the same account", async () => {
      const group = randomUUID();
      await expect(
        inTransactionAs(
          uid,
          `insert into transactions (user_id, account_id, type, amount, currency, transfer_group_id)
             values ('${uid}', '${momo}', 'transfer_out', 100, 'GHS', '${group}'),
                    ('${uid}', '${momo}', 'transfer_in', 100, 'GHS', '${group}')`,
        ),
      ).rejects.toThrow(/different accounts/);
    });

    it("rejects deleting only one side", async () => {
      const group = await transfer(uid, { from: momo, to: bank, out: 100 });
      await expect(
        asUser(db, uid, () =>
          db.query(
            "update transactions set deleted_at = now() where transfer_group_id = $1 and type = 'transfer_out'",
            [group],
          ),
        ),
      ).rejects.toThrow(/deleted or restored together/);
    });

    it("rejects hard-deleting only one side but allows removing both", async () => {
      const group = await transfer(uid, { from: momo, to: bank, out: 100 });
      await expect(
        asUser(db, uid, () =>
          db.query(
            "delete from transactions where transfer_group_id = $1 and type = 'transfer_in'",
            [group],
          ),
        ),
      ).rejects.toThrow(/one outgoing and one incoming/);

      await asUser(db, uid, () =>
        db.query("delete from transactions where transfer_group_id = $1", [group]),
      );
      const n = await one<{ n: number }>(
        "select count(*)::int as n from transactions where transfer_group_id = $1",
        [group],
      );
      expect(n.n).toBe(0);
    });

    it("rejects moving one side into another group", async () => {
      const g1 = await transfer(uid, { from: momo, to: bank, out: 100 });
      const g2 = await transfer(uid, { from: momo, to: bank, out: 100 });
      await expect(
        asUser(db, uid, () =>
          db.query(
            "update transactions set transfer_group_id = $1 where transfer_group_id = $2 and type = 'transfer_in'",
            [g1, g2],
          ),
        ),
      ).rejects.toThrow(/one outgoing and one incoming/);
    });
  });
});

// --- audit log ------------------------------------------------------------

describe("audit log", () => {
  let uid: string;
  let cash: string;

  const history = (row: string) =>
    asUser(db, uid, () =>
      db.query<{ action: string; actor: string; before: Row | null; after: Row | null }>(
        "select action, actor, before, after from audit_log where row_id = $1 order by created_at, id",
        [row],
      ),
    ).then((r) => r.rows);

  beforeAll(async () => {
    uid = await createUser(db);
    cash = await accountId(uid);
  });

  it("records insert, update and delete with before and after", async () => {
    const id = await addTx(uid, { account: cash, amount: 4_500 });
    await asUser(db, uid, () =>
      db.query("update transactions set amount = 5_200, note = 'fixed' where id = $1", [id]),
    );
    await asUser(db, uid, () => db.query("delete from transactions where id = $1", [id]));

    const rows = await history(id);
    expect(rows.map((r) => r.action)).toEqual(["insert", "update", "delete"]);
    expect(rows[0].before).toBeNull();
    expect(Number(rows[0].after?.amount)).toBe(4_500);
    expect(Number(rows[1].before?.amount)).toBe(4_500);
    expect(Number(rows[1].after?.amount)).toBe(5_200);
    expect(rows[2].after).toBeNull();
    expect(Number(rows[2].before?.amount)).toBe(5_200);
  });

  it("records who made the change", async () => {
    const id = await addTx(uid, { account: cash, amount: 100 });
    await asUser(db, uid, async () => {
      await db.exec("select set_config('app.actor', 'assistant', false)");
      try {
        await db.query("update transactions set note = 'by assistant' where id = $1", [id]);
      } finally {
        await db.exec("select set_config('app.actor', '', false)");
      }
    });
    const rows = await history(id);
    expect(rows.map((r) => r.actor)).toEqual(["user", "assistant"]);
  });

  it("refuses an unknown actor", async () => {
    const id = await addTx(uid, { account: cash, amount: 100 });
    await expect(
      asUser(db, uid, async () => {
        await db.exec("select set_config('app.actor', 'hacker', false)");
        try {
          await db.query("update transactions set note = 'x' where id = $1", [id]);
        } finally {
          await db.exec("select set_config('app.actor', '', false)");
        }
      }),
    ).rejects.toThrow(/audit_log_actor_chk/);
  });

  it("captures a soft delete as an update that can be undone", async () => {
    const id = await addTx(uid, { account: cash, amount: 100 });
    await asUser(db, uid, () =>
      db.query("update transactions set deleted_at = now() where id = $1", [id]),
    );
    const rows = await history(id);
    const last = rows[rows.length - 1];
    expect(last.before?.deleted_at).toBeNull();
    expect(last.after?.deleted_at).not.toBeNull();
  });

  it("does not block deleting an account with its history", async () => {
    const leaving = await createUser(db);
    const acct = await accountId(leaving);
    await addTx(leaving, { account: acct, amount: 100 });
    await db.query("delete from auth.users where id = $1", [leaving]);
    for (const table of ["accounts", "categories", "transactions", "audit_log"]) {
      const n = await one<{ n: number }>(
        `select count(*)::int as n from ${table} where user_id = $1`,
        [leaving],
      );
      expect(n.n, table).toBe(0);
    }
  });
});
