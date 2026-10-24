import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { NewEntry } from "@/lib/assistant/types";
import { dateKeyToIso } from "@/lib/dates";
import { friendlyDbError } from "@/lib/ledger/mutations";
import { ledgerKeys } from "@/lib/queries";
import { createClient } from "@/lib/supabase/client";

// A message the model can read and act on ("no category with that id").
export class ToolError extends Error {}

// The database functions behind Penny's changes raise their own messages
// (codes P0001 and P0002) in plain words; anything else is translated.
export function changeMessage(error: { message?: string; code?: string }) {
  return (error.code === "P0001" || error.code === "P0002") && error.message
    ? error.message
    : friendlyDbError(error);
}

const deleteResult = z.object({ count: z.number(), undo_tokens: z.array(z.uuid()) });

/** Deletes (hides) transactions after the person confirmed. Returns the undo tokens. */
export async function deleteConfirmed(ids: string[], queryClient: QueryClient) {
  const { data, error } = await createClient().rpc("assistant_delete_transactions", { p_ids: ids });
  if (error) throw new ToolError(changeMessage(error));
  const result = deleteResult.parse(data);
  await queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  return result;
}

/** Reverses one change Penny made, using the token the database gave back. */
export async function undoChange(token: string, queryClient: QueryClient) {
  const { error } = await createClient().rpc("assistant_undo", { p_token: token });
  if (error) throw new ToolError(changeMessage(error));
  await queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
}

const addResult = z.object({ id: z.uuid(), undo_token: z.uuid().nullable() });

/**
 * Saves the entries on a bulk-add card after the person confirmed, one at a time
 * through the same database function as a single add. It stops at the first
 * failure and says how far it got, so nothing is half-hidden.
 */
export async function addConfirmed(entries: NewEntry[], queryClient: QueryClient) {
  const undoTokens: string[] = [];
  let count = 0;
  let failure: string | null = null;
  for (const e of entries) {
    const { data, error } = await createClient().rpc("assistant_add_transaction", {
      p_id: crypto.randomUUID(),
      p_account: e.accountId,
      p_type: e.type,
      p_amount: e.amount,
      p_occurred_at: dateKeyToIso(e.date),
      p_category: e.categoryId,
      p_payee: e.payee,
      p_note: e.note,
    });
    if (error) {
      failure = changeMessage(error);
      break;
    }
    count += 1;
    const token = addResult.parse(data).undo_token;
    if (token) undoTokens.push(token);
  }
  await queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  return { count, undoTokens, failure };
}
