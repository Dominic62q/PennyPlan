import { createClient } from "@/lib/supabase/client";
import { parseLogo, type Logo } from "./logo";
import type { Category, RecurringRule } from "./types";

// Finding brand logos for categories and bills. The server says which logo fits a
// name; this saves it on the person's own row, so the database rules (only your own
// rows, only a plain shape) apply as for any other edit.

export type LogoKind = "category" | "bill";
export type LogoWanted = { id: string; kind: LogoKind; name: string; hint?: string };
type Found = { id: string; logo: Logo | null; retry?: boolean };

const TABLES: Record<LogoKind, "categories" | "recurring_rules"> = {
  category: "categories",
  bill: "recurring_rules",
};

// Most a single lookup carries: the model thinks about each name, so a small batch stays quick.
export const LOGO_BATCH = 8;

/** Everything that hasn't been looked at under its current name, oldest first. */
export function wantedLogos(categories: Category[], rules: RecurringRule[]): LogoWanted[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return [
    ...categories
      .filter((c) => !c.logoChecked && !c.archivedAt)
      .map((c) => ({
        id: c.id,
        kind: "category" as const,
        name: c.name,
        ...(c.parentId && byId.get(c.parentId) ? { hint: byId.get(c.parentId)!.name } : {}),
      })),
    ...rules
      .filter((r) => !r.logoChecked)
      .map((r) => ({
        id: r.id,
        kind: "bill" as const,
        name: r.name,
        ...(r.categoryId && byId.get(r.categoryId) ? { hint: byId.get(r.categoryId)!.name } : {}),
      })),
  ];
}

/** Asks the server which logo each name has. Throws if it can't be reached. */
async function lookUp(items: LogoWanted[]): Promise<Found[]> {
  const response = await fetch("/api/logos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) throw new Error("logo lookup failed");
  const { results } = (await response.json()) as { results: Found[] };
  return results.map((r) => ({ id: r.id, logo: parseLogo(r.logo), retry: r.retry === true }));
}

/**
 * Looks up and saves logos for these items. Names that are not brands are still
 * marked as looked at, so they are not asked about again. Returns how many rows changed.
 * A row renamed while the lookup ran is left alone (it will be looked at again).
 */
export async function fillLogos(items: LogoWanted[]): Promise<number> {
  const found = await lookUp(items);
  const supabase = createClient();
  const checkedAt = new Date().toISOString();
  let changed = 0;
  for (const result of found) {
    if (result.retry) continue;
    const item = items.find((i) => i.id === result.id);
    if (!item) continue;
    const { error } = await supabase
      .from(TABLES[item.kind])
      .update({ logo: result.logo, logo_checked_at: checkedAt })
      .eq("id", item.id)
      .eq("name", item.name);
    if (!error) changed++;
  }
  return changed;
}

/** Takes a logo off, for good: the row goes back to its normal icon and isn't looked at again until renamed. */
export async function removeLogo(kind: LogoKind, id: string) {
  const { error } = await createClient()
    .from(TABLES[kind])
    .update({ logo: null, logo_checked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error("Couldn't remove that logo. Try again.");
}
