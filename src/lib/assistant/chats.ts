import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { chartSpecSchema } from "./chart-spec";
import type { ChatMessage } from "./types";

// Saved chats: the conversation as shown, kept so it can be reopened. Stored per
// person under row level security, and removed when they delete it.

const confirmRow = z.object({
  id: z.uuid(),
  title: z.string(),
  detail: z.string(),
  amount: z.string(),
});

const newEntry = z.object({
  type: z.enum(["expense", "income"]),
  amount: z.number().int(),
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  payee: z.string().nullable(),
  note: z.string().nullable(),
  date: z.string(),
});

const reviewRow = z.object({
  id: z.string(),
  include: z.boolean(),
  type: z.enum(["expense", "income"]),
  date: z.string(),
  payee: z.string(),
  amount: z.string(),
  categoryId: z.uuid().nullable(),
  duplicate: z.boolean(),
});

// The look-ups behind an answer, as sent to the model. Checked loosely here; they are
// checked again before being replayed.
const traceStep = z.union([
  z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z
      .array(
        z.object({
          id: z.string(),
          type: z.literal("function"),
          function: z.object({ name: z.string(), arguments: z.string() }),
        }),
      )
      .optional(),
  }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string(), content: z.string() }),
]);

const assistantBase = { id: z.string(), role: z.literal("assistant") } as const;

const messageSchema = z.union([
  z.object({
    id: z.string(),
    role: z.literal("user"),
    text: z.string(),
    local: z.literal(true).optional(),
    digest: z.string().optional(),
    image: z.string().startsWith("data:image/").optional(),
  }),
  z.object({
    ...assistantBase,
    kind: z.literal("text"),
    text: z.string(),
    trace: z.array(traceStep).optional(),
  }),
  z.object({
    ...assistantBase,
    kind: z.literal("action"),
    label: z.string(),
    detail: z.string().optional(),
    undoTokens: z.array(z.uuid()).optional(),
    undone: z.boolean().optional(),
  }),
  z.object({
    ...assistantBase,
    kind: z.literal("confirm"),
    action: z.literal("delete"),
    rows: z.array(confirmRow),
    status: z.enum(["pending", "done", "kept"]),
  }),
  z.object({
    ...assistantBase,
    kind: z.literal("confirm"),
    action: z.literal("add"),
    rows: z.array(confirmRow),
    entries: z.array(newEntry),
    summary: z.string(),
    status: z.enum(["pending", "done", "kept"]),
  }),
  z.object({
    ...assistantBase,
    kind: z.literal("review"),
    status: z.enum(["pending", "done", "kept"]),
    source: z.enum(["receipt", "statement"]),
    accountId: z.uuid(),
    currency: z.string().nullable(),
    rows: z.array(reviewRow),
    note: z.string().nullable(),
    warnings: z.array(z.string()),
  }),
  z.object({ ...assistantBase, kind: z.literal("chart"), chart: chartSpecSchema }),
]);

const TITLE_MAX = 80;

function titleOf(messages: ChatMessage[]) {
  const first = messages.find((m) => m.role === "user");
  const text = (first?.role === "user" ? first.text : "New chat").replace(/\s+/g, " ").trim();
  return text.slice(0, TITLE_MAX) || "New chat";
}

export type SavedChat = { id: string; title: string; updatedAt: string };

/** Saves (or updates) the chat. Errors notices aren't kept; they were never Penny's words. */
export async function saveChat(id: string, messages: ChatMessage[]) {
  const kept = messages.filter((m) => m.role === "user" || m.kind !== "notice");
  if (!kept.some((m) => m.role === "user")) return;
  const supabase = createClient();
  // The table has no default owner, and its row policy only lets you write rows
  // that name you, so the owner must be sent with every save.
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("Sign in again to save this chat.");
  const { error } = await supabase
    .from("assistant_chats")
    .upsert({ id, user_id: userId, title: titleOf(kept), messages: kept }, { onConflict: "id" });
  if (error) throw new Error("Couldn't save this chat.");
}

export async function listChats(): Promise<SavedChat[]> {
  const { data, error } = await createClient()
    .from("assistant_chats")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) throw new Error("Couldn't load your chats.");
  return (data ?? []).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

/**
 * Opens a saved chat. Anything that was waiting on a Delete confirmation is
 * shown as kept: the rows may have changed since, so it has to be asked again.
 */
export async function loadChat(id: string): Promise<ChatMessage[]> {
  const { data, error } = await createClient()
    .from("assistant_chats")
    .select("messages")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error("Couldn't open that chat.");
  const parsed = z.array(messageSchema).safeParse(data.messages);
  if (!parsed.success) throw new Error("Couldn't open that chat.");
  return parsed.data.map((m) =>
    "kind" in m && (m.kind === "confirm" || m.kind === "review") && m.status === "pending"
      ? { ...m, status: "kept" as const }
      : m,
  );
}

export async function deleteChat(id: string) {
  const { error } = await createClient().from("assistant_chats").delete().eq("id", id);
  if (error) throw new Error("Couldn't delete that chat.");
}
