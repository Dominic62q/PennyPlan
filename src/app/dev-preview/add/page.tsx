import { Suspense } from "react";
import { QuickAdd } from "@/components/quick-add";

export default function PreviewAddPage() {
  return (
    <Suspense fallback={null}>
      <QuickAdd />
    </Suspense>
  );
}
