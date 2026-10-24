"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Composer } from "@/components/assistant/composer";
import { TextBubble } from "@/components/assistant/messages";
import { Mascot } from "@/components/ui/mascot";
import { ReviewCard } from "@/components/assistant/review-card";
import type { Review } from "@/lib/assistant/types";
import { categoriesQuery } from "@/lib/queries";

// The review card and the attach menu with made-up data. Dev only (the layout
// above 404s in production).

function Demo({ initial }: { initial: Review }) {
  const [review, setReview] = useState(initial);
  return (
    <ReviewCard
      review={review}
      onChange={setReview}
      onAccount={async (accountId) => setReview((r) => ({ ...r, accountId }))}
      onConfirm={async () => setReview((r) => ({ ...r, status: "done" }))}
      onSkip={() => setReview((r) => ({ ...r, status: "kept" }))}
    />
  );
}

const REPLY = [
  "Here's what I can help with:",
  "",
  "- **Look things up** – spending, income, account balances and how you're doing against last month.",
  "- **Record money** – add or edit an expense or income, or paste a longer list and confirm it in one go.",
  "- **Budgets** – set a monthly limit, check progress, remove one.",
  "",
  "You can ask in plain words, like `how much did I spend on food?`",
].join("\n");

export default function ReviewPreview() {
  const categories = useQuery(categoriesQuery()).data ?? [];
  const spending = categories.find((c) => c.kind === "expense" && !c.parentId)?.id ?? null;
  const row = (over: Partial<Review["rows"][number]>) => ({
    id: crypto.randomUUID(),
    include: true,
    type: "expense" as const,
    date: "2026-10-14",
    payee: "Melcom Supermarket",
    amount: "225.40",
    categoryId: spending,
    duplicate: false,
    ...over,
  });

  const receipt: Review = {
    status: "pending",
    source: "receipt",
    accountId: "acc-momo",
    currency: "GHS",
    rows: [row({})],
    note: "Bread loaf x2 24.00, Milk 1L 18.50",
    warnings: [],
  };
  const statement: Review = {
    status: "pending",
    source: "statement",
    accountId: "acc-momo",
    currency: "GHS",
    rows: [
      row({ payee: "Payment to Shoprite", amount: "85.50", date: "2026-10-02" }),
      row({ payee: "Salary from Acme Ltd", amount: "3000.00", type: "income", categoryId: null, date: "2026-10-03" }),
      row({ payee: "Cash out Kwame Boateng", amount: "200.00", date: "2026-10-05", duplicate: true, include: false }),
    ],
    note: null,
    warnings: ["1 line couldn't be read and left out."],
  };
  const dollars: Review = { ...receipt, currency: "USD" };

  return (
    <div className="min-h-dvh space-y-6 bg-bg p-4 pb-40 text-ink">
      <div className="flex flex-col gap-3">
        <p className="self-end rounded-[1.25rem] rounded-br-md bg-gold px-4 py-3 font-medium text-on-gold">What can I do with this app?</p>
        <div className="flex items-start gap-2.5">
          <Mascot size={28} animate={false} />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2.5">
            <TextBubble text={REPLY} />
          </div>
        </div>
      </div>
      <Demo initial={receipt} />
      <Demo initial={statement} />
      <Demo initial={dollars} />
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md bg-bg p-3">
        <Composer busy={false} onSend={() => {}} onAttach={() => {}} onStop={() => {}} />
      </div>
    </div>
  );
}
