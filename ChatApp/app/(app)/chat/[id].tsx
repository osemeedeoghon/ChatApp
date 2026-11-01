import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { ConversationInfoSheet, ImageViewer, MessageActionsSheet } from "@/components/chat-sheets";
import { Composer, type ComposerContext } from "@/components/composer";
import { ConnectionBanner } from "@/components/connection-banner";
import { MessageBubble, type DisplayMessage } from "@/components/message-bubble";
import { Banner, Button, ConfirmDialog, EmptyState, FullScreenLoader, IconButton } from "@/components/ui";
import { useAppVisible, useIsWide } from "@/hooks/use-layout";
import { errorMessage } from "@/lib/api";
import { useChatState, useChatStore } from "@/lib/chat-context";
import { EMPTY_MESSAGES } from "@/lib/chat-store";
import { absoluteUrl } from "@/lib/config";
import {
  attachmentLabel, conversationTitle, deliveryStatus, firstName, formatDayLabel, formatLastSeen,
  isSameDay, otherMember,
} from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { Attachment, Conversation, LocalFile } from "@/lib/types";

type Row =
  | { kind: "day"; key: string; label: string }
  | {
      kind: "message";
      key: string;
      message: DisplayMessage;
      showSender: boolean;
      groupedWithPrev: boolean;
      groupedWithNext: boolean;
    };

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export default function ChatRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(params.id);
  const store = useChatStore();
  const conversation = useChatState(s => s.conversations[conversationId]);
  const conversationsLoaded = useChatState(s => s.conversationsLoaded);
  const [missing, setMissing] = useState(false);

  // Opened via a link to a conversation that isn't in the list yet.
  useEffect(() => {
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
      setMissing(true);
      return;
    }
    if (conversation || !conversationsLoaded) return;
    store.ensureConversation(conversationId).catch(() => setMissing(true));
  }, [conversation, conversationsLoaded, conversationId, store]);

  if (conversation) return <ChatScreen key={conversationId} conversation={conversation} />;
  if (missing) return <NotFound />;
  return <FullScreenLoader />;
}

function NotFound() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.chatBackground }}>
      <EmptyState
        icon="lock-closed-outline"
        title="Conversation unavailable"
        message="It doesn't exist or you're no longer a member."
        action={<Button title="Back to chats" onPress={() => router.replace("/conversations")} />}
      />
    </View>
  );
}

