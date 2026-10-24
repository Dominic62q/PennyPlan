import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";
import { LAUNCH_SCRIPT } from "@/components/launch-overlay";
import { PersistStorage } from "@/components/persist-storage";
import { Providers } from "@/components/providers";
import { ThemeSync } from "@/components/theme-sync";
import { UpdatePrompt } from "@/components/update-prompt";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Penny Plan",
  title: { default: "Penny Plan", template: "%s | Penny Plan" },
  description: "Track income, expenses and budgets in a few seconds.",
  appleWebApp: {
    capable: true,
    title: "Penny Plan",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#080c0b" },
  ],
  colorScheme: "light dark",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-GH"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Keeps the area under the iPhone status bar the page colour, so
            scrolled content doesn't show through behind the clock. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-[env(safe-area-inset-top)] bg-bg"
        />
        <SerwistProvider swUrl="/serwist/sw.js">
          <Providers>{children}</Providers>
        </SerwistProvider>
        <PersistStorage />
        <ThemeSync />
        <UpdatePrompt />
      </body>
    </html>
  );
}
