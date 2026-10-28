import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGO_IMAGE, LOGO_PATH, parseLogo } from "@/lib/ledger/logo";
import { wantedLogos } from "@/lib/ledger/logos";
import type { Category, RecurringRule } from "@/lib/ledger/types";
import { cleanDomain, faviconFor, glyphFor, parseBrandAnswers } from "@/lib/server/brand-logos";

afterEach(() => vi.unstubAllGlobals());

describe("parseBrandAnswers", () => {
  it("reads one answer per item and treats the rest as no brand", () => {
    const reply = '<think>hm</think>```json\n{"1":{"brand":"Spotify","domain":"https://www.Spotify.com/uk"},"2":null,"3":{"brand":"","domain":"not a domain"}}\n```';
    expect(parseBrandAnswers(reply, 4)).toEqual([
      { brand: "Spotify", domain: "spotify.com" },
      { brand: null, domain: null },
      { brand: null, domain: null },
      { brand: null, domain: null },
    ]);
  });

  it("gives no brand for nonsense", () => {
    expect(parseBrandAnswers("sorry, I can't", 2)).toEqual([
      { brand: null, domain: null },
      { brand: null, domain: null },
    ]);
  });
});

describe("cleanDomain", () => {
  it("keeps only a real-looking website name", () => {
    expect(cleanDomain("http://chatgpt.com/auth?x=1")).toBe("chatgpt.com");
    expect(cleanDomain("localhost")).toBeNull();
    expect(cleanDomain("169.254.169.254")).toBeNull();
    expect(cleanDomain("evil.com/@internal")).toBe("evil.com");
    expect(cleanDomain(42)).toBeNull();
  });
});

describe("glyphFor", () => {
  it("finds a bundled brand mark that fits the stored shape", async () => {
    const logo = await glyphFor("Spotify");
    expect(logo?.title).toBe("Spotify");
    expect(await glyphFor("apple music")).toMatchObject({ title: "Apple Music" });
    expect(await glyphFor("  YOUTUBE ")).toMatchObject({ title: "YouTube" });
    expect(logo?.path).toMatch(LOGO_PATH);
    expect(parseLogo(logo)).toEqual(logo);
  });

  it("knows nothing about brands it lacks or names it cannot place", async () => {
    expect(await glyphFor("definitely-not-a-brand")).toBeNull();
    expect(await glyphFor("ChatGPT")).toBeNull();
    expect(await glyphFor("../../etc/passwd")).toBeNull();
    expect(await glyphFor("")).toBeNull();
    expect(await glyphFor(null)).toBeNull();
  });
});

describe("faviconFor", () => {
  const png = (size: number) => {
    const bytes = new Uint8Array(size);
    bytes.set([0x89, 0x50, 0x4e, 0x47]);
    return new Response(bytes, { status: 200, headers: { "content-type": "image/png" } });
  };

  it("returns the site's icon as a small PNG", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => png(900)));
    const logo = await faviconFor("chatgpt.com", "ChatGPT");
    expect(logo).not.toBeNull();
    expect(logo).not.toBe("retry");
    expect((logo as { image: string }).image).toMatch(LOGO_IMAGE);
    expect(parseLogo(logo)).not.toBeNull();
  });

  it("says there is no logo for a missing, tiny, huge or non-PNG icon, but to retry a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect(await faviconFor("nope.example.com", "Nope")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => png(40)));
    expect(await faviconFor("tiny.com", "Tiny")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => png(30_000)));
    expect(await faviconFor("huge.com", "Huge")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(900), { status: 200 })));
    expect(await faviconFor("html.com", "Html")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await faviconFor("busy.com", "Busy")).toBe("retry");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await faviconFor("offline.com", "Offline")).toBe("retry");
    expect(await faviconFor(null, "No site")).toBeNull();
  });
});

describe("wantedLogos", () => {
  const category = (over: Partial<Category>): Category => ({
    id: "c",
    name: "Spotify",
    kind: "expense",
    parentId: null,
    icon: null,
    color: null,
    logo: null,
    logoChecked: false,
    sortOrder: 0,
    archivedAt: null,
    ...over,
  });
  const rule = (over: Partial<RecurringRule>): RecurringRule => ({
    id: "r",
    kind: "expense",
    name: "Netflix",
    amount: 100,
    currency: "GHS",
    accountId: "a",
    categoryId: null,
    frequency: "monthly",
    repeatEvery: 1,
    anchorDay: 1,
    nextDue: "2026-11-01",
    endDate: null,
    autoPost: false,
    paused: false,
    logo: null,
    logoChecked: false,
    ...over,
  });

  it("lists what has not been looked at, with its parent or category as a hint", () => {
    const parent = category({ id: "p", name: "Subscriptions", logoChecked: true });
    const wanted = wantedLogos(
      [parent, category({ id: "c1", name: "Spotify", parentId: "p" }), category({ id: "c2", name: "Old", archivedAt: "2026-01-01" })],
      [rule({ id: "r1", categoryId: "p" }), rule({ id: "r2", name: "Rent", logoChecked: true })],
    );
    expect(wanted).toEqual([
      { id: "c1", kind: "category", name: "Spotify", hint: "Subscriptions" },
      { id: "r1", kind: "bill", name: "Netflix", hint: "Subscriptions" },
    ]);
  });
});
