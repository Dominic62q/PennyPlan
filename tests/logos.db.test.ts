import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUserWithFixtures } from "./helpers/db";

let db: PGlite;
let uid: string;
let food: string;

beforeAll(async () => {
  db = await createTestDb();
  uid = await createUserWithFixtures(db);
  food = (await db.query<{ id: string }>("select id from categories where user_id = $1 and name = 'Food & Dining'", [uid])).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

const glyph = { title: "Spotify", path: "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0z" };
const PNG = `data:image/png;base64,${"A".repeat(200)}`;

const setLogo = (logo: unknown) =>
  asUser(db, uid, () =>
    db.query("update categories set logo = $1::jsonb, logo_checked_at = now() where id = $2", [JSON.stringify(logo), food]),
  );

const audits = async () =>
  (await db.query<{ n: number }>("select count(*)::int as n from audit_log where table_name = 'categories' and row_id = $1", [food])).rows[0].n;

describe("category and bill logos", () => {
  it("accepts a plain path or a small PNG, and nothing else", async () => {
    await setLogo(glyph);
    await setLogo({ title: "ChatGPT", image: PNG });

    const bad = [
      { title: "x", path: "M0 0 <script>alert(1)</script>" },
      { title: "x", image: "data:image/svg+xml;base64,AAAA" },
      { title: "x", image: "https://example.com/logo.png" },
      { title: "", path: "M0 0" },
      { path: "M0 0" },
      { title: "x" },
      "a string",
    ];
    for (const logo of bad) await expect(setLogo(logo)).rejects.toThrow(/logo_chk/);
  });

  it("starts out unchecked, and asking again follows a rename", async () => {
    const [{ id }] = (
      await db.query<{ id: string }>(
        "insert into categories (user_id, name, kind) values ($1, 'Spotify', 'expense') returning id",
        [uid],
      )
    ).rows;
    const checked = async () =>
      (await db.query<{ c: boolean }>("select logo_checked_at is not null as c from categories where id = $1", [id])).rows[0].c;
    expect(await checked()).toBe(false);

    await asUser(db, uid, () => db.query("update categories set logo = $1::jsonb, logo_checked_at = now() where id = $2", [JSON.stringify(glyph), id]));
    expect(await checked()).toBe(true);

    await asUser(db, uid, () => db.query("update categories set name = 'Rent money' where id = $1", [id]));
    expect(await checked()).toBe(false);
    // The old logo stays until the new answer is in.
    expect((await db.query<{ l: unknown }>("select logo as l from categories where id = $1", [id])).rows[0].l).toMatchObject({ title: "Spotify" });
  });

  it("keeps logos out of the history of edits, and does not log saving one", async () => {
    const before = await audits();
    await setLogo(glyph);
    expect(await audits()).toBe(before);

    await asUser(db, uid, () => db.query("update categories set name = 'Food and dining' where id = $1", [food]));
    expect(await audits()).toBe(before + 1);
    const last = (
      await db.query<{ after: Record<string, unknown> }>(
        "select after from audit_log where table_name = 'categories' and row_id = $1 order by id desc limit 1",
        [food],
      )
    ).rows[0].after;
    expect(last.name).toBe("Food and dining");
    expect(last).not.toHaveProperty("logo");
    expect(last).not.toHaveProperty("logo_checked_at");
  });

  it("works for bills too", async () => {
    const account = (await db.query<{ id: string }>("select id from accounts where user_id = $1", [uid])).rows[0].id;
    const rule = (
      await db.query<{ id: string }>(
        `insert into recurring_rules (user_id, kind, name, amount, currency, account_id, frequency, anchor_day, next_due)
         values ($1, 'expense', 'Netflix', 7900, 'GHS', $2, 'monthly', 1, '2026-11-01') returning id`,
        [uid, account],
      )
    ).rows[0].id;
    await asUser(db, uid, () => db.query("update recurring_rules set logo = $1::jsonb, logo_checked_at = now() where id = $2", [JSON.stringify(glyph), rule]));
    await asUser(db, uid, () => db.query("update recurring_rules set name = 'Rent' where id = $1", [rule]));
    const row = (await db.query<{ c: boolean }>("select logo_checked_at is not null as c from recurring_rules where id = $1", [rule])).rows[0];
    expect(row.c).toBe(false);
    await expect(
      asUser(db, uid, () => db.query("update recurring_rules set logo = '{\"title\":\"x\"}'::jsonb where id = $1", [rule])),
    ).rejects.toThrow(/logo_chk/);
  });
});
