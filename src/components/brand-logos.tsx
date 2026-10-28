"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { LOGO_BATCH, fillLogos, wantedLogos } from "@/lib/ledger/logos";
import { categoriesQuery, ledgerKeys, recurringQuery } from "@/lib/queries";

// Finds brand logos (Spotify, Netflix...) for categories and bills nobody has looked
// at yet: new ones, renamed ones, and everything that existed before logos did. Runs
// in the background and shows nothing; when it finds some, the tiles update by themselves.
export function BrandLogos() {
  const queryClient = useQueryClient();
  const categories = useQuery(categoriesQuery());
  const rules = useQuery(recurringQuery());
  // A name is tried once per visit, so a failed lookup waits for the next visit
  // instead of repeating in a loop.
  const tried = useRef(new Set<string>());
  const running = useRef(false);

  useEffect(() => {
    if (running.current || !categories.data || !rules.data) return;
    const batch = wantedLogos(categories.data, rules.data)
      .filter((item) => !tried.current.has(`${item.kind}:${item.id}:${item.name}`))
      .slice(0, LOGO_BATCH);
    if (batch.length === 0) return;
    for (const item of batch) tried.current.add(`${item.kind}:${item.id}:${item.name}`);

    running.current = true;
    fillLogos(batch)
      .then((changed) => {
        if (changed > 0) {
          void queryClient.invalidateQueries({ queryKey: ledgerKeys.categories() });
          void queryClient.invalidateQueries({ queryKey: ledgerKeys.recurring() });
        }
      })
      .catch(() => {
        // Nothing to tell anyone: it will try again next visit.
      })
      .finally(() => {
        running.current = false;
      });
  }, [categories.data, rules.data, queryClient]);

  return null;
}
