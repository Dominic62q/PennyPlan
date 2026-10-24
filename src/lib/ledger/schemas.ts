import { z } from "zod";
import { MAX_MINOR_UNITS } from "@/lib/money";
import { ACCOUNT_TYPES, RECURRING_FREQUENCIES } from "./types";

const uuid = z.uuid();
const amount = z
  .number()
  .int("Amount must be a whole number of pesewas")
  .positive("Enter an amount above zero")
  .max(MAX_MINOR_UNITS, "That amount is too large");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const isoDate = z.iso.datetime({ offset: true });

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(60, "Use 60 characters or fewer");

// Income or expense. `id` is made on the device so a retry cannot double-add.
export const transactionInputSchema = z.object({
  id: uuid,
  accountId: uuid,
  type: z.enum(["expense", "income"]),
  amount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  occurredAt: isoDate,
  categoryId: uuid.nullable().optional().transform((v) => v ?? null),
  payee: optionalText(120),
  note: optionalText(500),
});
export type TransactionInput = z.input<typeof transactionInputSchema>;

export const transactionPatchSchema = z.object({
  accountId: uuid.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  type: z.enum(["expense", "income"]).optional(),
  amount: amount.optional(),
  occurredAt: isoDate.optional(),
  categoryId: uuid.nullable().optional(),
  payee: optionalText(120).optional(),
  note: optionalText(500).optional(),
});
export type TransactionPatch = z.input<typeof transactionPatchSchema>;

export const transferInputSchema = z
  .object({
    groupId: uuid,
    fromAccountId: uuid,
    toAccountId: uuid,
    amountOut: amount,
    // Only needed when the two accounts use different currencies.
    amountIn: amount.nullable().optional().transform((v) => v ?? null),
    occurredAt: isoDate,
    note: optionalText(500),
    fee: amount.nullable().optional().transform((v) => v ?? null),
    feeCategoryId: uuid.nullable().optional().transform((v) => v ?? null),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: "Choose two different accounts",
    path: ["toAccountId"],
  });
export type TransferInput = z.input<typeof transferInputSchema>;

export const accountInputSchema = z.object({
  id: uuid,
  name: nameSchema,
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().regex(/^[A-Z]{3}$/),
  openingBalance: z
    .number()
    .int()
    .min(-MAX_MINOR_UNITS)
    .max(MAX_MINOR_UNITS)
    .default(0),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export const categoryInputSchema = z.object({
  id: uuid,
  name: nameSchema,
  kind: z.enum(["income", "expense"]),
  parentId: uuid.nullable().optional().transform((v) => v ?? null),
  icon: z.string().max(30).nullable().optional().transform((v) => v ?? null),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

export const categoryPatchSchema = z.object({
  name: nameSchema.optional(),
  icon: categoryInputSchema.shape.icon,
  color: categoryInputSchema.shape.color,
});
export type CategoryPatch = z.input<typeof categoryPatchSchema>;

export const budgetInputSchema = z.object({
  categoryId: uuid.nullable(),
  amount,
});
export type BudgetInput = z.input<typeof budgetInputSchema>;

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "Pick a real date");

export const recurringInputSchema = z
  .object({
    id: uuid,
    kind: z.enum(["expense", "income"]),
    name: nameSchema,
    amount,
    currency: z.string().regex(/^[A-Z]{3}$/),
    accountId: uuid,
    categoryId: uuid.nullable().optional().transform((v) => v ?? null),
    frequency: z.enum(RECURRING_FREQUENCIES),
    repeatEvery: z.number().int().min(1).max(12).default(1),
    nextDue: dateKey,
    endDate: dateKey.nullable().optional().transform((v) => v ?? null),
    autoPost: z.boolean().default(false),
    // The day of the month the schedule keeps to. Left out, it is the day of
    // `nextDue`; an edit that keeps the date passes the existing one back.
    anchorDay: z.number().int().min(1).max(31).optional(),
  })
  .refine((v) => v.endDate === null || v.endDate >= v.nextDue, {
    message: "The end date can't be before the next due date",
    path: ["endDate"],
  });
export type RecurringInput = z.input<typeof recurringInputSchema>;
