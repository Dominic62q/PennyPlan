import { Suspense } from "react";
import { BillsScreen } from "@/components/bills-screen";

export const metadata = { title: "Bills" };

// Due dates are compared with today, which has to wait for the browser.
export default function BillsPage() {
  return (
    <Suspense fallback={null}>
      <BillsScreen />
    </Suspense>
  );
}
