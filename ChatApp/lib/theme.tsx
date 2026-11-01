import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "@/hooks/use-color-scheme";

const light = {
  background: "#F4F6F5",
  surface: "#FFFFFF",
  surfaceAlt: "#EDF1EF",
  surfaceHover: "#E6ECE9",
  selected: "#DDEFEA",
  border: "#E1E7E4",
  text: "#111917",
  textMuted: "#56635F",
  textFaint: "#8A9692",
  primary: "#0E7C6B",
  primaryPressed: "#0A6557",
  onPrimary: "#FFFFFF",
  primarySoft: "#DCF1EB",
  chatBackground: "#EEF2F0",
  bubbleMine: "#0E7C6B",
  bubbleMineText: "#FFFFFF",
  bubbleMineMuted: "rgba(255,255,255,0.72)",
  bubbleTheirs: "#FFFFFF",
  bubbleTheirsText: "#111917",
  readTick: "#9BF0DE",
  danger: "#D33A3F",
  dangerSoft: "#FCEBEB",
  warning: "#A86A0C",
  warningSoft: "#FDF3E1",
  online: "#22B35E",
  overlay: "rgba(6, 14, 12, 0.45)",
};

export type Palette = typeof light;

const dark: Palette = {
  background: "#0B1110",
  surface: "#111A18",
  surfaceAlt: "#18231F",
  surfaceHover: "#1C2925",
  selected: "#153A33",
  border: "#21302B",
  text: "#E8EFEC",
  textMuted: "#9AA9A4",
  textFaint: "#6B7A75",
  primary: "#25B39A",
  primaryPressed: "#1E9883",
  onPrimary: "#04120F",
  primarySoft: "#123A32",
  chatBackground: "#0E1614",
  bubbleMine: "#1C8C79",
  bubbleMineText: "#F2FBF8",
  bubbleMineMuted: "rgba(242,251,248,0.7)",
  bubbleTheirs: "#1A2522",
  bubbleTheirsText: "#E8EFEC",
  readTick: "#A6F5E4",
  danger: "#F0676B",
  dangerSoft: "#3A1C1D",
  warning: "#E8B04B",
  warningSoft: "#33270F",
  online: "#34D07A",
  overlay: "rgba(0, 0, 0, 0.6)",
};

export type ThemePreference = "system" | "light" | "dark";

type ThemeContextValue = {
  colors: Palette;
  scheme: "light" | "dark";
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const STORAGE_KEY = "theme-preference";
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(value => {
        if (value === "light" || value === "dark" || value === "system") setPreferenceState(value);
      })
      .catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const scheme = preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
    return {
      colors: scheme === "dark" ? dark : light,
      scheme,
      preference,
      setPreference: next => {
        setPreferenceState(next);
        AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      },
    };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
