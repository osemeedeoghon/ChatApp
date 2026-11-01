import { View } from "react-native";
import { ConversationList } from "@/components/conversation-list";
import { EmptyState } from "@/components/ui";
import { useIsWide } from "@/hooks/use-layout";
import { useTheme } from "@/lib/theme";

export default function ConversationsScreen() {
  const isWide = useIsWide();
  const { colors } = useTheme();

  // On wide screens the list is already in the sidebar; this pane is the placeholder.
  if (isWide) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.chatBackground }}>
        <EmptyState
          icon="chatbubbles-outline"
          title="Pick a conversation"
          message="Choose a chat from the list, or start a new one with the pencil button."
        />
      </View>
    );
  }
  return <ConversationList />;
}
