# Penny Plan

Personal-finance PWA (Next.js, Supabase, Drizzle). Build plan: `petal-plan/docs/expense-tracker-brief.md`.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run lint` / `npm run typecheck` / `npm test` | Checks run in CI |
| `npm run db:generate` | New migration from `src/db/schema` (`--custom` for hand-written SQL) |
| `npm run db:migrate` | Apply `drizzle/` migrations to the database in `DATABASE_URL` |

## Database and RLS

- Tables live in `src/db/schema`, with their RLS policies next to them. Migrations in `drizzle/` are committed.
- `tests/rls.profiles.test.ts` runs the migrations in an in-process Postgres (PGlite) with a Supabase shim, so RLS is tested without a server. A guard test fails if any public table lacks RLS or a policy.
- Every new table needs `user_id`, RLS enabled, and a test showing another user cannot read or change its rows.

## iPhone

Every release is tried on a real iPhone installed to the Home Screen: cold start, offline add, push, sign-in, quick add, assistant chat, camera upload.
