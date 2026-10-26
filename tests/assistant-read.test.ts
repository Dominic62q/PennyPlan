import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = { id: "11111111-1111-4111-8111-111111111111" };
let user: typeof signedIn | null = signedIn;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));

const reserveCall = vi.fn();
const recordTokens = vi.fn<(userId: string, tokens?: number) => Promise<void>>(async () => {});
vi.mock("@/lib/server/assistant-usage", () => ({
  LimitError: class LimitError extends Error {
    constructor(
      message: string,
      readonly status: 429 | 503,
    ) {
      super(message);
    }
  },
  reserveCall: (...args: unknown[]) => reserveCall(...args),
  recordTokens: (userId: string, tokens?: number) => recordTokens(userId, tokens),
}));

import { parseExtraction } from "@/lib/assistant/extract";
import { markDuplicates, makeReview, duplicateKey, reviewEntries, rememberedKey } from "@/lib/assistant/review";
import { LimitError } from "@/lib/server/assistant-usage";
import { POST } from "@/app/api/assistant/read/route";

const image = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const valid = { conversationId: "chat-1234567890", today: "2026-10-24", image };
const call = (body: unknown) =>
  POST(new Request("http://test/api/assistant/read", { method: "POST", body: JSON.stringify(body) }));

const upstream = vi.fn();
const reply = (content: string) =>
  Response.json({ choices: [{ message: { content } }], usage: { total_tokens: 900 } });

const receiptJson = JSON.stringify({
  kind: "receipt",
  merchant: "Melcom",
  date: "2026-10-23",
  currency: "GHS",
  total: 57,
  tax: 7,
  items: [
    { name: "Milk", amount: 20 },
    { name: "Bread", amount: 30 },
  ],
});

