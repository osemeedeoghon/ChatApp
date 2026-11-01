import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import type { DisplayMessage } from "@/components/message-bubble";
import { Banner, Button, ConfirmDialog, IconButton, TextField, type IconName } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useChatStore } from "@/lib/chat-context";
import { absoluteUrl } from "@/lib/config";
import { conversationTitle, formatLastSeen, otherMember } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import { REACTIONS, type Attachment, type Conversation } from "@/lib/types";

/** Bottom sheet on phones, centred card on wider screens. */
function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.overlay, { backgroundColor: colors.overlay }]} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          onPress={() => {}}
          style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + space.lg }]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetAction({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const { colors } = useTheme();
  const color = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.action,
        (pressed || hovered) && { backgroundColor: colors.surfaceHover },
      ]}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function MessageActionsSheet({
  message, meId, onClose, onReply, onEdit, onDelete, onReact, onOpenFile,
}: {
  message: DisplayMessage | null;
  meId: number;
  onClose: () => void;
  onReply: (message: DisplayMessage) => void;
  onEdit: (message: DisplayMessage) => void;
  onDelete: (message: DisplayMessage) => void;
  onReact: (message: DisplayMessage, emoji: string) => void;
  onOpenFile: (attachment: Attachment) => void;
}) {
  const { colors } = useTheme();
  if (!message) return null;
  const isMine = message.senderId === meId;
  const canCopy = Platform.OS === "web" && !!message.text && typeof navigator !== "undefined" && !!navigator.clipboard;

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <Sheet visible onClose={onClose}>
      <View style={styles.reactionRow} accessibilityRole="toolbar" accessibilityLabel="Reactions">
        {REACTIONS.map(emoji => {
          const active = message.reactions.some(r => r.emoji === emoji && r.userIds.includes(meId));
          return (
            <Pressable
              key={emoji}
              onPress={run(() => onReact(message, emoji))}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
              accessibilityState={{ selected: active }}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.reactionButton,
                active && { backgroundColor: colors.primarySoft },
                (pressed || hovered) && { transform: [{ scale: 1.15 }] },
              ]}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
            </Pressable>
          );
        })}
      </View>
      <SheetAction icon="arrow-undo-outline" label="Reply" onPress={run(() => onReply(message))} />
      {canCopy && (
        <SheetAction icon="copy-outline" label="Copy text" onPress={run(() => navigator.clipboard.writeText(message.text!))} />
      )}
      {message.attachment && (
        <SheetAction
          icon="download-outline"
          label={message.attachment.isImage ? "Open original photo" : "Open file"}
          onPress={run(() => onOpenFile(message.attachment!))}
        />
      )}
      {isMine && !!message.text && <SheetAction icon="create-outline" label="Edit" onPress={run(() => onEdit(message))} />}
      {isMine && <SheetAction icon="trash-outline" label="Delete for everyone" danger onPress={run(() => onDelete(message))} />}
    </Sheet>
  );
}

export function ImageViewer({ image, onClose }: { image: { uri: string; attachment: Attachment | null } | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  if (!image) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewer}>
        <Image source={{ uri: image.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
        <View style={[styles.viewerBar, { top: insets.top + space.sm }]}>
          {image.attachment && (
            <IconButton
              icon="open-outline"
              label="Open original"
              color="#fff"
              onPress={() => Linking.openURL(absoluteUrl(image.attachment!.url))}
            />
          )}
          <IconButton icon="close" label="Close photo" color="#fff" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

export function ConversationInfoSheet({
  conversation, visible, onClose, onLeft,
}: { conversation: Conversation; visible: boolean; onClose: () => void; onLeft: () => void }) {
  const { colors } = useTheme();
  const store = useChatStore();
  const meId = store.me.id;
  const isGroup = conversation.type === "group";
  const [title, setTitle] = useState(conversation.title ?? "");
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rename = async () => {
    setSaving(true);
    setError(null);
    try {
      await store.renameGroup(conversation.id, title.trim());
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const leave = async () => {
    setLeaving(true);
    try {
      await store.leaveGroup(conversation.id);
      setConfirmLeave(false);
      onClose();
      onLeft();
    } catch (err) {
      setConfirmLeave(false);
      setError(errorMessage(err));
    } finally {
      setLeaving(false);
    }
  };

  const other = otherMember(conversation, meId);
  const members = [...conversation.members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));

  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingHorizontal: space.lg }}>
        <View style={styles.infoHeader}>
          <Avatar
            name={conversationTitle(conversation, meId)}
            seed={isGroup ? conversation.id + 3 : (other?.id ?? 0)}
            size={72}
            group={isGroup}
            online={!isGroup && other?.online}
          />
          <Text style={[styles.infoTitle, { color: colors.text }]}>{conversationTitle(conversation, meId)}</Text>
          <Text style={[styles.infoSubtitle, { color: colors.textMuted }]}>
            {isGroup ? `${conversation.members.length} members` : other ? `${other.email} · ${formatLastSeen(other)}` : ""}
          </Text>
        </View>

        {error && <Banner tone="error" message={error} />}

        {isGroup && (
          <>
            <TextField
              label="Group name"
              value={title}
              onChangeText={value => {
                setTitle(value);
                setSaved(false);
              }}
              maxLength={80}
              containerStyle={{ marginTop: space.lg, marginBottom: space.sm }}
              hint={saved ? "Saved" : undefined}
            />
            <Button
              title="Save name"
              variant="secondary"
              loading={saving}
              disabled={!title.trim() || title.trim() === conversation.title}
              onPress={rename}
            />

            <Text style={[styles.sectionTitle, { color: colors.textFaint }]}>Members</Text>
            {members.map(member => (
              <View key={member.id} style={styles.member}>
                <Avatar name={member.displayName} seed={member.id} size={36} online={member.online} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.memberName, { color: colors.text }]}>
                    {member.id === meId ? `${member.displayName} (you)` : member.displayName}
                  </Text>
                  <Text style={[styles.memberMeta, { color: colors.textMuted }]}>{formatLastSeen(member)}</Text>
                </View>
                {member.role === "admin" && (
                  <Text style={[styles.adminTag, { color: colors.primary, backgroundColor: colors.primarySoft }]}>Admin</Text>
                )}
              </View>
            ))}

            <Button
              title="Leave group"
              variant="danger"
              icon="exit-outline"
              style={{ marginTop: space.lg }}
              onPress={() => setConfirmLeave(true)}
            />
          </>
        )}
      </ScrollView>
      <ConfirmDialog
        visible={confirmLeave}
        title="Leave this group?"
        message="You'll stop receiving messages and lose access to its history."
        confirmLabel="Leave"
        destructive
        loading={leaving}
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  sheet: {
    width: "100%",
    maxWidth: 480,
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    paddingTop: space.sm,
    ...Platform.select({ web: { marginBottom: "auto", marginTop: "auto", borderRadius: radius.lg + 4 } as object }),
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: space.sm },
  reactionRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  reactionButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  reactionEmoji: { fontSize: 28 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: 14,
  },
  actionText: { fontSize: 16, fontWeight: "500" },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  viewerBar: { position: "absolute", right: space.lg, flexDirection: "row", gap: space.sm },
  infoHeader: { alignItems: "center", paddingVertical: space.lg, gap: 6 },
  infoTitle: { fontSize: 20, fontWeight: "700", marginTop: space.sm, textAlign: "center" },
  infoSubtitle: { fontSize: 14, textAlign: "center" },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  member: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  memberName: { fontSize: 15, fontWeight: "600" },
  memberMeta: { fontSize: 13, marginTop: 1 },
  adminTag: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
});