function ChatScreen({ conversation }: { conversation: Conversation }) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWide = useIsWide();
  const appVisible = useAppVisible();
  const store = useChatStore();
  const meId = store.me.id;
  const conversationId = conversation.id;
  const messages = useChatState(s => s.messages[conversationId] ?? EMPTY_MESSAGES);
  const typing = useChatState(s => s.typing[conversationId]);

  const [focused, setFocused] = useState(true);
  const [composerContext, setComposerContext] = useState<ComposerContext>(null);
  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [actionTarget, setActionTarget] = useState<DisplayMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DisplayMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewerImage, setViewerImage] = useState<{ uri: string; attachment: Attachment | null } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  useEffect(() => {
    store.loadMessages(conversationId);
  }, [conversationId, store]);

  // Read receipts are only sent while the conversation is actually on screen.
  const latestId = conversation.lastMessage?.id;
  useEffect(() => {
    if (focused && appVisible && messages.loaded) store.markRead(conversationId);
  }, [focused, appVisible, messages.loaded, latestId, conversation.unreadCount, conversationId, store]);

  const isGroup = conversation.type === "group";
  const other = otherMember(conversation, meId);
  const title = conversationTitle(conversation, meId);

  const typingNames = typing
    ? Object.keys(typing)
        .map(id => conversation.members.find(m => m.id === Number(id))?.displayName)
        .filter((n): n is string => !!n)
        .map(firstName)
    : [];

  const subtitle =
    typingNames.length > 0
      ? isGroup
        ? `${typingNames.join(", ")} ${typingNames.length > 1 ? "are" : "is"} typing…`
        : "typing…"
      : isGroup
        ? conversation.members.map(m => (m.id === meId ? "You" : firstName(m.displayName))).join(", ")
        : other
          ? formatLastSeen(other)
          : "";

  // Build the rows oldest → newest, then reverse for the inverted list.
  const rows = useMemo(() => {
    const display: DisplayMessage[] = [
      ...messages.items.map(m => ({
        key: `m${m.id}`,
        id: m.id,
        clientId: m.clientId,
        senderId: m.senderId,
        senderName: m.senderName,
        text: m.text,
        createdAt: m.createdAt,
        editedAt: m.editedAt,
        deletedAt: m.deletedAt,
        replyTo: m.replyTo,
        attachment: m.attachment,
        localFile: null,
        reactions: m.reactions,
        status: m.senderId === meId ? deliveryStatus(m, conversation, meId) : ("sent" as const),
        error: null,
      })),
      ...messages.pending.map(p => ({
        key: `p${p.clientId}`,
        id: null,
        clientId: p.clientId,
        senderId: meId,
        senderName: store.me.displayName,
        text: p.text,
        createdAt: p.createdAt,
        editedAt: null,
        deletedAt: null,
        replyTo: p.replyTo,
        attachment: null,
        localFile: p.file,
        reactions: [],
        status: p.status,
        error: p.error,
      })),
    ];

    const result: Row[] = [];
    display.forEach((message, i) => {
      const prev = display[i - 1];
      const next = display[i + 1];
      const newDay = !prev || !isSameDay(prev.createdAt, message.createdAt);
      if (newDay) result.push({ kind: "day", key: `d${message.createdAt.slice(0, 10)}-${message.key}`, label: formatDayLabel(message.createdAt) });
      const closeTo = (a?: DisplayMessage, b?: DisplayMessage) =>
        !!a && !!b && a.senderId === b.senderId && isSameDay(a.createdAt, b.createdAt) &&
        Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) < GROUP_WINDOW_MS;
      const groupedWithPrev = !newDay && closeTo(prev, message);
      result.push({
        kind: "message",
        key: message.key,
        message,
        showSender: isGroup && !groupedWithPrev,
        groupedWithPrev,
        groupedWithNext: closeTo(message, next) && (!next || isSameDay(message.createdAt, next.createdAt)),
      });
    });
    return result.reverse();
  }, [messages.items, messages.pending, conversation, meId, isGroup, store.me.displayName]);

  // ─── Actions ─────────────────────────────────────────

  const handleSend = (text: string, file: LocalFile | null) => {
    setActionError(null);
    if (editingId !== null) {
      const id = editingId;
      setEditingId(null);
      setComposerContext(null);
      store.editMessage(id, text).catch(err => setActionError(errorMessage(err)));
      return;
    }
    const replyTo = replyToId ? messages.items.find(m => m.id === replyToId) : null;
    store.send(conversationId, {
      text: text || null,
      file,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            senderId: replyTo.senderId,
            senderName: replyTo.senderName,
            text: replyTo.text,
            deleted: !!replyTo.deletedAt,
            hasAttachment: !!replyTo.attachment,
          }
        : null,
    });
    setReplyToId(null);
    setComposerContext(null);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const startReply = (message: DisplayMessage) => {
    if (message.id === null) return;
    setEditingId(null);
    setReplyToId(message.id);
    setComposerContext({
      kind: "reply",
      title: message.senderId === meId ? "yourself" : message.senderName,
      text: message.text || attachmentLabel(message),
    });
  };

  const startEdit = (message: DisplayMessage) => {
    if (message.id === null || !message.text) return;
    setReplyToId(null);
    setEditingId(message.id);
    setComposerContext({ kind: "edit", text: message.text });
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      await store.deleteMessage(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteTarget(null);
      setActionError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const toggleReaction = useCallback(
    (messageId: number, emoji: string) => {
      store.toggleReaction(messageId, emoji).catch(err => setActionError(errorMessage(err)));
    },
    [store]
  );

  const openFile = useCallback((attachment: Attachment) => {
    Linking.openURL(absoluteUrl(attachment.url)).catch(() => setActionError("Couldn't open that file."));
  }, []);

  const openImage = useCallback((uri: string, attachment: Attachment | null) => setViewerImage({ uri, attachment }), []);
  const retry = useCallback((clientId: string) => store.retry(conversationId, clientId), [store, conversationId]);
  const discard = useCallback((clientId: string) => store.discard(conversationId, clientId), [store, conversationId]);

  // ─── Render ──────────────────────────────────────────

  const header = (
    <View style={[styles.header, { paddingTop: (isWide ? 0 : insets.top) + space.sm, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      {!isWide && (
        <IconButton
          icon="chevron-back"
          label="Back to chats"
          size={26}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/conversations"))}
        />
      )}
      <Pressable
        style={styles.headerInfo}
        onPress={() => setShowInfo(true)}
        accessibilityRole="button"
        accessibilityLabel={`${title}. Show conversation details`}
      >
        <Avatar
          name={title}
          seed={isGroup ? conversation.id + 3 : (other?.id ?? 0)}
          size={40}
          online={!isGroup && other?.online}
          group={isGroup}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={[styles.headerSubtitle, { color: typingNames.length || (!isGroup && other?.online) ? colors.primary : colors.textMuted }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </View>
      </Pressable>
      <IconButton icon="information-circle-outline" label="Conversation details" onPress={() => setShowInfo(true)} />
    </View>
  );

  let body;
  if (!messages.loaded && messages.error) {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load messages"
        message={messages.error}
        action={<Button title="Try again" icon="refresh" onPress={() => store.loadMessages(conversationId)} />}
      />
    );
  } else if (!messages.loaded) {
    body = <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon="hand-left-outline"
        title="No messages yet"
        message={isGroup ? "Kick off the conversation with the group." : `Say hello to ${title.split(" ")[0]}!`}
      />
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        inverted
        data={rows}
        keyExtractor={row => row.key}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => store.loadOlder(conversationId)}
        onEndReachedThreshold={0.3}
        onScroll={e => setShowJump(e.nativeEvent.contentOffset.y > 400)}
        scrollEventThrottle={100}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        renderItem={({ item }) =>
          item.kind === "day" ? (
            <View style={styles.dayWrap}>
              <Text style={[styles.day, { backgroundColor: colors.surface, color: colors.textMuted, borderColor: colors.border }]}>
                {item.label}
              </Text>
            </View>
          ) : (
            <MessageBubble
              message={item.message}
              isMine={item.message.senderId === meId}
              meId={meId}
              showSender={item.showSender}
              groupedWithPrev={item.groupedWithPrev}
              groupedWithNext={item.groupedWithNext}
              onOpenActions={setActionTarget}
              onToggleReaction={toggleReaction}
              onOpenImage={openImage}
              onOpenFile={openFile}
              onRetry={retry}
              onDiscard={discard}
            />
          )
        }
        // Inverted: the "header" renders at the bottom, the "footer" at the top.
        ListHeaderComponent={
          typingNames.length > 0 ? (
            <View style={[styles.typing, { backgroundColor: colors.bubbleTheirs, borderColor: colors.border }]}>
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                {isGroup ? `${typingNames.join(", ")} typing` : "typing"}
              </Text>
              <TypingDots color={colors.textFaint} />
            </View>
          ) : null
        }
        ListFooterComponent={
          messages.loadingOlder ? (
            <ActivityIndicator style={{ margin: space.lg }} color={colors.primary} />
          ) : !messages.hasMore ? (
            <Text style={[styles.beginning, { color: colors.textFaint }]}>
              {isGroup ? `${title} was created` : "This is the start of your conversation"}
            </Text>
          ) : null
        }
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.chatBackground }}
      behavior={Platform.OS === "web" ? undefined : "padding"}
    >
      {header}
      {isWide ? null : <View style={{ height: space.sm }} />}
      {!isWide && <ConnectionBanner />}
      {actionError && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
          <Banner
            tone="error"
            message={actionError}
            action={<IconButton icon="close" label="Dismiss" size={16} onPress={() => setActionError(null)} />}
          />
        </View>
      )}
      <View style={{ flex: 1 }}>
        {body}
        {showJump && (
          <Pressable
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
            accessibilityRole="button"
            accessibilityLabel="Jump to latest messages"
            style={[styles.jump, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Ionicons name="arrow-down" size={20} color={colors.text} />
          </Pressable>
        )}
      </View>
      <Composer
        context={composerContext}
        onCancelContext={() => {
          setComposerContext(null);
          setReplyToId(null);
          setEditingId(null);
        }}
        onSend={handleSend}
        onTyping={isTyping => store.setTyping(conversationId, isTyping)}
      />

      <MessageActionsSheet
        message={actionTarget}
        meId={meId}
        onClose={() => setActionTarget(null)}
        onReply={startReply}
        onEdit={startEdit}
        onDelete={setDeleteTarget}
        onReact={(message, emoji) => message.id !== null && toggleReaction(message.id, emoji)}
        onOpenFile={openFile}
      />
      <ConfirmDialog
        visible={!!deleteTarget}
        title="Delete this message?"
        message="It will be removed for everyone in this conversation."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ImageViewer image={viewerImage} onClose={() => setViewerImage(null)} />
      <ConversationInfoSheet
        conversation={conversation}
        visible={showInfo}
        onClose={() => setShowInfo(false)}
        onLeft={() => router.replace("/conversations")}
      />
    </KeyboardAvoidingView>
  );
}

function TypingDots({ color }: { color: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep(s => (s + 1) % 3), 400);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={{ flexDirection: "row", gap: 3, marginLeft: 4 }}>
      {[0, 1, 2].map(i => (
        <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, opacity: i === step ? 1 : 0.35 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.xs,
    minHeight: 64,
  },
  headerInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.sm, minWidth: 0 },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerSubtitle: { fontSize: 13, marginTop: 1 },
  listContent: { paddingVertical: space.md },
  dayWrap: { alignItems: "center", marginVertical: space.md },
  day: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  typing: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginLeft: space.md,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderBottomLeftRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  beginning: { textAlign: "center", fontSize: 13, marginVertical: space.lg },
  jump: {
    position: "absolute",
    right: space.lg,
    bottom: space.lg,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
  },
});
