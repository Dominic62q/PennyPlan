import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser } from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db);
  bob = await createUser(db);
});

afterAll(async () => {
  await db.close();
});

const save = (user: string, id: string, title: string, messages: unknown) =>
  asUser(db, user, () =>
    db.query(
      `insert into assistant_chats (id, user_id, title, messages) values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set title = excluded.title, messages = excluded.messages`,
      [id, user, title, JSON.stringify(messages)],
    ),
  );

describe("assistant_chats", () => {
  it("saves a chat and updates the same row when saved again", async () => {
    const id = randomUUID();
    await save(alice, id, "Lunch", [{ role: "user", text: "hi" }]);
    const first = (await db.query<{ updated_at: string }>("select updated_at from assistant_chats where id = $1", [id])).rows[0];
    await new Promise((r) => setTimeout(r, 15));
    await save(alice, id, "Lunch", [{ role: "user", text: "hi" }, { role: "user", text: "again" }]);
    const rows = (await db.query<{ messages: unknown[]; updated_at: string }>("select messages, updated_at from assistant_chats where id = $1", [id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].messages).toHaveLength(2);
    expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThan(new Date(first.updated_at).getTime());
  });

  it("keeps each person's chats to themselves", async () => {
    const id = randomUUID();
    await save(alice, id, "Private", []);
    await asUser(db, bob, async () => {
      expect((await db.query("select * from assistant_chats where id = $1", [id])).rows).toHaveLength(0);
    });
    // Saving over someone else's id changes nothing, and nobody can write as another person.
    await save(bob, id, "Taken over", []).catch(() => undefined);
    await expect(
      asUser(db, bob, () =>
        db.query("insert into assistant_chats (id, user_id, title, messages) values ($1, $2, 'x', '[]')", [randomUUID(), alice]),
      ),
    ).rejects.toThrow();
    expect((await db.query<{ title: string }>("select title from assistant_chats where id = $1", [id])).rows[0].title).toBe("Private");
  });

  it("refuses empty titles, non-list messages and huge chats", async () => {
    await expect(save(alice, randomUUID(), "", [])).rejects.toThrow();
    await expect(save(alice, randomUUID(), "x".repeat(81), [])).rejects.toThrow();
    await expect(save(alice, randomUUID(), "Bad", { not: "a list" })).rejects.toThrow();
    await expect(save(alice, randomUUID(), "Big", [{ text: "y".repeat(450_000) }])).rejects.toThrow();
  });

  it("goes when the person does", async () => {
    const gone = await createUser(db);
    const id = randomUUID();
    await save(gone, id, "Bye", []);
    await db.query("delete from auth.users where id = $1", [gone]);
    expect((await db.query("select 1 from assistant_chats where id = $1", [id])).rows).toHaveLength(0);
  });
});
