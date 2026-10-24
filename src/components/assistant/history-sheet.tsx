"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { useState } from "react";
import { deleteChat, listChats, type SavedChat } from "@/lib/assistant/chats";
import { dayLabel, localDateKey } from "@/lib/dates";

export const chatKeys = { all: ["assistant-chats"] as const };

// Earlier conversations with Penny, newest first. Tap one to reopen it.
export function HistorySheet({
  currentId,
  onOpen,
  onDeleted,
  onClose,
}: {
  currentId: string;
  onOpen: (id: string) => void;
  // Called once a chat is really gone, so the screen can drop it if it is open.
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const chats = useQuery({ queryKey: chatKeys.all, queryFn: listChats });
  const [asking, setAsking] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: deleteChat,
    onSuccess: (_, id) => {
      // Gone from the list at once, not after the next refetch.
      queryClient.setQueryData<SavedChat[]>(chatKeys.all, (old) => old?.filter((c) => c.id !== id));
      onDeleted(id);
    },
    onSettled: () => {
      setAsking(null);
      return queryClient.invalidateQueries({ queryKey: chatKeys.all });
    },
  });

  return (
    <div role="dialog" aria-label="Your chats" className="absolute inset-0 z-10 flex flex-col bg-bg">
      <header className="flex shrink-0 items-center justify-between px-2 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="size-11" aria-hidden="true" />
        <h2 className="text-base font-semibold">Your chats</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-11 items-center justify-center rounded-full transition active:bg-surface-2"
        >
          <X size={22} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        <div className="mx-auto w-full max-w-md">
          {chats.isPending && <p className="py-10 text-center text-sm text-ink-2">Loading…</p>}
          {chats.isError && (
            <p className="py-10 text-center text-sm text-ink-2">Couldn&apos;t load your chats.</p>
          )}
          {chats.data?.length === 0 && (
            <p className="py-10 text-center text-sm text-ink-2">
              No saved chats yet. Your conversations with Penny will appear here.
            </p>
          )}
          {remove.isError && (
            <p role="alert" className="mt-2 rounded-2xl bg-expense-soft px-4 py-3 text-sm font-medium text-expense">
              {remove.error.message}
            </p>
          )}
          <ul className="flex flex-col gap-2 pt-2">
            {chats.data?.map((chat) => (
              <li
                key={chat.id}
                className={`flex items-center gap-1 rounded-[1.25rem] border bg-surface-2 pr-1.5 ${
                  chat.id === currentId ? "border-gold/60" : "border-line"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(chat.id)}
                  className="min-w-0 flex-1 rounded-[1.25rem] px-4 py-3 text-left transition active:scale-[0.99]"
                >
                  <span className="block truncate text-base font-semibold">{chat.title}</span>
                  <span className="block text-xs text-ink-2">
                    {dayLabel(localDateKey(chat.updatedAt))}
                  </span>
                </button>
                {asking === chat.id ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate(chat.id)}
                    disabled={remove.isPending}
                    className="h-9 shrink-0 rounded-full bg-expense px-3.5 text-sm font-semibold text-bg transition active:scale-95 disabled:opacity-60"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAsking(chat.id)}
                    aria-label={`Delete chat: ${chat.title}`}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full text-ink-3 transition active:bg-line"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
