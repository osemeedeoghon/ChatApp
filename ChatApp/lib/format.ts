import type { Conversation, Member, Message, MessageStatus } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const daysAgo = (date: Date) => Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY_MS);

export const isSameDay = (a: string, b: string) => startOfDay(new Date(a)) === startOfDay(new Date(b));

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Compact timestamp for conversation previews. */
export function formatListTimestamp(iso: string) {
  const date = new Date(iso);
  const ago = daysAgo(date);
  if (ago === 0) return formatTime(iso);
  if (ago === 1) return "Yesterday";
  if (ago < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Label for the day separators in a conversation. */
export function formatDayLabel(iso: string) {
  const date = new Date(iso);
  const ago = daysAgo(date);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], {
    weekday: ago < 7 ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: sameYear ? undefined : "numeric",
  });
}

export function formatLastSeen(user: { online: boolean; lastSeenAt: string | null }) {
  if (user.online) return "Online";
  if (!user.lastSeenAt) return "Offline";
  const ago = daysAgo(new Date(user.lastSeenAt));
  if (ago === 0) return `Last seen today at ${formatTime(user.lastSeenAt)}`;
  if (ago === 1) return `Last seen yesterday at ${formatTime(user.lastSeenAt)}`;
  return `Last seen ${formatListTimestamp(user.lastSeenAt)}`;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const firstName = (name: string) => name.split(/\s+/)[0];

export function otherMember(conversation: Conversation, meId: number): Member | undefined {
  return conversation.members.find(m => m.id !== meId);
}

export function conversationTitle(conversation: Conversation, meId: number) {
  if (conversation.type === "group") return conversation.title || "Group";
  return otherMember(conversation, meId)?.displayName ?? "Unknown user";
}

export function attachmentLabel(message: Pick<Message, "attachment">) {
  if (!message.attachment) return "";
  return message.attachment.isImage ? "📷 Photo" : `📎 ${message.attachment.name}`;
}

export function messagePreview(message: Message, conversation: Conversation, meId: number) {
  if (message.deletedAt) return "Message deleted";
  const body = message.text || attachmentLabel(message);
  if (message.senderId === meId) return `You: ${body}`;
  if (conversation.type === "group") return `${firstName(message.senderName)}: ${body}`;
  return body;
}

/**
 * Status of one of my messages as confirmed by the server: "read" or "delivered"
 * only once every other member's receipt pointer has reached the message.
 */
export function deliveryStatus(message: Message, conversation: Conversation, meId: number): MessageStatus {
  const others = conversation.members.filter(m => m.id !== meId);
  if (others.length === 0) return "sent";
  if (others.every(m => m.lastReadMessageId >= message.id)) return "read";
  if (others.every(m => m.lastDeliveredMessageId >= message.id)) return "delivered";
  return "sent";
}
