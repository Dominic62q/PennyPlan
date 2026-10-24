"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/components/toast";
import { ledgerKeys } from "@/lib/queries";

// Runs a write, refreshes everything that reads the ledger, and says how it
// went. Resolves true when it worked.
export function useLedgerAction() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useCallback(
    async (action: () => Promise<unknown>, done?: string) => {
      try {
        await action();
        await queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
        if (done) toast.show(done);
        return true;
      } catch (error) {
        toast.show(error instanceof Error ? error.message : "Something went wrong", {
          tone: "error",
        });
        return false;
      }
    },
    [queryClient, toast],
  );
}
