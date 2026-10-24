"use client";

import { Archive, ArchiveRestore, Plus, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/category-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { useAccounts } from "@/lib/ledger/hooks";
import { addAccount, renameAccount, setAccountArchived } from "@/lib/ledger/mutations";
import { ACCOUNT_COLORS, ACCOUNT_ICONS } from "@/lib/ledger/presentation";
import { useLedgerAction } from "@/lib/ledger/use-action";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type AccountWithBalance,
} from "@/lib/ledger/types";
import { DEFAULT_CURRENCY, parseMoney } from "@/lib/money";
import { inputClass } from "@/lib/ui";

export function AccountsScreen() {
  const query = useAccounts();
  const run = useLedgerAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AccountWithBalance | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const all = query.data ?? [];
  const active = all.filter((a) => !a.archivedAt);
  const archived = all.filter((a) => a.archivedAt);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Where your money lives"
        action={
          <Button size="sm" icon={<Plus size={18} />} onClick={() => setAdding(true)}>
            New
          </Button>
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
              <Button full size="lg" icon={<Plus size={20} />} onClick={() => setAdding(true)}>
                Add an account
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((a, i) => (
              <li
                key={a.id}
                className="enter"
                style={{ "--i": i } as React.CSSProperties}
              >
                <button
                  type="button"
                  onClick={() => setEditing(a)}
                  className="flex w-full items-center gap-4 rounded-3xl border border-line bg-surface p-4 text-left shadow-card transition active:scale-[0.99]"
                >
                  <IconTile
                    icon={ACCOUNT_ICONS[a.type]}
                    color={ACCOUNT_COLORS[a.type]}
                    size="lg"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.name}</span>
                    <span className="block text-sm text-ink-2">
                      {ACCOUNT_TYPE_LABELS[a.type]} · {a.transactionCount}{" "}
                      {a.transactionCount === 1 ? "entry" : "entries"}
                    </span>
                  </span>
                  <Money minor={a.balance} currency={a.currency} size="lg" />
                </button>
              </li>
            ))}
          </ul>
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
              <ul className="mt-2 flex flex-col gap-3">
                {archived.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4 opacity-80"
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

      <Sheet open={adding} onClose={() => setAdding(false)} title="New account">
        <NewAccountForm
          onCreate={async (input) => {
            const ok = await run(() => addAccount(input), "Account added");
            if (ok) setAdding(false);
            return ok;
          }}
        />
      </Sheet>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title="Edit account">
        {editing && (
          <EditAccountForm
            key={editing.id}
            account={editing}
            onRename={async (name) => {
              if (await run(() => renameAccount(editing.id, name), "Renamed")) setEditing(null);
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
  onRename,
  onArchive,
}: {
  account: AccountWithBalance;
  onRename: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const [name, setName] = useState(account.name);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== account.name && name.trim() !== "";

  return (
    <form
      className="flex flex-col gap-4 pb-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onRename(name);
        setBusy(false);
      }}
    >
      <div className="flex items-center gap-4 rounded-3xl bg-surface-2 p-4">
        <IconTile icon={ACCOUNT_ICONS[account.type]} color={ACCOUNT_COLORS[account.type]} size="lg" />
        <div className="min-w-0">
          <p className="text-sm text-ink-2">{ACCOUNT_TYPE_LABELS[account.type]}</p>
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
      <Button type="submit" size="lg" full loading={busy} disabled={!changed}>
        Save name
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
      const negative = opening.trim().startsWith("-");
      const parsed = parseMoney(opening.trim().replace(/^-/, ""));
      if (parsed === null) {
        setError("Enter the starting balance like 250 or 250.50");
        return;
      }
      openingBalance = negative ? -parsed : parsed;
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
                className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 px-1 py-3 transition active:scale-95 ${
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
        <p role="alert" className="rounded-2xl bg-expense-soft px-4 py-3 text-sm font-medium text-expense">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" full loading={busy}>
        Add account
      </Button>
    </form>
  );
}
