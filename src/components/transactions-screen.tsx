"use client";

import { useQuery } from "@tanstack/react-query";
import { ReceiptText, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { QueryState } from "@/components/query-state";
import { TransactionList } from "@/components/transaction-list";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { monthKeyLabel, monthRangeIso } from "@/lib/dates";
import { useAccounts, useCategoryLookup } from "@/lib/ledger/hooks";
import type { TransactionFilters } from "@/lib/ledger/types";
import { PAGE_SIZE, transactionsQuery } from "@/lib/queries";
import { inputClass } from "@/lib/ui";

type TypeFilter = "all" | "expense" | "income" | "transfer";

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function TransactionsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const categoryParam = params.get("category");
  const monthParam = params.get("month");

  const accounts = useAccounts();
  const categories = useCategoryLookup();
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const debouncedSearch = useDebounced(search, 300);

  const filters = useMemo<TransactionFilters>(
    () => ({
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      ...(accountId ? { accountId } : {}),
      ...(type !== "all" ? { type } : {}),
      ...(categoryParam ? { categoryId: categoryParam } : {}),
      ...(monthParam ? monthRangeIso(monthParam) : {}),
    }),
    [debouncedSearch, accountId, type, categoryParam, monthParam],
  );
  const query = useQuery(transactionsQuery(filters));
  const filtered = Object.keys(filters).length > 0;
  const activeAccounts = (accounts.data ?? []).filter((a) => !a.archivedAt);

  const scope = [
    categoryParam ? categories.label(categoryParam) : null,
    monthParam ? monthKeyLabel(monthParam) : null,
  ].filter(Boolean);

  return (
    <>
      <PageHeader title="Activity" subtitle="Everything you've recorded" />

      {scope.length > 0 && (
        <button
          type="button"
          onClick={() => router.replace("/transactions")}
          className="enter flex min-h-11 w-fit items-center gap-2 rounded-full bg-gold/20 py-2 pl-4 pr-3 text-sm font-semibold"
        >
          {scope.join(" · ")}
          <X size={16} />
        </button>
      )}

      <div className="enter flex flex-col gap-3" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-3"
          />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            aria-label="Search payee or note"
            placeholder="Search payee or note"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-12`}
          />
        </div>

        <Segmented<TypeFilter>
          label="Filter by type"
          value={type}
          onChange={setType}
          options={[
            { value: "all", label: "All" },
            { value: "expense", label: "Spent" },
            { value: "income", label: "Income" },
            { value: "transfer", label: "Moves" },
          ]}
        />

        {activeAccounts.length > 1 && (
          <div
            role="group"
            aria-label="Filter by account"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {[{ id: "", name: "All accounts" }, ...activeAccounts].map((a) => (
              <button
                key={a.id}
                type="button"
                aria-pressed={accountId === a.id}
                onClick={() => setAccountId(a.id)}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition active:scale-95 ${
                  accountId === a.id ? "bg-gold text-on-gold" : "bg-surface-2 text-ink-2"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <QueryState
        isPending={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      >
        <TransactionList
          transactions={query.data ?? []}
          empty={
            <EmptyState
              icon={filtered ? Search : ReceiptText}
              title={filtered ? "Nothing matches" : "No entries yet"}
              text={
                filtered
                  ? "Try a different search or clear a filter."
                  : "Tap the gold + to record your first one."
              }
            />
          }
        />
        {(query.data?.length ?? 0) >= PAGE_SIZE && (
          <p className="text-center text-sm text-ink-3">
            Showing the latest {PAGE_SIZE}. Use search or filters to find older entries.
          </p>
        )}
      </QueryState>
    </>
  );
}
