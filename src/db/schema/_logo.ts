import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { Logo } from "@/lib/ledger/logo";

// Categories and bills can carry a brand logo (see lib/ledger/logo.ts). `logo_checked_at`
// is when we last looked for one, so a name is only looked up once, and again if renamed.
export const logoColumns = () => ({
  logo: jsonb("logo").$type<Logo>(),
  logoCheckedAt: timestamp("logo_checked_at", { withTimezone: true }),
});

// A stored logo is a small, inert shape: a plain SVG path or a small PNG, nothing else.
export const logoCheck = (name: string, logo: AnyPgColumn) =>
  check(
    name,
    sql`${logo} is null or (
      jsonb_typeof(${logo}) = 'object'
      and char_length(coalesce(${logo}->>'title', '')) between 1 and 80
      and (
        coalesce(${logo}->>'path' ~ '^[MmLlHhVvCcSsQqTtAaZz0-9 .,eE+-]+$' and char_length(${logo}->>'path') <= 60000, false)
        or coalesce(${logo}->>'image' ~ '^data:image/png[^A-Za-z0-9]base64,[A-Za-z0-9+/]+={0,2}$' and char_length(${logo}->>'image') <= 20100, false)
      )
    )`,
  );
