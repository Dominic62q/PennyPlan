import AppLayout from "../../(app)/layout";
import AppTemplate from "../../(app)/template";

// The same frame the real signed-in screens get: bottom bar, splash, padding.
export default function ShellLayout({ children, params }: LayoutProps<"/dev-preview">) {
  return (
    <AppLayout params={params}>
      <AppTemplate>{children}</AppTemplate>
    </AppLayout>
  );
}
