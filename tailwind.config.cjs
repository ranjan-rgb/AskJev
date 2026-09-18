/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./extension/**/*.{html,js}", "./src/ui/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        zinc: {
          950: "#09090b",
          925: "#0c0c0e",
          900: "#18181b",
          850: "#1f1f23",
          800: "#27272a",
          700: "#3f3f46",
          500: "#71717a",
          400: "#a1a1aa",
          300: "#d4d4d8",
          100: "#f4f4f5",
          50: "#fafafa",
        },
      },
      fontSize: {
        "2xs": ["10px", "1.35"],
        "13": ["13px", "1.45"],
      },
      width: { popup: "300px" },
    },
  },
  plugins: [],
};
