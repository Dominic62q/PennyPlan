import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser } from "./helpers/db";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

async function reserve(uid: string, globalCap: number, userCap: number | null = null) {
  const { rows } = await db.query<{ r: string }>(
    "select reserve_assistant_call($1, $2, $3) as r",
    [uid, globalCap, userCap],
  );
  return rows[0].r;
}

const calls = async (subject: string) =>
  (
    await db.query<{ calls: number }>(
      "select calls from assistant_usage where subject = $1",
      [subject],
    )
  ).rows[0]?.calls;

describe("assistant usage", () => {
  it("counts calls and stops at the shared daily cap", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    expect(await reserve(a, 3)).toBe("ok");
    expect(await reserve(b, 3)).toBe("ok");
    expect(await reserve(a, 3)).toBe("ok");
    expect(await reserve(b, 3)).toBe("global_cap");
    expect(await calls("global")).toBe(3);
    expect(await calls(a)).toBe(2);
    expect(await calls(b)).toBe(1);
  });

  it("applies a per-user cap and gives the shared call back", async () => {
    await db.exec("delete from assistant_usage");
    const u = await createUser(db);
    expect(await reserve(u, 100, 1)).toBe("ok");
    expect(await reserve(u, 100, 1)).toBe("user_cap");
    expect(await calls("global")).toBe(1);
    expect(await calls(u)).toBe(1);
  });

  it("records tokens for the person and for everyone", async () => {
    await db.exec("delete from assistant_usage");
    const u = await createUser(db);
    await reserve(u, 100);
    await db.query("select record_assistant_tokens($1, 120)", [u]);
    await db.query("select record_assistant_tokens($1, 30)", [u]);
    const { rows } = await db.query<{ subject: string; tokens: number }>(
      "select subject, tokens from assistant_usage order by subject",
    );
    expect(rows.map((r) => r.tokens)).toEqual([150, 150]);
  });

  it("is unreadable and uncallable for signed-in users", async () => {
    const u = await createUser(db);
    await reserve(u, 100);
    await asUser(db, u, async () => {
      await expect(db.query("select * from assistant_usage")).rejects.toThrow();
      await expect(
        db.query("select reserve_assistant_call($1, 100, null)", [u]),
      ).rejects.toThrow();
    });
  });
});
