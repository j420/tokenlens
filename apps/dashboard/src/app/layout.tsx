import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prune — deterministic cost control for AI coding agents",
  description:
    "See what you spend, where the waste is, and what you're about to spend — then cut it. Deterministic, fail-safe, local-first. Zero API keys.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Prune — deterministic cost control for AI coding agents",
    description:
      "Deterministic, auditable token-cost reduction for Claude Code, Cursor and Codex. Local-first. No fabricated numbers.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Dark-first, no-flash: resolve the theme class before first paint.
const themeScript = `
(function(){try{
  var s=localStorage.getItem('prune_theme');
  var dark = s==='dark' || (s==='light'?false : (s==='system'? matchMedia('(prefers-color-scheme: dark)').matches : true));
  document.documentElement.classList.toggle('dark', !!dark);
}catch(e){document.documentElement.classList.add('dark');}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
