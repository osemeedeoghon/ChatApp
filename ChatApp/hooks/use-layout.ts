import { useEffect, useState } from "react";
import { AppState, Platform, useWindowDimensions } from "react-native";

/** Tablet/desktop widths show the conversation list and chat side by side. */
export const WIDE_BREAKPOINT = 768;

export function useIsWide() {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}

function currentlyVisible() {
  if (Platform.OS === "web") return typeof document === "undefined" || document.visibilityState === "visible";
  return AppState.currentState === "active";
}

/** Whether the user can actually see the app (tab visible / app in foreground). */
export function useAppVisible() {
  const [visible, setVisible] = useState(currentlyVisible);

  useEffect(() => {
    if (Platform.OS === "web") {
      const onChange = () => setVisible(document.visibilityState === "visible");
      document.addEventListener("visibilitychange", onChange);
      window.addEventListener("focus", onChange);
      return () => {
        document.removeEventListener("visibilitychange", onChange);
        window.removeEventListener("focus", onChange);
      };
    }
    const sub = AppState.addEventListener("change", state => setVisible(state === "active"));
    return () => sub.remove();
  }, []);

  return visible;
}
