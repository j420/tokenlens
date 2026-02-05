import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prune - Token Intelligence for AI Coding Tools",
  description: "See what you spend, where the waste is, and what you're about to spend.",
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
    <html lang="en">
      <body className="min-h-screen bg-gray-50 antialiased">{children}</body>
    </html>
  );
}
