import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Core monochromatic palette
        background: "var(--background)",
        foreground: "var(--foreground)",
        secondary: "var(--secondary)",
        border: "var(--border)",
        muted: "var(--muted)",
        card: "var(--card)",
        "card-hover": "var(--card-hover)",
        "code-bg": "var(--code-bg)",
        // Semantic status colors (only allowed color)
        status: {
          green: "var(--status-green)",
          amber: "var(--status-amber)",
          orange: "var(--status-orange)",
          red: "var(--status-red)",
        },
        // Legacy prune colors for compatibility
        prune: {
          green: "#10b981",
          amber: "#f59e0b",
          red: "#ef4444",
          gray: "#6b7280",
        },
      },
    },
  },
  plugins: [],
};
export default config;
