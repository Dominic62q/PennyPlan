export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">You&apos;re offline</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        This page isn&apos;t saved on your phone yet. Anything you add will be
        kept and synced when you&apos;re back online.
      </p>
    </main>
  );
}
