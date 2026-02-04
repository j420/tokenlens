import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
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
