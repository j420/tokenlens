import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "TokenLens - Token Intelligence for AI Coding Tools",
  description: "See what you spend, where the waste is, and what you're about to spend. Zero API keys. All processing happens locally.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "TokenLens - Token Intelligence for AI Coding Tools",
    description: "See what you spend, where the waste is, and what you're about to spend.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F0F0EB" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
