import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { memo, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { ConnectionBanner } from "@/components/connection-banner";
import { Banner, Button, EmptyState, IconButton, TextField } from "@/components/ui";
import { useIsWide } from "@/hooks/use-layout";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useChatState, useChatStore, useSortedConversations } from "@/lib/chat-context";
import {
  conversationTitle, formatListTimestamp, messagePreview, otherMember,
} from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { Conversation, Message } from "@/lib/types";

type SearchItem = { kind: "chat"; conversation: Conversation } | { kind: "message"; message: Message };

export function ConversationList() {
  const { colors } = useTheme();
  const router = useRouter();
  const isWide = useIsWide();
  const insets = useSafeAreaInsets();
  const store = useChatStore();
  const { user } = useAuth();
  const conversations = useSortedConversations();
  const loaded = useChatState(s => s.conversationsLoaded);
  const loadError = useChatState(s => s.conversationsError);
  const pathname = usePathname();
  const activeId = Number(pathname.match(/^\/chat\/(\d+)/)?.[1]) || null;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const trimmed = query.trim();

  // Debounced message search across all of my conversations.
  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(null);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .search(trimmed)
        .then(found => !cancelled && (setResults(found), setSearchError(null)))
        .catch(err => !cancelled && setSearchError(errorMessage(err)))
        .finally(() => !cancelled && setSearching(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  const filtered = useMemo(() => {
    if (!trimmed) return conversations;
    const needle = trimmed.toLowerCase();
    return conversations.filter(c => {
      if (conversationTitle(c, store.me.id).toLowerCase().includes(needle)) return true;
      return c.members.some(m => m.id !== store.me.id && m.email.toLowerCase().includes(needle));
    });
  }, [conversations, trimmed, store.me.id]);

  const open = (conversationId: number) => {
    const target = { pathname: "/chat/[id]" as const, params: { id: String(conversationId) } };
    if (isWide) router.replace(target);
    else router.push(target);
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
      <Pressable
        onPress={() => router.push("/profile")}
        accessibilityRole="button"
        accessibilityLabel="Profile and settings"
        style={styles.headerProfile}
      >
        <Avatar name={user?.displayName ?? store.me.displayName} seed={store.me.id} size={36} />
      </Pressable>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        Chats
      </Text>
      <IconButton icon="create-outline" label="New chat" onPress={() => router.push("/new")} />
    </View>
  );

  const searchBox = (
    <View style={styles.search}>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder="Search chats and messages"
        icon="search"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        containerStyle={{ marginBottom: 0 }}
        accessibilityLabel="Search chats and messages"
      />
    </View>
  );

  let body;
  if (!loaded) {
    body = <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.primary} />;
  } else if (loadError && conversations.length === 0) {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load your chats"
        message={loadError}
        action={<Button title="Try again" icon="refresh" onPress={() => store.loadConversations()} />}
      />
    );
  } else if (trimmed) {
    const sections: { key: string; title: string; data: SearchItem[] }[] = [
      { key: "chats", title: "Chats", data: filtered.map((c): SearchItem => ({ kind: "chat", conversation: c })) },
      { key: "messages", title: "Messages", data: (results ?? []).map((m): SearchItem => ({ kind: "message", message: m })) },
    ].filter(s => s.data.length > 0);

    body = (
      <SectionList
        sections={sections}
        keyExtractor={item => (item.kind === "chat" ? `c${item.conversation.id}` : `m${item.message.id}`)}
        keyboardShouldPersistTaps="handled"
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: colors.textFaint }]}>{section.title}</Text>
        )}
        renderItem={({ item }) =>
          item.kind === "chat" ? (
            <ConversationRow conversation={item.conversation} active={item.conversation.id === activeId} onPress={open} />
          ) : (
            <SearchResultRow message={item.message} query={trimmed} onPress={open} />
          )
        }
        ListFooterComponent={
          searching ? (
            <ActivityIndicator style={{ margin: space.lg }} color={colors.primary} />
          ) : searchError ? (
            <View style={{ padding: space.lg }}>
              <Banner tone="error" message={searchError} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          searching || trimmed.length < 2 ? null : (
            <EmptyState icon="search" title="No results" message={`Nothing matches “${trimmed}”.`} />
          )
        }
      />
    );
  } else if (conversations.length === 0) {
    body = (
      <EmptyState
        icon="chatbubbles-outline"
        title="No conversations yet"
        message="Start a chat with someone or create a group to get going."
        action={<Button title="Start a chat" icon="add" onPress={() => router.push("/new")} />}
      />
    );
  } else {
    body = (
      <FlatList
        data={filtered}
        keyExtractor={c => String(c.id)}
        renderItem={({ item }) => (
          <ConversationRow conversation={item} active={item.id === activeId} onPress={open} />
        )}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.lg }}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {header}
      <ConnectionBanner />
      {searchBox}
      {body}
    </View>
  );
}

