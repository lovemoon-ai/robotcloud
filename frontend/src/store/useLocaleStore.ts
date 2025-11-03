import { create } from "zustand";

export type Locale = "zh" | "en";

interface LocaleState {
  locale: Locale;
  toggleLocale: () => void;
  setLocale: (locale: Locale) => void;
  reset: () => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: "zh",
  toggleLocale: () =>
    set((state) => ({
      locale: state.locale === "zh" ? "en" : "zh"
    })),
  setLocale: (locale) => set({ locale }),
  reset: () => set({ locale: "zh" })
}));
