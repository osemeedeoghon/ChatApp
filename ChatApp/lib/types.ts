export type User = {
  id: number;
  email: string;
  displayName: string;
  lastSeenAt: string | null;
  online: boolean;
};

export type Member = User & {
  role: "admin" | "member";
  lastReadMessageId: number;
  lastDeliveredMessageId: number;
};

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  /** Relative, signed download URL. Use `absoluteUrl()` before loading it. */
  url: string;
};

export type Reaction = { emoji: string; userIds: number[] };

export type ReplyPreview = {
  id: number;
  senderId: number;
  senderName: string;
  text: string | null;
  deleted: boolean;
  hasAttachment: boolean;
};

export type Message = {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
  clientId: string | null;
  text: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  replyTo: ReplyPreview | null;
  attachment: Attachment | null;
  reactions: Reaction[];
};

export type Conversation = {
  id: number;
  type: "direct" | "group";
  title: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  members: Member[];
  unreadCount: number;
  lastMessage: Message | null;
};

export type MessagePage = { messages: Message[]; hasMore: boolean };

export type AuthResponse = { token: string; user: User };

/** A file chosen on the device that has not been uploaded yet. */
export type LocalFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  /** Present on web, where uploads need the actual File object. */
  file?: Blob;
};

export type MessageStatus = "sending" | "failed" | "sent" | "delivered" | "read";

export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
