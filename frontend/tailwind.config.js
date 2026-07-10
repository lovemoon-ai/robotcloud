/** @type {import("tailwindcss").Config} */
const config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./src/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "rgb(var(--color-primary-rgb) / <alpha-value>)",
          50: "#fafafa",
          100: "#f4f4f5",
          200: "#e4e4e7",
          300: "#d4d4d8",
          400: "#a1a1aa",
          500: "#71717a",
          600: "#52525b",
          700: "#3f3f46",
          800: "#27272a",
          900: "#111111"
        },
        surface: {
          DEFAULT: "#f7f7f7",
          dark: "#0b0b0b"
        },
        background: {
          light: "#f7f7f7",
          dark: "#0b0b0b"
        },
        card: {
          light: "#ffffff",
          dark: "#141414"
        }
      }
    }
  },
  plugins: []
};

module.exports = config;
