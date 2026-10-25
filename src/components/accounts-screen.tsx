"use client";

import { Archive, ArchiveRestore, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/category-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { useAccounts } from "@/lib/ledger/hooks";
import { addAccount, setAccountArchived, updateAccountDetails } from "@/lib/ledger/mutations";
import { ACCOUNT_COLORS, ACCOUNT_ICONS } from "@/lib/ledger/presentation";
import { useLedgerAction } from "@/lib/ledger/use-action";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type AccountWithBalance,
} from "@/lib/ledger/types";
import {
  DEFAULT_CURRENCY,
  formatMoney,
  minorToInput,
  parseSignedMoney,
} from "@/lib/money";
import { useBalanceHidden } from "@/lib/privacy";
import { inputClass } from "@/lib/ui";

const MASK = "••••••";

export function AccountsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const query = useAccounts();
  const run = useLedgerAction();
  const hidden = useBalanceHidden();
  // The "new account" sheet lives in the address (?new=1), so the Home shortcut
  // opens it directly and the phone's Back button closes it.
  const adding = params.get("new") === "1";
  const closeAdd = () => router.replace("/accounts");
  const [editing, setEditing] = useState<AccountWithBalance | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const all = query.data ?? [];
  const active = all.filter((a) => !a.archivedAt);
  const archived = all.filter((a) => a.archivedAt);

  // Every open account added together, one line per currency.
  const totals = new Map<string, number>();
  for (const a of active) totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balance);
  const [primary, ...others] = [...totals.entries()];
  // The bar shows each account's share of the main currency's money.
  const share = active.filter((a) => a.currency === primary?.[0] && a.balance > 0);
  const shareTotal = share.reduce((sum, a) => sum + a.balance, 0);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Where your money lives"
        back="/"
        action={
          <Link
            href="/accounts?new=1"
            className="flex min-h-10 items-center gap-1.5 rounded-full bg-gold px-4 text-sm font-semibold text-on-gold transition active:scale-95"
          >
            <Plus size={18} strokeWidth={2.6} /> New
          </Link>
        }
      />

      <QueryState
        isPending={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      >
        {active.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No accounts yet"
            text="Add cash, a bank account or mobile money to start tracking."
            action={
              <Link
                href="/accounts?new=1"
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-gold font-semibold text-on-gold"
              >
                <Plus size={20} /> Add an account
              </Link>
            }
          />
        ) : (
          <>
            <section aria-label="Total balance" className="enter flex flex-col gap-3">
              <p className="text-sm font-medium text-ink-2">
                Total across {active.length} {active.length === 1 ? "account" : "accounts"}
              </p>
              {hidden ? (
                <p className="text-5xl font-semibold leading-none tracking-tighter text-ink-3">
                  {MASK}
                </p>
              ) : (
                <Money minor={primary[1]} currency={primary[0]} size="hero" animated />
              )}
              {others.map(([c, total]) => (
                <p key={c} className="text-sm text-ink-2">
                  + {hidden ? MASK : formatMoney(total, c)} in {c}
                </p>
              ))}
              {shareTotal > 0 && share.length > 1 && (
                <div
                  role="img"
                  aria-label="Share of your money in each account"
                  className="mt-1 flex h-2.5 gap-1 overflow-hidden rounded-full"
                >
                  {share.map((a) => (
                    <span
                      key={a.id}
                      className="h-full min-w-1 rounded-full"
                      style={{
                        width: `${(a.balance / shareTotal) * 100}%`,
                        background: ACCOUNT_COLORS[a.type],
                      }}
                    />
                  ))}
                </div>
              )}
            </section>

            <ul
              className="enter overflow-hidden rounded-[1.75rem] bg-surface"
              style={{ "--i": 1 } as React.CSSProperties}
            >
              {active.map((a) => (
                <li key={a.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setEditing(a)}
                    className="flex min-h-[5rem] w-full items-center gap-4 px-4 py-3 text-left transition active:bg-surface-2"
                  >
                    <IconTile
                      icon={ACCOUNT_ICONS[a.type]}
                      color={ACCOUNT_COLORS[a.type]}
                      size="lg"
                      tinted
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-[1.05rem] font-semibold">
                          {a.name}
                        </span>
                        <span className="shrink-0 whitespace-nowrap">
                          {hidden ? (
                            <span className="text-lg font-semibold text-ink-3">{MASK}</span>
                          ) : (
                            <Money minor={a.balance} currency={a.currency} size="lg" />
                          )}
                        </span>
                      </span>
                      <span className="truncate text-sm text-ink-2">
                        {ACCOUNT_TYPE_LABELS[a.type]} · {a.transactionCount}{" "}
                        {a.transactionCount === 1 ? "entry" : "entries"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {archived.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="flex min-h-11 items-center gap-2 px-1 text-sm font-semibold text-ink-2"
            >
              <Archive size={16} />
              {showArchived ? "Hide" : "Show"} archived ({archived.length})
            </button>
            {showArchived && (
              <ul className="mt-2 flex flex-col gap-2">
                {archived.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-3 rounded-[1.5rem] bg-surface p-3 pl-4 opacity-80"
                  >
                    <IconTile icon={ACCOUNT_ICONS[a.type]} color="#868e96" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{a.name}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ArchiveRestore size={16} />}
                      onClick={() =>
                        void run(() => setAccountArchived(a.id, false), "Account restored")
                      }
                    >
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </QueryState>

      <Sheet open={adding} onClose={closeAdd} title="New account">
        <NewAccountForm
          onCreate={async (input) => {
            const ok = await run(() => addAccount(input), "Account added");
            if (ok) closeAdd();
            return ok;
          }}
        />
      </Sheet>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title="Edit account">
        {editing && (
          <EditAccountForm
            key={editing.id}
            account={editing}
            onSave={async (input) => {
              const ok = await run(() => updateAccountDetails(editing.id, input), "Account updated");
              if (ok) setEditing(null);
              return ok;
            }}
            onArchive={async () => {
              if (await run(() => setAccountArchived(editing.id, true), "Account archived")) {
                setEditing(null);
              }
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function EditAccountForm({
  account,
  onSave,
  onArchive,
}: {
  account: AccountWithBalance;
  onSave: (input: { name: string; openingBalance: number }) => Promise<boolean>;
  onArchive: () => Promise<void>;
}) {
  const [name, setName] = useState(account.name);
  const [opening, setOpening] = useState(minorToInput(account.openingBalance, account.currency));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openingMinor = parseSignedMoney(opening, account.currency);
  // What the balance becomes: the entries stay, only the starting point moves.
  const nextBalance =
    openingMinor === null ? null : account.balance - account.openingBalance + openingMinor;
  const nameChanged = name.trim() !== account.name && name.trim() !== "";
  const openingChanged = openingMinor !== null && openingMinor !== account.openingBalance;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (openingMinor === null) {
      setError("Enter the opening balance like 250 or 250.50, or -120 for money owed.");
      return;
    }
    setBusy(true);
    const ok = await onSave({ name, openingBalance: openingMinor });
    setBusy(false);
    if (!ok) setError("Could not save. Check the name isn't already used by another account.");
  }

  return (
    <form className="flex flex-col gap-5 pb-2" onSubmit={submit} noValidate>
      <div className="flex items-center gap-4 rounded-[1.75rem] bg-surface-2 p-4">
        <IconTile icon={ACCOUNT_ICONS[account.type]} color={ACCOUNT_COLORS[account.type]} size="lg" />
        <div className="min-w-0">
          <p className="text-sm text-ink-2">{ACCOUNT_TYPE_LABELS[account.type]} · balance now</p>
          <Money minor={account.balance} currency={account.currency} size="lg" />
        </div>
      </div>
      <label className="flex flex-col gap-2 text-sm font-semibold">
        Name
        <input
          value={name}
          maxLength={60}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </label>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-2 text-sm font-semibold">
          Opening balance ({account.currency})
          <input
            inputMode="decimal"
            value={opening}
            autoComplete="off"
            onChange={(e) => setOpening(e.target.value)}
            className={inputClass}
          />
        </label>
        <p className="px-1 text-xs text-ink-3">
          What this account held before your first entry. Changing it moves the balance by the same
          amount, and no entry is added.
        </p>
        {openingChanged && nextBalance !== null && (
          <p className="px-1 text-sm font-medium text-ink-2">
            Balance will be {formatMoney(nextBalance, account.currency)}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-[1.25rem] bg-expense-soft px-4 py-3 text-sm font-medium text-expense">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" full loading={busy} disabled={!nameChanged && !openingChanged}>
        Save changes
      </Button>
      <Button
        variant="danger"
        size="lg"
        full
        icon={<Archive size={18} />}
        onClick={() => void onArchive()}
      >
        Archive account
      </Button>
      <p className="text-center text-xs text-ink-3">
        Archived accounts keep their history but leave the pickers. You can restore them.
      </p>
    </form>
  );
}

function NewAccountForm({
  onCreate,
}: {
  onCreate: (input: {
    id: string;
    name: string;
    type: AccountType;
    currency: string;
    openingBalance: number;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("cash");
  const [opening, setOpening] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    let openingBalance = 0;
    if (opening.trim() !== "") {
      const parsed = parseSignedMoney(opening);
      if (parsed === null) {
        setError("Enter the starting balance like 250 or 250.50");
        return;
      }
      openingBalance = parsed;
    }

    setBusy(true);
    const ok = await onCreate({
      id: crypto.randomUUID(),
      name,
      type,
      currency: DEFAULT_CURRENCY,
      openingBalance,
    });
    setBusy(false);
    if (!ok) setError("Could not add the account. Check the name isn't already used.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-2" noValidate>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Type</legend>
        <div className="grid grid-cols-4 gap-2">
          {ACCOUNT_TYPES.map((t) => {
            const active = type === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                onClick={() => setType(t)}
                className={`flex flex-col items-center gap-1.5 rounded-[1.5rem] border-2 px-1 py-3 transition active:scale-95 ${
                  active ? "border-gold bg-gold/10" : "border-transparent bg-surface-2"
                }`}
              >
                <IconTile icon={ACCOUNT_ICONS[t]} color={ACCOUNT_COLORS[t]} size="sm" />
                <span className="text-[0.7rem] font-medium leading-tight">
                  {ACCOUNT_TYPE_LABELS[t]}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2 text-sm font-semibold">
        Name
        <input
          value={name}
          maxLength={60}
          autoComplete="off"
          placeholder="e.g. MTN MoMo"
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-semibold">
        Starting balance ({DEFAULT_CURRENCY})
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-[1.25rem] bg-expense-soft px-4 py-3 text-sm font-medium text-expense">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" full loading={busy}>
        Add account
      </Button>
    </form>
  );
}
