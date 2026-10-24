import { Suspense } from "react";
import { TransactionsScreen } from "@/components/transactions-screen";

export const metadata = { title: "Activity" };

export default function TransactionsPage() {
  return (
    <Suspense fallback={null}>
      <TransactionsScreen />
    </Suspense>
  );
}
