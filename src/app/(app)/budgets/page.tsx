import { Suspense } from "react";
import { BudgetsScreen } from "@/components/budgets-screen";

export const metadata = { title: "Budgets" };

// The screen reads today's date, which has to wait for the browser.
export default function BudgetsPage() {
  return (
    <Suspense fallback={null}>
      <BudgetsScreen />
    </Suspense>
  );
}
