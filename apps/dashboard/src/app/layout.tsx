import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TokenLens - Token Intelligence for AI Coding Tools",
  description: "See what you spend, where the waste is, and what you're about to spend. Zero API keys. All processing happens locally.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
