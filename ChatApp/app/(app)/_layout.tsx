import { Redirect, Stack } from "expo-router";
import { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { ConversationList } from "@/components/conversation-list";
import { FullScreenLoader } from "@/components/ui";
import { useIsWide } from "@/hooks/use-layout";
import { useAuth } from "@/lib/auth";
import { ChatProvider, useTotalUnread } from "@/lib/chat-context";
import { useTheme } from "@/lib/theme";

/** Shows the unread total in the browser tab title. */
function UnreadTitle() {
  const total = useTotalUnread();
  useEffect(() => {
    if (Platform.OS !== "web") return;
    document.title = total > 0 ? `(${total}) ChatApp` : "ChatApp";
  }, [total]);
  return null;
}

export default function AppLayout() {
  const { status, user } = useAuth();
  const { colors } = useTheme();
  const isWide = useIsWide();

  if (status === "loading") return <FullScreenLoader />;
  if (status !== "signedIn" || !user) return <Redirect href="/" />;

  return (
    <ChatProvider key={user.id} user={user}>
      <UnreadTitle />
      <View style={[styles.row, { backgroundColor: colors.background }]}>
        {/* The sidebar is inserted before the stack so the stack keeps its position (and state) on resize. */}
        {isWide && (
          <View style={[styles.sidebar, { borderRightColor: colors.border }]}>
            <ConversationList />
          </View>
        )}
        <View style={styles.main}>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: isWide ? "none" : "default",
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        </View>
      </View>
    </ChatProvider>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  sidebar: { width: 360, maxWidth: "40%", borderRightWidth: StyleSheet.hairlineWidth },
  main: { flex: 1 },
});
