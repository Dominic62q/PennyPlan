"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { accountsQuery, categoriesQuery } from "@/lib/queries";
import type { Category } from "@/lib/ledger/types";

export function useAccounts() {
  return useQuery(accountsQuery());
}

export function useCategories() {
  return useQuery(categoriesQuery());
}

// "Food & Dining › Groceries" for a subcategory, just the name for a top one.
export function useCategoryLookup() {
  const { data } = useCategories();
  return useMemo(() => {
    const byId = new Map<string, Category>((data ?? []).map((c) => [c.id, c]));
    const label = (id: string | null) => {
      if (!id) return "Uncategorised";
      const c = byId.get(id);
      if (!c) return "Uncategorised";
      const parent = c.parentId ? byId.get(c.parentId) : undefined;
      return parent ? `${parent.name} › ${c.name}` : c.name;
    };
    return { byId, label };
  }, [data]);
}

const LAST_ACCOUNT_KEY = "penny-plan:last-account";

// The account used for the previous entry, so a repeat add is one tap fewer.
export function readLastAccountId() {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function rememberAccountId(id: string) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Private mode or blocked storage: the default account is used instead.
  }
}
