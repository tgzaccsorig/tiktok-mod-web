import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { red: "#fe2c55", cyan: "#25f4ee" },
      },
    },
  },
  plugins: [],
};

export default config;