const ConversationRow = memo(function ConversationRow({
  conversation, active, onPress,
}: { conversation: Conversation; active: boolean; onPress: (id: number) => void }) {
  const { colors } = useTheme();
  const store = useChatStore();
  const typing = useChatState(s => s.typing[conversation.id]);
  const meId = store.me.id;
  const other = otherMember(conversation, meId);
  const title = conversationTitle(conversation, meId);
  const isGroup = conversation.type === "group";
  const unread = conversation.unreadCount;

  const typingIds = typing ? Object.keys(typing).map(Number) : [];
  const typingNames = typingIds
    .map(id => conversation.members.find(m => m.id === id)?.displayName.split(" ")[0])
    .filter(Boolean);

  const preview =
    typingNames.length > 0
      ? isGroup
        ? `${typingNames.join(", ")} typing…`
        : "typing…"
      : conversation.lastMessage
        ? messagePreview(conversation.lastMessage, conversation, meId)
        : isGroup
          ? `${conversation.members.length} members`
          : "Say hello 👋";
  const timestamp = conversation.lastMessage?.createdAt ?? conversation.updatedAt;

  return (
    <Pressable
      onPress={() => onPress(conversation.id)}
      accessibilityRole="button"
      accessibilityLabel={`${title}${unread ? `, ${unread} unread` : ""}. ${preview}`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && { backgroundColor: colors.surfaceHover },
        active && { backgroundColor: colors.selected },
      ]}
    >
      <Avatar name={title} seed={isGroup ? conversation.id + 3 : (other?.id ?? 0)} online={!isGroup && other?.online} group={isGroup} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
            {title}
          </Text>
          <Text style={[styles.rowTime, { color: unread ? colors.primary : colors.textFaint }]}>
            {formatListTimestamp(timestamp)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text
            numberOfLines={1}
            style={[
              styles.rowPreview,
              { color: typingNames.length ? colors.primary : unread ? colors.text : colors.textMuted },
              unread > 0 && { fontWeight: "600" },
              conversation.lastMessage?.deletedAt && !typingNames.length && { fontStyle: "italic" },
            ]}
          >
            {preview}
          </Text>
          {unread > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.onPrimary }]}>{unread > 99 ? "99+" : unread}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
});

function SearchResultRow({ message, query, onPress }: { message: Message; query: string; onPress: (id: number) => void }) {
  const { colors } = useTheme();
  const conversation = useChatState(s => s.conversations[message.conversationId]);
  const store = useChatStore();
  const title = conversation ? conversationTitle(conversation, store.me.id) : message.senderName;
  const text = message.text ?? "";
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  // Show some context around the match.
  const start = Math.max(0, index - 30);
  const snippet = (start > 0 ? "…" : "") + text.slice(start);

  return (
    <Pressable
      onPress={() => onPress(message.conversationId)}
      accessibilityRole="button"
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && { backgroundColor: colors.surfaceHover },
      ]}
    >
      <View style={[styles.resultIcon, { backgroundColor: colors.surfaceAlt }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.textMuted} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
            {title}
          </Text>
          <Text style={[styles.rowTime, { color: colors.textFaint }]}>{formatListTimestamp(message.createdAt)}</Text>
        </View>
        <Text numberOfLines={2} style={[styles.rowPreview, { color: colors.textMuted }]}>
          <Text style={{ fontWeight: "600" }}>{message.senderId === store.me.id ? "You" : message.senderName}: </Text>
          {snippet}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    gap: space.md,
  },
  headerProfile: { borderRadius: radius.pill },
  title: { flex: 1, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  search: { paddingHorizontal: space.lg, paddingBottom: space.sm, paddingTop: space.xs },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    gap: space.md,
    marginHorizontal: space.sm,
    borderRadius: radius.md,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: "600" },
  rowTime: { fontSize: 12 },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 3 },
  rowPreview: { flex: 1, fontSize: 14 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
  resultIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
