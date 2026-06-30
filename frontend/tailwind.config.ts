import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./src/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // 紫色主题色
        primary: {
          DEFAULT: "#645ba1",
          50: "#fbfbfb",
          100: "#d7d9fa",
          200: "#b8baed",
          300: "#9f9fdd",
          400: "#7d79c1",
          500: "#645ba1",
          600: "#504994",
          700: "#363c87",
          800: "#2a2d52",
          900: "#1a1d3a"
        },
        surface: {
          DEFAULT: "#fbfbfb",
          dark: "#1a1d3a"
        },
        background: {
          light: "#fbfbfb",
          dark: "#1a1d3a"
        },
        card: {
          light: "#ffffff",
          dark: "#2a2d52"
        }
      }
    }
  },
  plugins: []
};

export default config;
