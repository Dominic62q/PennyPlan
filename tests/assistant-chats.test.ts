import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const getSession = vi.fn();
const deleteEq = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession },
    from: () => ({ upsert, delete: () => ({ eq: deleteEq }) }),
  }),
}));

import { deleteChat, saveChat } from "@/lib/assistant/chats";
import type { ChatMessage } from "@/lib/assistant/types";

const asked: ChatMessage[] = [{ id: "m1", role: "user", text: "How much did I spend on food?" }];

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({ error: null });
  deleteEq.mockReset().mockResolvedValue({ error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
});

describe("saveChat", () => {
  it("names the signed-in person as the owner, which the table's row policy requires", async () => {
    await saveChat("chat-1", asked);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, options] = upsert.mock.calls[0];
    expect(row).toMatchObject({ id: "chat-1", user_id: "user-1", title: "How much did I spend on food?" });
    expect(row.messages).toEqual(asked);
    expect(options).toEqual({ onConflict: "id" });
  });

  it("does not save a chat with nothing asked yet", async () => {
    await saveChat("chat-1", []);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("drops error notices before saving", async () => {
    await saveChat("chat-1", [...asked, { id: "n1", role: "assistant", kind: "notice", text: "Penny took too long" }]);
    expect(upsert.mock.calls[0][0].messages).toEqual(asked);
  });

  it("fails loudly when signed out, so the screen can say so", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(saveChat("chat-1", asked)).rejects.toThrow(/sign in/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails loudly when the database refuses", async () => {
    upsert.mockResolvedValue({ error: { message: "new row violates row-level security policy" } });
    await expect(saveChat("chat-1", asked)).rejects.toThrow(/couldn't save/i);
  });
});

describe("deleteChat", () => {
  it("deletes the chat by id", async () => {
    await deleteChat("chat-1");
    expect(deleteEq).toHaveBeenCalledWith("id", "chat-1");
  });

  it("fails loudly when the database refuses", async () => {
    deleteEq.mockResolvedValue({ error: { message: "nope" } });
    await expect(deleteChat("chat-1")).rejects.toThrow(/couldn't delete/i);
  });
});
