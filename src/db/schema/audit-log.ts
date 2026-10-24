import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";
import { userIdColumn } from "./_shared";

// Written only by the audit trigger (see the custom migration). People can read
// their own history but never write or edit it.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdColumn(),
    tableName: text("table_name").notNull(),
    rowId: uuid("row_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    // user | assistant | import | recurring
    actor: text("actor").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("audit_log_action_chk", sql`${t.action} in ('insert','update','delete')`),
    check(
      "audit_log_actor_chk",
      sql`${t.actor} in ('user','assistant','import','recurring')`,
    ),
    index("audit_log_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("audit_log_user_row_idx").on(t.userId, t.tableName, t.rowId),
    pgPolicy("audit_log_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
