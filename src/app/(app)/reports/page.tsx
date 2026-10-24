import { Suspense } from "react";
import { ReportsScreen } from "@/components/reports-screen";

export const metadata = { title: "Reports" };

// The screen reads today's date, which has to wait for the browser.
export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsScreen />
    </Suspense>
  );
}
