import { z } from "zod";

// What the model hands back when it reads a receipt or a statement. It is only
// ever a suggestion: it is validated here, shown on an editable card, and
// nothing is saved until the person accepts.

export const MAX_ITEMS = 60;
export const MAX_STATEMENT_ROWS = 100;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/))
  .nullable()
  .catch(null);

// Models sometimes write "1,240.50" or "GH₵ 45" instead of a number.
const number = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const n = Number(v.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : v;
}, z.number().finite().max(1e11));

const text = (max: number) => z.string().transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max));

const receiptItem = z.object({ name: text(80), amount: number });

const receiptSchema = z.object({
  kind: z.literal("receipt"),
  merchant: text(80).nullable().catch(null),
  date: day.nullable().catch(null),
  currency,
  total: number.pipe(z.number().positive()).nullable().catch(null),
  tax: number.pipe(z.number().min(0)).nullable().catch(null),
  items: z.array(z.unknown()).catch([]),
});

const statementRow = z.object({
  date: day,
  description: text(80),
  amount: number.pipe(z.number().positive()),
  direction: z.enum(["debit", "credit"]),
});

const statementSchema = z.object({
  kind: z.literal("statement"),
  currency,
  rows: z.array(z.unknown()).catch([]),
});

export type Receipt = {
  kind: "receipt";
  merchant: string | null;
  date: string | null;
  currency: string | null;
  total: number | null;
  tax: number | null;
  items: Array<{ name: string; amount: number }>;
};
export type StatementRow = z.infer<typeof statementRow>;
export type Statement = { kind: "statement"; currency: string | null; rows: StatementRow[] };
export type Extraction = Receipt | Statement;

/** The first JSON object in the model's reply, whatever it wrapped around it. */
function jsonObject(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

const validDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/**
 * Checks the model's reply against the strict schema. Items or rows that don't
 * fit are dropped and counted; a reply with nothing usable comes back as null.
 */
export function parseExtraction(reply: string): { extraction: Extraction; skipped: number } | null {
  const raw = jsonObject(reply);
  if (!raw || typeof raw !== "object") return null;

  const receipt = receiptSchema.safeParse(raw);
  if (receipt.success) {
    const found = receipt.data.items.slice(0, MAX_ITEMS).flatMap((i) => {
      const item = receiptItem.safeParse(i);
      return item.success && item.data.name ? [item.data] : [];
    });
    const { merchant, date, total, tax } = receipt.data;
    const usable = Boolean(total) || found.length > 0;
    if (!usable) return null;
    return {
      extraction: {
        kind: "receipt",
        merchant: merchant || null,
        date: date && validDay(date) ? date : null,
        currency: receipt.data.currency,
        total,
        tax,
        items: found,
      },
      skipped: Math.max(0, receipt.data.items.length - found.length),
    };
  }

  const statement = statementSchema.safeParse(raw);
  if (statement.success) {
    const rows = statement.data.rows.slice(0, MAX_STATEMENT_ROWS).flatMap((r) => {
      const row = statementRow.safeParse(r);
      return row.success && validDay(row.data.date) ? [row.data] : [];
    });
    if (rows.length === 0) return null;
    return {
      extraction: { kind: "statement", currency: statement.data.currency, rows },
      skipped: Math.max(0, statement.data.rows.length - rows.length),
    };
  }
  return null;
}
