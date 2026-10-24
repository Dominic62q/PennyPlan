import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { ownerPolicies, timestamps, userIdColumn } from "./_shared";

// A saved conversation with Penny, so it can be reopened. The id is the
// conversation id made on the device, so saving again just updates the same row.
// `messages` is the chat as shown (text, green lines, cards), nothing hidden.
export const assistantChats = pgTable(
  "assistant_chats",
  {
    id: uuid("id").primaryKey(),
    userId: userIdColumn(),
    title: text("title").notNull(),
    messages: jsonb("messages").notNull(),
    ...timestamps(),
  },
  (t) => [
    check("assistant_chats_title_chk", sql`char_length(${t.title}) between 1 and 80`),
    check(
      "assistant_chats_messages_chk",
      sql`jsonb_typeof(${t.messages}) = 'array' and pg_column_size(${t.messages}) <= 400000`,
    ),
    index("assistant_chats_user_updated_idx").on(t.userId, t.updatedAt.desc()),
    ...ownerPolicies("assistant_chats", t.userId),
  ],
);

export type AssistantChat = typeof assistantChats.$inferSelect;
