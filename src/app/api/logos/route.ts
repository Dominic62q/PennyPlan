import type { Logo } from "@/lib/ledger/logo";
import { askBrands, faviconFor, glyphFor, type BrandItem } from "@/lib/server/brand-logos";
import { LimitError, recordTokens, reserveCall } from "@/lib/server/assistant-usage";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const MAX_ITEMS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status: number, error: string) => Response.json({ error }, { status });

type Wanted = BrandItem & { id: string };
export type LogoResult = { id: string; logo: Logo | null; retry?: boolean };

function parseItems(body: unknown): Wanted[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return null;
  const out: Wanted[] = [];
  for (const entry of items) {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item !== "object") return null;
    const { id, kind, name, hint } = item;
    if (typeof id !== "string" || !UUID.test(id)) return null;
    if (kind !== "category" && kind !== "bill") return null;
    if (typeof name !== "string" || !name.trim() || name.length > 60) return null;
    if (hint !== undefined && hint !== null && (typeof hint !== "string" || hint.length > 60)) return null;
    out.push({ id, kind, name: name.trim(), ...(typeof hint === "string" && hint.trim() ? { hint: hint.trim() } : {}) });
  }
  return out;
}

// Looks up logos for the names of categories and bills. It only answers: the browser
// saves the result on the person's own rows, so nothing here can touch their data.
export async function POST(request: Request) {
  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey) return fail(503, "Logos aren't set up on this server yet.");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return fail(401, "Sign in first.");

  let items: Wanted[] | null = null;
  try {
    items = parseItems(await request.json());
  } catch {
    items = null;
  }
  if (!items) return fail(400, "That request wasn't valid.");

  try {
    await reserveCall(user.id);
  } catch (error) {
    if (error instanceof LimitError) return fail(error.status, error.message);
    console.error("logos: usage check failed", error instanceof Error ? error.message : "unknown");
    return fail(500, "Something went wrong. Try again.");
  }

  let asked: Awaited<ReturnType<typeof askBrands>>;
  try {
    asked = await askBrands(items, { apiKey, session: `penny-logos-${user.id}` });
  } catch {
    console.error("logos: brand lookup failed");
    return fail(502, "Couldn't look up logos right now.");
  }
  void recordTokens(user.id, asked.tokens).catch(() => console.error("logos: token accounting failed"));

  const results: LogoResult[] = await Promise.all(
    items.map(async (item, i): Promise<LogoResult> => {
      const { brand, domain } = asked.answers[i];
      // "YouTube Premium" has no mark of its own, but its website says YouTube.
      const sole = domain?.split(".").length === 2 ? domain.split(".")[0] : null;
      const glyph = (await glyphFor(brand)) ?? (await glyphFor(sole));
      if (glyph) return { id: item.id, logo: glyph };
      const icon = await faviconFor(domain, item.name);
      if (icon === "retry") return { id: item.id, logo: null, retry: true };
      return { id: item.id, logo: icon };
    }),
  );
  return Response.json({ results });
}
