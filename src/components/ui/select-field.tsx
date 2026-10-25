"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { inputClass } from "@/lib/ui";

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
  // A quieter second line, like a balance under an account name.
  hint?: string;
};

// A choice from a short list, in the app's own bottom sheet instead of the
// browser's dropdown. Looks like any other field until it is tapped.
export function SelectField<T extends string | number>({
  value,
  onChange,
  options,
  title,
  label,
  placeholder = "Choose",
  className = inputClass,
  disabled = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  title: string;
  // Spoken name for the field when no visible label wraps it.
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`${className} flex items-center justify-between gap-3 text-left disabled:opacity-60`}
      >
        <span className={`truncate ${selected ? "" : "text-ink-3"}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={18} className="shrink-0 text-ink-3" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <ul role="listbox" aria-label={title} className="flex flex-col gap-1 pb-1">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={String(o.value)} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 py-2 text-left transition active:scale-[0.99] ${
                    active ? "bg-surface-2" : "active:bg-surface-2"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{o.label}</span>
                    {o.hint && <span className="block truncate text-sm text-ink-2">{o.hint}</span>}
                  </span>
                  {active && <Check size={18} strokeWidth={2.6} className="shrink-0 text-gold-text" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
