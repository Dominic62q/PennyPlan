import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MockProvider } from "./mock-provider";

// Look at the signed-in screens with made-up data. Dev only: it 404s in
// production, and the proxy only lets it through outside production.
export default function DevPreviewLayout({ children }: LayoutProps<"/dev-preview">) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <MockProvider>{children}</MockProvider>
    </Suspense>
  );
}
