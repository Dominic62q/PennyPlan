import { Suspense } from "react";
import { QuickAdd } from "@/components/quick-add";

export const metadata = { title: "Add entry" };

export default function AddPage() {
  return (
    <Suspense fallback={null}>
      <QuickAdd />
    </Suspense>
  );
}
