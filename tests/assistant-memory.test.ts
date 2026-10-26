import { describe, expect, it } from "vitest";
import { MAX_MODEL_CHARS, MAX_MODEL_MESSAGES, compactTrace, toModelMessages } from "@/lib/assistant/memory";
import type { ChatMessage, ModelMessage } from "@/lib/assistant/types";

const user = (id: string, text: string, extra: Partial<Extract<ChatMessage, { role: "user" }>> = {}): ChatMessage => ({
  id,
  role: "user",
  text,
  ...extra,
});
const reply = (id: string, text: string, trace?: ModelMessage[]): ChatMessage => ({
  id,
  role: "assistant",
  kind: "text",
  text,
  ...(trace ? { trace } : {}),
});

const lookup = (id: string, result = '{"total":120}'): ModelMessage[] => [
  {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name: "get_overview", arguments: "{}" } }],
  },
  { role: "tool", tool_call_id: id, content: result },
];

const sizeOf = (messages: ModelMessage[]) => messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);

describe("toModelMessages", () => {
  it("passes plain back and forth through as it is", () => {
    expect(toModelMessages([user("1", "hi"), reply("2", "Hello"), user("3", "again")])).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "again" },
    ]);
  });

  it("keeps what was read from a photo with the message it came with", () => {
    const out = toModelMessages([user("1", "what is this for?", { digest: "A receipt from Melcom, total 45.50", image: "data:image/jpeg;base64,xx" })]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain("what is this for?");
    expect(out[0].content).toContain("A receipt from Melcom, total 45.50");
    expect(out[0].content).not.toContain("data:image");
  });

  it("remembers a photo sent alone, but skips a local line that has nothing read from it", () => {
    const out = toModelMessages([
      user("1", "Photo to read", { local: true, digest: "A chat screenshot" }),
      reply("2", "Okay"),
      user("3", "Photo to read", { local: true }),
      user("4", "so?"),
    ]);
    expect(out.map((m) => m.content)).toEqual([
      "[Attachment the person sent. What Penny read from it:\nA chat screenshot]",
      "Okay",
      "so?",
    ]);
  });

  it("writes cards, charts and changes down as notes merged into the next answer", () => {
    const out = toModelMessages([
      user("1", "add lunch"),
      { id: "2", role: "assistant", kind: "action", label: "Added GH₵30.00 Lunch" },
      { id: "3", role: "assistant", kind: "chart", chart: { title: "Food", subtitle: "This month" } } as ChatMessage,
      reply("4", "Done."),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe("assistant");
    expect(out[1].content).toContain("[Change made: Added GH₵30.00 Lunch]");
    expect(out[1].content).toContain("[Chart shown: Food, This month]");
    expect(out[1].content?.endsWith("Done.")).toBe(true);
  });

  it("never ends on an assistant message when the last thing was a change line", () => {
    const out = toModelMessages([
      user("1", "add lunch"),
      { id: "2", role: "assistant", kind: "action", label: "Added" },
      user("3", "thanks"),
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("replays the look-ups behind recent answers just before the answer", () => {
    const out = toModelMessages([user("1", "how much?"), reply("2", "GH₵120.", lookup("c1")), user("3", "and last month?")]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
    expect(out[3].content).toBe("GH₵120.");
  });

  it("leaves out a saved trace that is not whole instead of failing", () => {
    const broken: ModelMessage[] = [lookup("c1")[0]];
    const out = toModelMessages([user("1", "how much?"), reply("2", "GH₵120.", broken), user("3", "ok")]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("drops look-ups of old answers first when the chat gets long", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push(user(`u${i}`, `question ${i}`), reply(`a${i}`, `answer ${i}`, lookup(`c${i}`)));
    }
    messages.push(user("last", "and now?"));
    const out = toModelMessages(messages);
    // Only the latest three answers keep their look-ups.
    expect(out.filter((m) => m.role === "tool")).toHaveLength(3);
  });

  it("trims the oldest turns, never the latest, and says so, when nothing else makes it fit", () => {
    const big = "x".repeat(8_000);
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 30; i++) messages.push(user(`u${i}`, `${i} ${big}`), reply(`a${i}`, `answer ${i} ${big}`));
    messages.push(user("last", "the final question"));

    const out = toModelMessages(messages);
    expect(out.length).toBeLessThanOrEqual(MAX_MODEL_MESSAGES);
    expect(sizeOf(out)).toBeLessThanOrEqual(MAX_MODEL_CHARS + 200);
    expect(out[0].role).toBe("user");
    expect(out[0].content).toContain("Earlier messages in this chat were left out");
    expect(out[out.length - 1]).toEqual({ role: "user", content: "the final question" });
  });

  it("keeps a single huge latest turn rather than returning nothing", () => {
    const out = toModelMessages([user("1", "short"), reply("2", "ok"), user("3", "y".repeat(MAX_MODEL_CHARS + 500))]);
    expect(out.length).toBeGreaterThan(0);
    expect(out[out.length - 1].role).toBe("user");
  });
});

describe("compactTrace", () => {
  it("returns a whole trace, clipping long tool results", () => {
    const out = compactTrace(lookup("c1", "z".repeat(10_000)));
    expect(out).toHaveLength(2);
    expect((out?.[1].content ?? "").length).toBeLessThan(3_100);
  });

  it("refuses a trace with an unanswered request or an unknown tool", () => {
    expect(compactTrace([lookup("c1")[0]])).toBeUndefined();
    const unknown = lookup("c1");
    (unknown[0] as { tool_calls: { function: { name: string } }[] }).tool_calls[0].function.name = "not_a_tool";
    expect(compactTrace(unknown)).toBeUndefined();
    expect(compactTrace([])).toBeUndefined();
  });
});
