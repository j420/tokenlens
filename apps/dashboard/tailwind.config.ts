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
        // Core surfaces (CSS-variable backed; dark-first)
        background: "var(--background)",
        foreground: "var(--foreground)",
        secondary: "var(--secondary)",
        muted: "var(--muted)",
        border: "var(--border)",
        line: "var(--line)",
        card: "var(--card)",
        "card-hover": "var(--card-hover)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        "code-bg": "var(--code-bg)",
        // Ownable accent — signal lime
        accent: {
          DEFAULT: "var(--accent)",
          text: "var(--accent-text)",
          on: "var(--on-accent)",
          dim: "var(--accent-dim)",
          line: "var(--accent-line)",
        },
        cool: "var(--cool)",
        // Semantic status
        status: {
          green: "var(--status-green)",
          amber: "var(--status-amber)",
          orange: "var(--status-orange)",
          red: "var(--status-red)",
        },
        // Legacy prune aliases (mapped; not used as accents anymore)
        prune: {
          green: "var(--prune-green)",
          amber: "var(--prune-amber)",
          red: "var(--prune-red)",
          gray: "var(--prune-gray)",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      borderRadius: {
        lg: "12px",
        md: "9px",
        sm: "6px",
      },
      boxShadow: {
        glow: "0 0 0 1px var(--accent-line), 0 0 28px -6px var(--accent-dim)",
        panel: "0 1px 0 0 var(--line)",
        lift: "0 12px 40px -16px rgba(0,0,0,0.45)",
      },
      maxWidth: {
        content: "1180px",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
export default config;