beforeEach(() => {
  user = signedIn;
  reserveCall.mockReset();
  recordTokens.mockClear();
  upstream.mockReset();
  upstream.mockResolvedValue(reply(receiptJson));
  vi.stubGlobal("fetch", upstream);
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  vi.stubEnv("OPENCODE_MODEL", "");
  vi.stubEnv("OPENCODE_VISION_MODEL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/assistant/read", () => {
  it("reads a photo with the vision model and returns a checked receipt", async () => {
    vi.stubEnv("OPENCODE_VISION_MODEL", "vision-x");
    const res = await call(valid);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.extraction).toMatchObject({ kind: "receipt", merchant: "Melcom", total: 57 });
    expect(body.skipped).toBe(0);

    const [url, init] = upstream.mock.calls[0];
    expect(url).toContain("/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(init.headers["x-opencode-session"]).toBe(valid.conversationId);
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("vision-x");
    expect(sent.tools).toBeUndefined();
    expect(sent.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: image } });
    expect(recordTokens).toHaveBeenCalledWith(signedIn.id, 900);
  });

  it("falls back to the chat model, and wraps pasted text as data", async () => {
    vi.stubEnv("OPENCODE_MODEL", "chat-y");
    await call({ conversationId: valid.conversationId, today: valid.today, text: "12 Oct  Shoprite  45.00 Dr" });
    const sent = JSON.parse(upstream.mock.calls[0][1].body);
    expect(sent.model).toBe("chat-y");
    expect(sent.messages[1].content).toContain("<document>\n12 Oct  Shoprite  45.00 Dr\n</document>");
  });

  it("accepts a reply wrapped in thinking and code fences", async () => {
    upstream.mockResolvedValue(reply("<think>hmm</think>```json\n" + receiptJson + "\n```"));
    expect((await call(valid)).status).toBe(200);
  });

  it("refuses when signed out, without touching usage or the model", async () => {
    user = null;
    expect((await call(valid)).status).toBe(401);
    expect(reserveCall).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects malformed requests before spending a call", async () => {
    const bad = [
      { ...valid, image: undefined },
      { ...valid, text: "also text" },
      { ...valid, image: "https://evil.example/x.png" },
      { ...valid, image: "data:image/svg+xml;base64,AAAA" },
      { ...valid, image: `data:image/jpeg;base64,${"A".repeat(3_600_000)}` },
      { conversationId: valid.conversationId, today: valid.today, text: "   " },
      { conversationId: valid.conversationId, today: valid.today, text: "x".repeat(20_001) },
      { ...valid, conversationId: "../etc" },
      { ...valid, today: "tomorrow" },
    ];
    for (const body of bad) expect((await call(body)).status).toBe(400);
    expect(reserveCall).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("says so when it can't find a receipt or statement", async () => {
    upstream.mockResolvedValue(reply('{"kind":"unreadable"}'));
    const res = await call(valid);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/couldn't find/);
  });

  it("describes a picture in words when asked to, without reading it as a receipt", async () => {
    upstream.mockResolvedValue(reply("A screenshot of a chat. Ama: pay me back 20 cedis."));
    const res = await call({ ...valid, describe: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ digest: "A screenshot of a chat. Ama: pay me back 20 cedis." });

    const sent = JSON.parse(upstream.mock.calls[0][1].body);
    expect(sent.messages[0].content).toContain("describe a photo or screenshot");
    expect(sent.messages[0].content).not.toContain("kind");
    expect(sent.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: image } });
    expect(recordTokens).toHaveBeenCalledWith(signedIn.id, 900);
  });

  it("only describes pictures, and only with a true flag", async () => {
    const bad = [
      { conversationId: valid.conversationId, today: valid.today, text: "some text", describe: true },
      { ...valid, describe: "yes" },
    ];
    for (const body of bad) expect((await call(body)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("passes a daily limit on and turns an outage into a friendly error", async () => {
    reserveCall.mockRejectedValueOnce(new LimitError("Penny is at capacity for today.", 503));
    expect((await call(valid)).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();

    upstream.mockResolvedValue(new Response("secret details", { status: 500 }));
    const res = await call(valid);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("parseExtraction", () => {
  it("tolerates numbers written as text and drops what doesn't fit", () => {
    const result = parseExtraction(
      JSON.stringify({
        kind: "statement",
        currency: "ghs",
        rows: [
          { date: "2026-10-01", description: "Shoprite", amount: "1,240.50", direction: "debit" },
          { date: "2026-10-02", description: "Salary", amount: 3000, direction: "credit" },
          { date: "2026-02-31", description: "Bad day", amount: 5, direction: "debit" },
          { date: "2026-10-03", description: "Zero", amount: 0, direction: "debit" },
          { date: "2026-10-03", description: "Odd", amount: 5, direction: "sideways" },
        ],
      }),
    );
    expect(result?.skipped).toBe(3);
    expect(result?.extraction).toMatchObject({ kind: "statement", currency: "GHS" });
    expect(result?.extraction.kind === "statement" && result.extraction.rows.map((r) => r.amount)).toEqual([
      1240.5, 3000,
    ]);
  });

  it("returns null for nothing usable", () => {
    expect(parseExtraction("I cannot read this")).toBeNull();
    expect(parseExtraction('{"kind":"statement","rows":[]}')).toBeNull();
    expect(parseExtraction('{"kind":"receipt","total":null,"items":[]}')).toBeNull();
    expect(parseExtraction('{"kind":"other"}')).toBeNull();
  });

  it("ignores a bad date or currency instead of failing the receipt", () => {
    const result = parseExtraction('{"kind":"receipt","merchant":"X","date":"yesterday","currency":"cedis","total":10,"tax":null,"items":[]}');
    expect(result?.extraction).toMatchObject({ date: null, currency: null, total: 10 });
  });
});

describe("review", () => {
  const account = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", currency: "GHS", archivedAt: null };
  const usd = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", currency: "USD", archivedAt: null };
  const food = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", kind: "expense" as const, archivedAt: null };
  const inputs = {
    accounts: [account, usd],
    categories: [food],
    remembered: new Map([[rememberedKey("expense", "Melcom"), food.id]]),
    today: "2026-10-24",
  };
  const receipt = parseExtraction(receiptJson)!;

  it("lays a receipt out as one editable line with the remembered category", () => {
    const review = makeReview(receipt.extraction, 0, inputs);
    expect(review.accountId).toBe(account.id);
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]).toMatchObject({ payee: "Melcom", amount: "57.00", date: "2026-10-23", categoryId: food.id });
    expect(review.note).toBe("Milk 20.00, Bread 30.00, Tax 7.00");
    // 20 + 30 + 7 tax = 57: nothing to warn about.
    expect(review.warnings).toEqual([]);
  });

  it("warns when the items don't add up to the total", () => {
    const off = parseExtraction(receiptJson.replace('"total":57', '"total":99'))!;
    expect(makeReview(off.extraction, 0, inputs).warnings[0]).toMatch(/add up differently/);
  });

  it("picks the account in the document's currency", () => {
    const dollars = parseExtraction(receiptJson.replace('"GHS"', '"USD"'))!;
    expect(makeReview(dollars.extraction, 0, inputs).accountId).toBe(usd.id);
  });

  it("turns statement directions into spending and income", () => {
    const statement = parseExtraction(
      JSON.stringify({
        kind: "statement",
        currency: null,
        rows: [
          { date: "2026-10-01", description: "Shoprite", amount: 45, direction: "debit" },
          { date: "2026-10-02", description: "Salary", amount: 3000, direction: "credit" },
        ],
      }),
    )!;
    const review = makeReview(statement.extraction, 1, inputs);
    expect(review.rows.map((r) => [r.type, r.amount])).toEqual([
      ["expense", "45.00"],
      ["income", "3000.00"],
    ]);
    expect(review.warnings[0]).toMatch(/1 line couldn't be read/);
  });

  it("marks duplicates and leaves them unticked", () => {
    const review = makeReview(receipt.extraction, 0, inputs);
    const existing = new Set([duplicateKey(account.id, "expense", 5700, "2026-10-23")]);
    const rows = markDuplicates(review.rows, account.id, "GHS", existing);
    expect(rows[0]).toMatchObject({ duplicate: true, include: false });
    expect(markDuplicates(review.rows, account.id, "GHS", new Set())[0]).toMatchObject({
      duplicate: false,
      include: true,
    });
  });

  it("turns the ticked lines into entries, and refuses bad edits", () => {
    const review = makeReview(receipt.extraction, 0, inputs);
    const ok = reviewEntries(review, "GHS", "2026-10-24");
    expect(ok).toEqual({
      entries: [
        {
          type: "expense",
          amount: 5700,
          accountId: account.id,
          categoryId: food.id,
          payee: "Melcom",
          note: "Milk 20.00, Bread 30.00, Tax 7.00",
          date: "2026-10-23",
        },
      ],
    });

    const edit = (change: Partial<(typeof review.rows)[0]>) => ({ ...review, rows: [{ ...review.rows[0], ...change }] });
    expect(reviewEntries(edit({ amount: "12.345" }), "GHS", "2026-10-24")).toHaveProperty("error");
    expect(reviewEntries(edit({ amount: "abc" }), "GHS", "2026-10-24")).toHaveProperty("error");
    expect(reviewEntries(edit({ date: "2026-12-01" }), "GHS", "2026-10-24")).toMatchObject({
      error: expect.stringMatching(/future/),
    });
    expect(reviewEntries(edit({ include: false }), "GHS", "2026-10-24")).toMatchObject({
      error: expect.stringMatching(/at least one/),
    });
  });
});
