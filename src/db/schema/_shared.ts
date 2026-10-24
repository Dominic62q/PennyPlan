import { sql } from "drizzle-orm";
import { type AnyPgColumn, pgPolicy, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

export const userIdColumn = () =>
  uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" });

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Every user-owned table gets the same four policies: you can only see and
// change rows whose user_id is yours.
export function ownerPolicies(table: string, userId: AnyPgColumn) {
  return [
    pgPolicy(`${table}_select_own`, {
      for: "select",
      to: authenticatedRole,
      using: sql`${userId} = ${authUid}`,
    }),
    pgPolicy(`${table}_insert_own`, {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${userId} = ${authUid}`,
    }),
    pgPolicy(`${table}_update_own`, {
      for: "update",
      to: authenticatedRole,
      using: sql`${userId} = ${authUid}`,
      withCheck: sql`${userId} = ${authUid}`,
    }),
    pgPolicy(`${table}_delete_own`, {
      for: "delete",
      to: authenticatedRole,
      using: sql`${userId} = ${authUid}`,
    }),
  ];
}
