"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { profileNameKey, saveDisplayName } from "@/lib/profile";

// The form lives inside the sheet so it starts fresh each time the sheet opens.
function NameForm({ current, onClose }: { current: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const stored = await saveDisplayName(value);
      queryClient.setQueryData(profileNameKey, stored);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your name.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 pb-2" noValidate>
      <p className="px-1 text-sm text-ink-2">
        Your first name is enough. Penny uses it now and then, never in every reply.
      </p>
      <input
        type="text"
        name="given-name"
        autoComplete="given-name"
        autoCapitalize="words"
        autoCorrect="off"
        aria-label="Your name"
        placeholder="Your first name"
        maxLength={40}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-14 w-full rounded-full border border-transparent bg-surface-2 px-5 text-base text-ink outline-none transition focus:border-gold focus:ring-4 focus:ring-gold/20"
      />
      {error && (
        <p role="alert" className="rounded-2xl bg-expense-soft px-4 py-3 text-sm font-medium text-expense">
          {error}
        </p>
      )}
      <Button type="submit" full size="lg" loading={busy}>
        Save
      </Button>
    </form>
  );
}

// Asks what Penny should call the person. Used from the Profile sheet and from
// the "add your name" prompts on Home and in the assistant.
export function NameSheet({
  open,
  onClose,
  current,
}: {
  open: boolean;
  onClose: () => void;
  current: string | null;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="What should Penny call you?">
      <NameForm current={current} onClose={onClose} />
    </Sheet>
  );
}
