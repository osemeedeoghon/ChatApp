import { useEffect, useState } from "react";
import { View } from "react-native";
import { Banner } from "@/components/ui";
import { useChatState } from "@/lib/chat-context";
import { space } from "@/lib/theme";

/** Shown only when the real-time connection has been down for a moment, to avoid flicker. */
export function ConnectionBanner() {
  const connection = useChatState(s => s.connection);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (connection === "connected") {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(timer);
  }, [connection]);

  if (!show) return null;
  return (
    <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
      <Banner
        tone="warning"
        message={
          connection === "connecting"
            ? "Connection lost. Reconnecting…"
            : "You're offline. New messages will appear once you're back online."
        }
      />
    </View>
  );
}
