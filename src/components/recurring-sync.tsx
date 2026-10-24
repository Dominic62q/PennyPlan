"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "@/components/toast";
import { ledgerKeys, recurringSyncQuery } from "@/lib/queries";

// Posts rent, salary and other auto-post items that have fallen due, each time
// the app opens or comes back to the front (at most every few minutes). Shows
// nothing; a quiet toast says when entries were added.
export function RecurringSync() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data, dataUpdatedAt } = useQuery({
    ...recurringSyncQuery(),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!data || data <= 0) return;
    void queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
    toast.show(data === 1 ? "Added 1 recurring entry" : `Added ${data} recurring entries`);
    // Once per result, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt]);

  return null;
}
