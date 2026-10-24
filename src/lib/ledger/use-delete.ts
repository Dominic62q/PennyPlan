"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/components/toast";
import { ledgerKeys } from "@/lib/queries";
import { setTransactionDeleted } from "./mutations";

type Target = { id: string; transferGroupId: string | null };

// Delete hides the row and offers Undo for a few seconds. Nothing is erased.
export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useCallback(
    async (tx: Target) => {
      const refresh = () =>
        queryClient.invalidateQueries({ queryKey: ledgerKeys.all });

      try {
        await setTransactionDeleted(tx, true);
      } catch (error) {
        toast.show(error instanceof Error ? error.message : "Could not delete", {
          tone: "error",
        });
        return;
      }
      await refresh();
      toast.show("Deleted", {
        action: {
          label: "Undo",
          run: async () => {
            try {
              await setTransactionDeleted(tx, false);
            } catch {
              toast.show("Could not undo. Try again.", { tone: "error" });
            }
            await refresh();
          },
        },
      });
    },
    [queryClient, toast],
  );
}
