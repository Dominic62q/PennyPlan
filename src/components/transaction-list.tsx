"use client";

import { ArrowLeftRight, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconTile, CategoryBadge } from "@/components/ui/category-badge";
import { Money } from "@/components/ui/money";
import { Sheet } from "@/components/ui/sheet";
import { dayLabel, localDateKey } from "@/lib/dates";
import { useAccounts, useCategoryLookup } from "@/lib/ledger/hooks";
import { mergeTransfers, type ListEntry } from "@/lib/ledger/transfers";
import { signedAmount, type LedgerTransaction } from "@/lib/ledger/types";
import { useDeleteTransaction } from "@/lib/ledger/use-delete";
import { DEFAULT_LOCALE, formatMoney } from "@/lib/money";
import { buttonClass } from "@/lib/ui";

function group(entries: ListEntry[]) {
  const days = new Map<string, ListEntry[]>();
  for (const e of entries) {
    const key = localDateKey(e.tx.occurredAt);
    const list = days.get(key);
    if (list) list.push(e);
    else days.set(key, [e]);
  }
  return [...days.entries()];
}

const timeFormat = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  hour: "numeric",
  minute: "2-digit",
});

// Newest day first under a plain day heading, rows sitting straight on the page.
// Tap a row for the details sheet with Edit and Delete.
export function TransactionList({
  transactions,
  empty,
  grouped = true,
}: {
  transactions: LedgerTransaction[];
  empty?: ReactNode;
  // false: one plain list with the day beside each time (for short previews).
  grouped?: boolean;
}) {
  const accounts = useAccounts();
  const categories = useCategoryLookup();
  const remove = useDeleteTransaction();
  const [selected, setSelected] = useState<ListEntry | null>(null);
  // Keep the last row around while the sheet animates out.
  const [shown, setShown] = useState<ListEntry | null>(null);

  const accountName = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.name])),
    [accounts.data],
  );
  const entries = useMemo(() => mergeTransfers(transactions), [transactions]);
  const days = useMemo(() => group(entries), [entries]);

  function open(e: ListEntry) {
    setShown(e);
    setSelected(e);
  }

  if (transactions.length === 0) {
    return <>{empty ?? <p className="py-8 text-center text-ink-2">Nothing here yet.</p>}</>;
  }

  let index = 0;
  const current = shown?.tx;
  const currentTo = shown?.to ?? null;
  const currentIsTransfer = current?.transferGroupId != null;

  return (
    <>
      <div className={grouped ? "flex flex-col gap-6" : ""}>
        {(grouped ? days : [["", entries] as [string, ListEntry[]]]).map(
          ([key, items]) => {
            const spent = items
              .filter((e) => e.tx.type === "expense")
              .reduce((sum, e) => sum + e.tx.amount, 0);
            return (
              <section key={key || "all"} aria-label={key ? dayLabel(key) : "Recent entries"}>
                {grouped && (
                  <div className="mb-1 flex items-baseline justify-between px-1">
                    <h3 className="text-sm font-semibold text-ink-2">{dayLabel(key)}</h3>
                    {spent > 0 && (
                      <span className="text-xs tabular-nums text-ink-3">
                        Spent {formatMoney(spent, items[0].tx.currency)}
                      </span>
                    )}
                  </div>
                )}
                <ul className="-mx-2 flex flex-col">
                  {items.map((entry) => {
                    const t = entry.tx;
                    const isTransfer = t.transferGroupId !== null;
                    const amount = signedAmount(t);
                    const category = t.categoryId ? categories.byId.get(t.categoryId) : undefined;
                    const title = isTransfer
                      ? entry.to
                        ? "Transfer"
                        : t.type === "transfer_out"
                          ? "Transfer out"
                          : "Transfer in"
                      : (category?.name ?? "Uncategorised");
                    const route = entry.to
                      ? `${accountName.get(t.accountId) ?? "?"} → ${accountName.get(entry.to.accountId) ?? "?"}`
                      : null;
                    const detail = [route, t.payee, t.note].filter(Boolean).join(" · ");
                    const i = Math.min(index++, 12);
                    const when = timeFormat.format(new Date(t.occurredAt));
                    return (
                      <li key={t.id} className="enter" style={{ "--i": i } as React.CSSProperties}>
                        <button
                          type="button"
                          onClick={() => open(entry)}
                          className="flex min-h-[4.5rem] w-full items-center gap-3.5 rounded-[1.5rem] px-2 py-2.5 text-left transition active:bg-surface"
                        >
                          {isTransfer ? (
                            <IconTile icon={ArrowLeftRight} color="#868e96" />
                          ) : (
                            <CategoryBadge
                              id={t.categoryId ?? t.id}
                              icon={category?.icon ?? null}
                              color={t.categoryId ? category?.color : "#868e96"}
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[1.02rem] font-semibold">
                              {title}
                            </span>
                            <span className="block truncate text-sm text-ink-2">
                              {detail || accountName.get(t.accountId) || ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <Money
                              minor={Math.abs(amount)}
                              currency={t.currency}
                              size="md"
                              signed={!isTransfer && amount > 0}
                              className={
                                isTransfer ? "text-ink-2" : amount > 0 ? "text-income" : ""
                              }
                            />
                            <span className="block text-xs text-ink-3">
                              {grouped ? when : `${dayLabel(localDateKey(t.occurredAt))} · ${when}`}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          },
        )}
      </div>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={
          current
            ? currentIsTransfer
              ? currentTo
                ? "Transfer"
                : current.type === "transfer_out"
                  ? "Transfer out"
                  : "Transfer in"
              : (categories.byId.get(current.categoryId ?? "")?.name ?? "Uncategorised")
            : ""
        }
      >
        {current && (
          <div className="flex flex-col gap-5 pb-2">
            <div className="rounded-3xl bg-surface-2 p-5 text-center">
              <Money
                minor={current.amount}
                currency={current.currency}
                size="xl"
                className={!currentTo && signedAmount(current) > 0 ? "text-income" : ""}
              />
              <p className="mt-2 text-sm text-ink-2">
                {currentTo ? "Moved between accounts" : signedAmount(current) > 0 ? "Money in" : "Money out"}
              </p>
            </div>
            <dl className="flex flex-col divide-y divide-line rounded-[1.5rem] bg-surface-2">
              {[
                currentTo
                  ? ["From", accountName.get(current.accountId)]
                  : ["Account", accountName.get(current.accountId)],
                ["To", currentTo ? accountName.get(currentTo.accountId) : undefined],
                [
                  "Date",
                  new Intl.DateTimeFormat(DEFAULT_LOCALE, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(current.occurredAt)),
                ],
                ["Payee", current.payee],
                ["Note", current.note],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 px-4 py-3">
                    <dt className="text-ink-2">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
            </dl>
            <div className="flex gap-3">
              {!currentIsTransfer && (
                <Link
                  href={`/add?edit=${current.id}`}
                  className={`${buttonClass("secondary", "lg")} flex-1`}
                >
                  <Pencil size={18} /> Edit
                </Link>
              )}
              <Button
                variant="danger"
                size="lg"
                className="flex-1"
                icon={<Trash2 size={18} />}
                onClick={() => {
                  setSelected(null);
                  void remove(current);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
