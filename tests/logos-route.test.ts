import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = { id: "11111111-1111-4111-8111-111111111111" };
let user: typeof signedIn | null = signedIn;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));

const reserveCall = vi.fn();
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
  recordTokens: vi.fn(async () => {}),
}));

const askBrands = vi.fn();
const faviconFor = vi.fn();
vi.mock("@/lib/server/brand-logos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/brand-logos")>()),
  askBrands: (...args: unknown[]) => askBrands(...args),
  faviconFor: (...args: unknown[]) => faviconFor(...args),
}));

import { POST } from "@/app/api/logos/route";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const call = (body: unknown) =>
  POST(new Request("http://test/api/logos", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  user = signedIn;
  reserveCall.mockReset();
  askBrands.mockReset();
  faviconFor.mockReset();
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
});

describe("POST /api/logos", () => {
  it("uses a bundled mark first, then the site's icon, and says none for a plain name", async () => {
    askBrands.mockResolvedValue({
      answers: [
        { brand: "Spotify", domain: "spotify.com" },
        { brand: "ChatGPT", domain: "chatgpt.com" },
        { brand: null, domain: null },
      ],
      tokens: 50,
    });
    faviconFor.mockImplementation(async (domain: string | null) =>
      domain === "chatgpt.com" ? { title: "ChatGPT", image: "data:image/png;base64,AAAA" } : null,
    );
    const res = await call({
      items: [
        { id: A, kind: "category", name: "Spotify" },
        { id: B, kind: "bill", name: "ChatGPT", hint: "Subscriptions" },
        { id: C, kind: "category", name: "Groceries" },
      ],
    });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results[0]).toMatchObject({ id: A, logo: { title: "Spotify" } });
    expect(results[0].logo.path).toBeTruthy();
    expect(results[1]).toEqual({ id: B, logo: { title: "ChatGPT", image: "data:image/png;base64,AAAA" } });
    expect(results[2]).toEqual({ id: C, logo: null });
    // The bundled mark won, so Spotify's website was never asked for.
    expect(faviconFor).not.toHaveBeenCalledWith("spotify.com", expect.anything());
  });

  it("asks again later when a website icon could not be fetched", async () => {
    askBrands.mockResolvedValue({ answers: [{ brand: "ChatGPT", domain: "chatgpt.com" }] });
    faviconFor.mockResolvedValue("retry");
    const { results } = await (await call({ items: [{ id: A, kind: "bill", name: "ChatGPT" }] })).json();
    expect(results).toEqual([{ id: A, logo: null, retry: true }]);
  });

  it("sends the model only names, kinds and hints", async () => {
    askBrands.mockResolvedValue({ answers: [{ brand: null, domain: null }] });
    await call({ items: [{ id: A, kind: "bill", name: "Rent", hint: "Housing", amount: 99999, note: "secret" }] });
    expect(askBrands.mock.calls[0][0]).toEqual([{ id: A, kind: "bill", name: "Rent", hint: "Housing" }]);
  });

  it("refuses signed-out, malformed and over-limit requests before touching the model", async () => {
    user = null;
    expect((await call({ items: [{ id: A, kind: "bill", name: "x" }] })).status).toBe(401);
    user = signedIn;
    const bad = [
      {},
      { items: [] },
      { items: [{ id: "nope", kind: "bill", name: "x" }] },
      { items: [{ id: A, kind: "account", name: "x" }] },
      { items: [{ id: A, kind: "bill", name: "x".repeat(61) }] },
      { items: Array.from({ length: 21 }, () => ({ id: A, kind: "bill", name: "x" })) },
    ];
    for (const body of bad) expect((await call(body)).status).toBe(400);
    expect(askBrands).not.toHaveBeenCalled();
    expect(reserveCall).not.toHaveBeenCalled();
  });

  it("reports a model outage without any details", async () => {
    askBrands.mockRejectedValue(new Error("secret provider details"));
    const res = await call({ items: [{ id: A, kind: "bill", name: "Netflix" }] });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
