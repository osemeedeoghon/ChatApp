import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { memo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { IconName } from "@/components/ui";
import { absoluteUrl } from "@/lib/config";
import { formatFileSize, formatTime } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { Attachment, LocalFile, MessageStatus, Reaction, ReplyPreview } from "@/lib/types";

/** Unifies confirmed and still-sending messages for rendering. */
export type DisplayMessage = {
  key: string;
  id: number | null;
  clientId: string | null;
  senderId: number;
  senderName: string;
  text: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  replyTo: ReplyPreview | null;
  attachment: Attachment | null;
  localFile: LocalFile | null;
  reactions: Reaction[];
  status: MessageStatus;
  error: string | null;
};

type Props = {
  message: DisplayMessage;
  isMine: boolean;
  meId: number;
  showSender: boolean;
  /** Same sender as the message right after it, so the bubble tail is hidden. */
  groupedWithNext: boolean;
  groupedWithPrev: boolean;
  onOpenActions: (message: DisplayMessage) => void;
  onToggleReaction: (messageId: number, emoji: string) => void;
  onOpenImage: (uri: string, attachment: Attachment | null) => void;
  onOpenFile: (attachment: Attachment) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
};

const STATUS_ICON: Record<MessageStatus, IconName> = {
  sending: "time-outline",
  failed: "alert-circle",
  sent: "checkmark",
  delivered: "checkmark-done",
  read: "checkmark-done",
};

const STATUS_LABEL: Record<MessageStatus, string> = {
  sending: "Sending",
  failed: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

export const MessageBubble = memo(function MessageBubble({
  message, isMine, meId, showSender, groupedWithNext, groupedWithPrev,
  onOpenActions, onToggleReaction, onOpenImage, onOpenFile, onRetry, onDiscard,
}: Props) {
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  const deleted = Boolean(message.deletedAt);
  const bubbleColor = isMine ? colors.bubbleMine : colors.bubbleTheirs;
  const textColor = isMine ? colors.bubbleMineText : colors.bubbleTheirsText;
  const mutedColor = isMine ? colors.bubbleMineMuted : colors.textFaint;
  const canAct = message.id !== null && !deleted;
  const imageUri = message.attachment?.isImage
    ? absoluteUrl(message.attachment.url)
    : message.localFile?.mimeType.startsWith("image/")
      ? message.localFile.uri
      : null;
  const fileInfo = message.attachment && !message.attachment.isImage
    ? message.attachment
    : message.localFile && !message.localFile.mimeType.startsWith("image/")
      ? message.localFile
      : null;
  const imageOnly = imageUri && !message.text && !message.replyTo;

  const footer = (
    <View style={[styles.meta, imageOnly && styles.metaOverlay]}>
      {message.editedAt && !deleted && <Text style={[styles.metaText, { color: imageOnly ? "#fff" : mutedColor }]}>edited</Text>}
      <Text style={[styles.metaText, { color: imageOnly ? "#fff" : mutedColor }]}>{formatTime(message.createdAt)}</Text>
      {isMine && !deleted && (
        <Ionicons
          name={STATUS_ICON[message.status]}
          size={14}
          accessibilityLabel={STATUS_LABEL[message.status]}
          color={
            message.status === "failed"
              ? colors.danger
              : message.status === "read"
                ? colors.readTick
                : imageOnly
                  ? "#fff"
                  : mutedColor
          }
        />
      )}
    </View>
  );

  return (
    <View
      style={[
        styles.row,
        isMine ? styles.rowMine : styles.rowTheirs,
        { marginTop: groupedWithPrev ? 2 : space.sm },
      ]}
    >
      <Pressable
        onLongPress={canAct ? () => onOpenActions(message) : undefined}
        delayLongPress={300}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityHint={canAct ? "Long press for reactions and options" : undefined}
        style={[styles.bubbleColumn, isMine ? { alignItems: "flex-end" } : { alignItems: "flex-start" }]}
      >
        <View style={[styles.bubbleLine, isMine && { flexDirection: "row-reverse" }]}>
          <View
            style={[
              styles.bubble,
              { backgroundColor: bubbleColor },
              !groupedWithNext && (isMine ? styles.tailMine : styles.tailTheirs),
              imageOnly && styles.bubbleImageOnly,
              !isMine && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
            ]}
          >
            {showSender && !isMine && (
              <Text style={[styles.sender, { color: colors.primary }]} numberOfLines={1}>
                {message.senderName}
              </Text>
            )}

            {message.replyTo && !deleted && (
              <View
                style={[
                  styles.reply,
                  { backgroundColor: isMine ? "rgba(0,0,0,0.14)" : colors.surfaceAlt, borderLeftColor: isMine ? colors.bubbleMineText : colors.primary },
                ]}
              >
                <Text style={[styles.replySender, { color: isMine ? colors.bubbleMineText : colors.primary }]} numberOfLines={1}>
                  {message.replyTo.senderId === meId ? "You" : message.replyTo.senderName}
                </Text>
                <Text style={[styles.replyText, { color: isMine ? colors.bubbleMineMuted : colors.textMuted }]} numberOfLines={2}>
                  {message.replyTo.deleted
                    ? "Deleted message"
                    : message.replyTo.text || (message.replyTo.hasAttachment ? "Attachment" : "")}
                </Text>
              </View>
            )}

            {deleted ? (
              <View style={styles.deletedRow}>
                <Ionicons name="ban-outline" size={14} color={mutedColor} />
                <Text style={[styles.deletedText, { color: mutedColor }]}>This message was deleted</Text>
              </View>
            ) : (
              <>
                {imageUri && (
                  <Pressable
                    onPress={() => onOpenImage(imageUri, message.attachment)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Open photo"
                    style={[styles.imageWrap, !imageOnly && { marginBottom: space.xs }]}
                  >
                    <Image source={{ uri: imageUri }} style={styles.image} contentFit="cover" transition={150} />
                    {message.status === "sending" && message.id === null && (
                      <View style={styles.imageUploading}>
                        <Ionicons name="cloud-upload-outline" size={24} color="#fff" />
                      </View>
                    )}
                  </Pressable>
                )}
                {fileInfo && (
                  <Pressable
                    disabled={!message.attachment}
                    onPress={() => message.attachment && onOpenFile(message.attachment)}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${fileInfo.name}`}
                    style={[styles.file, { backgroundColor: isMine ? "rgba(0,0,0,0.14)" : colors.surfaceAlt }]}
                  >
                    <Ionicons name="document-text-outline" size={26} color={textColor} />
                    <View style={{ flexShrink: 1 }}>
                      <Text style={[styles.fileName, { color: textColor }]} numberOfLines={1}>
                        {fileInfo.name}
                      </Text>
                      <Text style={[styles.fileSize, { color: mutedColor }]}>{formatFileSize(fileInfo.size)}</Text>
                    </View>
                  </Pressable>
                )}
                {!!message.text && (
                  <Text style={[styles.text, { color: textColor }]} selectable>
                    {message.text}
                  </Text>
                )}
              </>
            )}
            {footer}
          </View>

          {canAct && Platform.OS === "web" && (
            <Pressable
              onPress={() => onOpenActions(message)}
              accessibilityRole="button"
              accessibilityLabel="Message options"
              style={[styles.hoverAction, { opacity: hovered ? 1 : 0, backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name="happy-outline" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        {message.reactions.length > 0 && (
          <View style={[styles.reactions, isMine && { justifyContent: "flex-end" }]}>
            {message.reactions.map(reaction => {
              const mine = reaction.userIds.includes(meId);
              return (
                <Pressable
                  key={reaction.emoji}
                  onPress={() => message.id !== null && onToggleReaction(message.id, reaction.emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`${reaction.emoji} ${reaction.userIds.length}${mine ? ", including you" : ""}`}
                  style={[
                    styles.reaction,
                    { backgroundColor: mine ? colors.primarySoft : colors.surface, borderColor: mine ? colors.primary : colors.border },
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  {reaction.userIds.length > 1 && (
                    <Text style={[styles.reactionCount, { color: colors.textMuted }]}>{reaction.userIds.length}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {message.status === "failed" && message.clientId && (
          <View style={styles.failedRow}>
            <Text style={[styles.failedText, { color: colors.danger }]} numberOfLines={2}>
              {message.error || "Not sent"}
            </Text>
            <Pressable onPress={() => onRetry(message.clientId!)} accessibilityRole="button" hitSlop={6}>
              <Text style={[styles.failedAction, { color: colors.primary }]}>Retry</Text>
            </Pressable>
            <Pressable onPress={() => onDiscard(message.clientId!)} accessibilityRole="button" hitSlop={6}>
              <Text style={[styles.failedAction, { color: colors.textMuted }]}>Discard</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingHorizontal: space.md },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubbleColumn: { maxWidth: "80%" },
  bubbleLine: { flexDirection: "row", alignItems: "center", gap: space.xs },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingTop: 7,
    paddingBottom: 6,
    minWidth: 72,
    flexShrink: 1,
  },
  bubbleImageOnly: { padding: 3, paddingTop: 3, paddingBottom: 3 },
  tailMine: { borderBottomRightRadius: 5 },
  tailTheirs: { borderBottomLeftRadius: 5 },
  sender: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  text: { fontSize: 16, lineHeight: 22 },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    alignSelf: "flex-end",
    gap: 4,
    marginTop: 2,
  },
  metaOverlay: {
    position: "absolute",
    right: 8,
    bottom: 7,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  metaText: { fontSize: 11 },
  reply: {
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    marginBottom: space.xs,
    marginTop: 2,
  },
  replySender: { fontSize: 12.5, fontWeight: "700" },
  replyText: { fontSize: 13.5 },
  deletedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  deletedText: { fontSize: 15, fontStyle: "italic" },
  imageWrap: { borderRadius: radius.md, overflow: "hidden" },
  image: { width: 240, height: 200, maxWidth: "100%" },
  imageUploading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    marginBottom: space.xs,
    marginTop: 2,
    minWidth: 180,
  },
  fileName: { fontSize: 14.5, fontWeight: "600" },
  fileSize: { fontSize: 12.5, marginTop: 1 },
  hoverAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: -4, paddingHorizontal: space.sm },
  reaction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 12, fontWeight: "600" },
  failedRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: 4 },
  failedText: { fontSize: 12.5, flexShrink: 1 },
  failedAction: { fontSize: 13, fontWeight: "700" },
});
