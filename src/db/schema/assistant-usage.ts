import { bigint, date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

// Daily counters for the assistant: one row for everyone ("global") and one
// per person. Row level security is on and there are no policies, so the
// browser can never read or change these; only the server connection can.
export const assistantUsage = pgTable(
  "assistant_usage",
  {
    day: date("day").notNull(),
    subject: text("subject").notNull(),
    calls: integer("calls").notNull().default(0),
    tokens: bigint("tokens", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.subject] })],
).enableRLS();
