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
        // Accent — coral (primary)
        accent: {
          DEFAULT: "var(--accent)",
          text: "var(--accent-text)",
          on: "var(--on-accent)",
          dim: "var(--accent-dim)",
          line: "var(--accent-line)",
        },
        // Cyan (secondary / data / glow), navy (cinematic), critical
        cyan: {
          DEFAULT: "var(--cyan)",
          dim: "var(--cyan-dim)",
          line: "var(--cyan-line)",
        },
        navy: "var(--navy)",
        critical: "var(--critical)",
        // Semantic status
        status: {
          green: "var(--status-green)",
          amber: "var(--status-amber)",
          orange: "var(--status-orange)",
          red: "var(--status-red)",
        },
        // Legacy prune aliases (mapped; not used as accents)
        prune: {
          green: "var(--prune-green)",
          amber: "var(--prune-amber)",
          red: "var(--prune-red)",
          gray: "var(--prune-gray)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        "2xl": "16px",
        xl: "14px",
        lg: "12px",
        md: "9px",
        sm: "6px",
      },
      boxShadow: {
        glow: "0 0 0 1px var(--accent-line), 0 0 30px -8px var(--accent-dim)",
        "glow-cyan": "0 0 0 1px var(--cyan-line), 0 0 30px -8px var(--cyan-dim)",
        panel: "0 1px 0 0 var(--line)",
        lift: "0 16px 50px -24px rgba(0,0,0,0.6)",
      },
      maxWidth: {
        content: "1200px",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
export default config;
