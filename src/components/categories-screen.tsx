"use client";

import { Archive, Check, Plus, Sparkles } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { CategoryBadge, IconTile } from "@/components/ui/category-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { useCategories } from "@/lib/ledger/hooks";
import {
  addCategories,
  addCategory,
  setCategoryArchived,
  updateCategory,
} from "@/lib/ledger/mutations";
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  SUGGESTED_CATEGORIES,
  categoryColor,
  categoryIcon,
  type CategoryIconKey,
} from "@/lib/ledger/presentation";
import type { Category, CategoryKind } from "@/lib/ledger/types";
import { useLedgerAction } from "@/lib/ledger/use-action";
import { inputClass } from "@/lib/ui";

const ICON_KEYS = Object.keys(CATEGORY_ICONS) as CategoryIconKey[];

export function CategoriesScreen() {
  const query = useCategories();
  const run = useLedgerAction();
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const all = useMemo(() => query.data ?? [], [query.data]);

  const tree = useMemo(() => {
    const rows = all.filter((c) => c.kind === kind && !c.archivedAt);
    return rows
      .filter((c) => c.parentId === null)
      .map((parent) => ({
        parent,
        children: rows.filter((c) => c.parentId === parent.id),
      }));
  }, [all, kind]);

  // Suggestions for this kind that the person doesn't already have.
  const suggestions = useMemo(() => {
    const taken = new Set(
      all.filter((c) => c.kind === kind).map((c) => c.name.trim().toLowerCase()),
    );
    return SUGGESTED_CATEGORIES.filter(
      (s) => s.kind === kind && !taken.has(s.name.toLowerCase()),
    );
  }, [all, kind]);

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="How your money is sorted"
        back="/"
        action={
          <Button size="sm" icon={<Plus size={18} />} onClick={() => setAdding(true)}>
            New
          </Button>
        }
      />

      <Segmented<CategoryKind>
        label="Category type"
        value={kind}
        onChange={setKind}
        options={[
          { value: "expense", label: "Spending" },
          { value: "income", label: "Income" },
        ]}
      />

      <QueryState
        isPending={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      >
        {tree.length === 0 ? (
          <Starter
            key={kind}
            kind={kind}
            suggestions={suggestions}
            onAdd={async (picked) => {
              await run(
                () =>
                  addCategories(
                    picked.map((s) => ({
                      id: crypto.randomUUID(),
                      name: s.name,
                      kind: s.kind,
                      parentId: null,
                      icon: s.icon,
                      color: s.color,
                    })),
                  ),
                picked.length === 1 ? "Category added" : `${picked.length} categories added`,
              );
            }}
            onCustom={() => setAdding(true)}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {tree.map(({ parent, children }, i) => (
              <li
                key={parent.id}
                className="enter overflow-hidden rounded-[1.75rem] bg-surface shadow-card"
                style={{ "--i": i } as React.CSSProperties}
              >
                <CategoryRow category={parent} onClick={() => setEditing(parent)} />
                {children.map((c) => (
                  <CategoryRow
                    key={c.id}
                    category={c}
                    nested
                    onClick={() => setEditing(c)}
                  />
                ))}
              </li>
            ))}
          </ul>
        )}

        {tree.length > 0 && suggestions.length > 0 && (
          <section className="rounded-[1.75rem] bg-surface p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-2">
              <Sparkles size={16} className="text-gold-text" />
              Quick add
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() =>
                    void run(
                      () =>
                        addCategory({
                          id: crypto.randomUUID(),
                          name: s.name,
                          kind: s.kind,
                          parentId: null,
                          icon: s.icon,
                          color: s.color,
                        }),
                      `${s.name} added`,
                    )
                  }
                  className="flex min-h-11 items-center gap-2 rounded-full bg-surface px-3 text-sm font-medium transition active:scale-95"
                >
                  <Plus size={14} className="text-ink-3" />
                  {s.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </QueryState>

      <Sheet open={adding} onClose={() => setAdding(false)} title="New category">
        <CategoryForm
          key={`new-${kind}`}
          kind={kind}
          parents={tree.map((t) => t.parent)}
          onSubmit={async (value) => {
            const ok = await run(
              () =>
                addCategory({
                  id: crypto.randomUUID(),
                  name: value.name,
                  kind,
                  parentId: value.parentId,
                  icon: value.icon,
                  color: value.color,
                }),
              "Category added",
            );
            if (ok) setAdding(false);
            return ok;
          }}
        />
      </Sheet>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title="Edit category">
        {editing && (
          <CategoryForm
            key={editing.id}
            kind={editing.kind}
            existing={editing}
            parents={[]}
            onSubmit={async (value) => {
              const ok = await run(
                () =>
                  updateCategory(editing.id, {
                    name: value.name,
                    icon: value.icon,
                    color: value.color,
                  }),
                "Saved",
              );
              if (ok) setEditing(null);
              return ok;
            }}
            onArchive={async () => {
              if (await run(() => setCategoryArchived(editing.id, true), "Category archived")) {
                setEditing(null);
              }
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function CategoryRow({
  category,
  nested,
  onClick,
}: {
  category: Category;
  nested?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition active:bg-surface-2 ${
        nested ? "ml-5 w-[calc(100%-1.25rem)] border-t border-line" : ""
      }`}
    >
      <CategoryBadge
        id={category.id}
        icon={category.icon}
        color={category.color}
        size={nested ? "sm" : "md"}
      />
      <span className={`min-w-0 flex-1 truncate ${nested ? "text-[0.95rem]" : "font-semibold"}`}>
        {category.name}
      </span>
    </button>
  );
}

function Starter({
  kind,
  suggestions,
  onAdd,
  onCustom,
}: {
  kind: CategoryKind;
  suggestions: typeof SUGGESTED_CATEGORIES;
  onAdd: (picked: typeof SUGGESTED_CATEGORIES) => Promise<void>;
  onCustom: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(name: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const chosen = suggestions.filter((s) => picked.has(s.name));

  return (
    <section className="enter flex flex-col gap-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold">
          {kind === "expense" ? "What do you spend on?" : "Where does money come from?"}
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Pick a few to start, or make your own. Nothing is added until you choose.
        </p>
      </div>

      {suggestions.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {suggestions.map((s) => {
              const on = picked.has(s.name);
              return (
                <button
                  key={s.name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s.name)}
                  className={`relative flex min-h-14 items-center gap-3 rounded-2xl border-2 px-3 py-2 text-left transition active:scale-[0.97] ${
                    on ? "border-gold bg-gold/10" : "border-line bg-surface"
                  }`}
                >
                  <IconTile icon={categoryIcon(s.icon)} color={s.color} size="sm" tinted />
                  <span className="min-w-0 flex-1 text-sm font-medium leading-tight">
                    {s.name}
                  </span>
                  {on && (
                    <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-gold text-[#0a241d]">
                      <Check size={11} strokeWidth={3.5} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                setPicked(
                  picked.size === suggestions.length
                    ? new Set()
                    : new Set(suggestions.map((s) => s.name)),
                )
              }
            >
              {picked.size === suggestions.length ? "Clear" : "Select all"}
            </Button>
            <Button
              full
              size="lg"
              loading={busy}
              disabled={chosen.length === 0}
              onClick={async () => {
                setBusy(true);
                await onAdd(chosen);
                setBusy(false);
              }}
            >
              {chosen.length === 0 ? "Pick some to add" : `Add ${chosen.length}`}
            </Button>
          </div>
        </>
      )}

      <Button variant="secondary" size="lg" full icon={<Plus size={18} />} onClick={onCustom}>
        Create my own
      </Button>
    </section>
  );
}

type FormValue = {
  name: string;
  parentId: string | null;
  icon: CategoryIconKey;
  color: string;
};

function CategoryForm({
  kind,
  existing,
  parents,
  onSubmit,
  onArchive,
}: {
  kind: CategoryKind;
  existing?: Category;
  parents: Category[];
  onSubmit: (value: FormValue) => Promise<boolean>;
  onArchive?: () => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [parentId, setParentId] = useState("");
  const [icon, setIcon] = useState<CategoryIconKey>(
    existing?.icon && existing.icon in CATEGORY_ICONS
      ? (existing.icon as CategoryIconKey)
      : kind === "income"
        ? "briefcase"
        : "tag",
  );
  const [color, setColor] = useState<string>(
    existing ? categoryColor(existing.color, existing.id) : CATEGORY_COLORS[0],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = categoryIcon(icon);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim() === "") {
      setError("Give it a name.");
      return;
    }
    setBusy(true);
    const ok = await onSubmit({ name, parentId: parentId || null, icon, color });
    setBusy(false);
    if (!ok) setError("Could not save. Check the name isn't already used here.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-2" noValidate>
      <div className="flex items-center gap-4 rounded-3xl bg-surface-2 p-4">
        <IconTile icon={Icon} color={color} size="lg" tinted />
        <p className="min-w-0 truncate text-lg font-semibold">
          {name.trim() || (kind === "expense" ? "New spending category" : "New income category")}
        </p>
      </div>

      <label className="flex flex-col gap-2 text-sm font-semibold">
        Name
        <input
          value={name}
          maxLength={60}
          autoComplete="off"
          placeholder={kind === "expense" ? "e.g. Groceries" : "e.g. Salary"}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </label>

      {!existing && parents.length > 0 && (
        <label className="flex flex-col gap-2 text-sm font-semibold">
          Inside
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className={inputClass}
          >
            <option value="">Nothing (a main category)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Colour</legend>
        <div className="flex flex-wrap gap-3">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={`flex size-11 items-center justify-center rounded-full text-white transition active:scale-90 ${
                color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""
              }`}
              style={{ background: c }}
            >
              {color === c && <Check size={18} strokeWidth={3} />}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Icon</legend>
        <div className="grid grid-cols-6 gap-2">
          {ICON_KEYS.map((key) => {
            const Glyph = CATEGORY_ICONS[key];
            const on = icon === key;
            return (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={on}
                onClick={() => setIcon(key)}
                className={`flex size-11 items-center justify-center rounded-2xl border-2 transition active:scale-90 ${
                  on ? "border-transparent text-white" : "border-transparent bg-surface-2 text-ink-2"
                }`}
                style={on ? { background: color } : undefined}
              >
                <Glyph size={20} strokeWidth={2.2} />
              </button>
            );
          })}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-2xl bg-expense-soft px-4 py-3 text-sm font-medium text-expense">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" full loading={busy}>
        {existing ? "Save changes" : "Add category"}
      </Button>

      {existing && onArchive && (
        <>
          <Button
            variant="danger"
            size="lg"
            full
            icon={<Archive size={18} />}
            onClick={() => void onArchive()}
          >
            Archive category
          </Button>
          <p className="text-center text-xs text-ink-3">
            Past entries keep this category. It just leaves the pickers.
          </p>
        </>
      )}
    </form>
  );
}
