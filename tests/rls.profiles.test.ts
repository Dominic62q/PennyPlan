import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser } from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, { display_name: "Alice" });
  bob = await createUser(db);
});

afterAll(async () => {
  await db.close();
});

describe("schema guard", () => {
  it("has row level security and a policy on every public table", async () => {
    const { rows } = await db.query<{ name: string; rls: boolean; policies: number }>(
      `select c.relname as name,
              c.relrowsecurity as rls,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.rls, `${row.name} must enable RLS`).toBe(true);
      // assistant_usage is for the server only: RLS on, no policy and no grants
      // (checked in assistant-usage.db.test.ts), so the API roles see nothing.
      if (row.name === "assistant_usage") continue;
      expect(row.policies, `${row.name} needs a policy`).toBeGreaterThan(0);
    }
  });

  it("does not let API roles call handle_new_user", async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      "select has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') as ok",
    );
    expect(rows[0].ok).toBe(false);
  });
});

describe("profile creation", () => {
  it("creates a profile with Ghana defaults when a user signs up", async () => {
    const { rows } = await db.query<Record<string, unknown>>(
      "select * from profiles where user_id = $1",
      [alice],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      display_name: "Alice",
      base_currency: "GHS",
      locale: "en-GH",
      timezone: "Africa/Accra",
      week_start: 1,
      month_start_day: 1,
    });
  });

  it("removes the profile when the auth user is deleted", async () => {
    const temp = await createUser(db);
    await db.query("delete from auth.users where id = $1", [temp]);
    const { rows } = await db.query("select 1 from profiles where user_id = $1", [temp]);
    expect(rows).toHaveLength(0);
  });
});

describe("row level security", () => {
  it("lets each user read only their own profile", async () => {
    const seenByAlice = await asUser(db, alice, () =>
      db.query<{ user_id: string }>("select user_id from profiles"),
    );
    expect(seenByAlice.rows.map((r) => r.user_id)).toEqual([alice]);

    const seenByBob = await asUser(db, bob, () =>
      db.query<{ user_id: string }>("select user_id from profiles"),
    );
    expect(seenByBob.rows.map((r) => r.user_id)).toEqual([bob]);
  });

  it("hides another user's profile even when asked for it by id", async () => {
    const { rows } = await asUser(db, alice, () =>
      db.query("select * from profiles where user_id = $1", [bob]),
    );
    expect(rows).toHaveLength(0);
  });

  it("lets a user update their own profile", async () => {
    const result = await asUser(db, alice, () =>
      db.query("update profiles set display_name = 'Alice A.' where user_id = $1", [alice]),
    );
    expect(result.affectedRows).toBe(1);
  });

  it("does not let a user update someone else's profile", async () => {
    const result = await asUser(db, alice, () =>
      db.query("update profiles set display_name = 'hacked' where user_id = $1", [bob]),
    );
    expect(result.affectedRows).toBe(0);
    const { rows } = await db.query<{ display_name: string | null }>(
      "select display_name from profiles where user_id = $1",
      [bob],
    );
    expect(rows[0].display_name).not.toBe("hacked");
  });

  it("does not let a user hand their profile to someone else", async () => {
    await expect(
      asUser(db, alice, () =>
        db.query("update profiles set user_id = $1 where user_id = $2", [bob, alice]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let a user insert a profile for someone else", async () => {
    const stranger = await createUser(db);
    await db.query("delete from profiles where user_id = $1", [stranger]);
    await expect(
      asUser(db, alice, () =>
        db.query("insert into profiles (user_id) values ($1)", [stranger]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let a user delete their profile", async () => {
    const result = await asUser(db, alice, () =>
      db.query("delete from profiles where user_id = $1", [alice]),
    );
    expect(result.affectedRows).toBe(0);
  });

  it("shows nothing to signed-out visitors", async () => {
    const { rows } = await asAnon(db, () => db.query("select * from profiles"));
    expect(rows).toHaveLength(0);
  });

  it("shows nothing when the token has no user", async () => {
    const { rows } = await asUser(db, "", () => db.query("select * from profiles"));
    expect(rows).toHaveLength(0);
  });
});

describe("constraints and triggers", () => {
  it("rejects a malformed currency code", async () => {
    await expect(
      db.query("update profiles set base_currency = 'ghs' where user_id = $1", [alice]),
    ).rejects.toThrow(/profiles_base_currency_chk/);
  });

  it("rejects a month start day that not every month has", async () => {
    await expect(
      db.query("update profiles set month_start_day = 31 where user_id = $1", [alice]),
    ).rejects.toThrow(/profiles_month_start_day_chk/);
  });

  it("bumps updated_at on update", async () => {
    const before = await db.query<{ updated_at: Date }>(
      "select updated_at from profiles where user_id = $1",
      [bob],
    );
    await new Promise((r) => setTimeout(r, 20));
    await db.query("update profiles set display_name = 'Bob' where user_id = $1", [bob]);
    const after = await db.query<{ updated_at: Date }>(
      "select updated_at from profiles where user_id = $1",
      [bob],
    );
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(
      before.rows[0].updated_at.getTime(),
    );
  });
});
