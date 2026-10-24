import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = join(__dirname, "..", "..");

// Recreates the parts of Supabase our migrations rely on: the API roles, the
// auth.users table, auth.uid(), and default table grants. RLS then behaves
// the way it does in the hosted project.
const SUPABASE_SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
`;

type Journal = { entries: { tag: string }[] };

export function migrationStatements(): string[] {
  const journal: Journal = JSON.parse(
    readFileSync(join(root, "drizzle", "meta", "_journal.json"), "utf8"),
  );
  return journal.entries.flatMap(({ tag }) =>
    readFileSync(join(root, "drizzle", `${tag}.sql`), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  for (const statement of migrationStatements()) {
    await db.exec(statement);
  }
  return db;
}

export async function createUser(
  db: PGlite,
  meta: Record<string, unknown> = {},
) {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (raw_user_meta_data) values ($1::jsonb) returning id",
    [JSON.stringify(meta)],
  );
  return rows[0].id;
}

// New users start with nothing, as in the app. Ledger tests that need an
// account and a few categories to work with use this fixture instead. It is
// test-only and written without audit rows, like data that was always there.
export async function createUserWithFixtures(db: PGlite) {
  const uid = await createUser(db);
  await db.exec(`
    begin;
    select set_config('app.skip_audit', '1', true);
    insert into accounts (user_id, name, type) values ('${uid}', 'Cash', 'cash');
    insert into categories (user_id, name, kind) values
      ('${uid}', 'Food & Dining', 'expense'),
      ('${uid}', 'Fees & Charges', 'expense'),
      ('${uid}', 'Salary', 'income');
    insert into categories (user_id, name, kind, parent_id)
      select '${uid}', 'Groceries', 'expense', id from categories
       where user_id = '${uid}' and name = 'Food & Dining';
    insert into categories (user_id, name, kind, parent_id)
      select '${uid}', 'Mobile money fees', 'expense', id from categories
       where user_id = '${uid}' and name = 'Fees & Charges';
    commit;
  `);
  return uid;
}

// Runs `fn` the way a signed-in API request would: as the `authenticated`
// role with auth.uid() returning `userId`.
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    userId,
  ]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.exec("select set_config('request.jwt.claim.sub', '', false)");
  }
}

export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role");
  await db.exec("set role anon");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
