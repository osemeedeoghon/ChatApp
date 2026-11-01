import { io, type Socket } from "socket.io-client";
import { api, errorMessage, session } from "./api";
import { API_URL } from "./config";
import type { Conversation, LocalFile, Message, ReplyPreview, User } from "./types";

/** A message the user sent that the server has not confirmed yet. */
export type PendingMessage = {
  clientId: string;
  conversationId: number;
  text: string | null;
  file: LocalFile | null;
  replyTo: ReplyPreview | null;
  createdAt: string;
  status: "sending" | "failed";
  error: string | null;
  /** Set once the file upload succeeded so a retry does not upload it twice. */
  attachmentId: string | null;
};

export type MessagesState = {
  /** Server-confirmed messages, ascending by id. */
  items: Message[];
  pending: PendingMessage[];
  hasMore: boolean;
  loaded: boolean;
  loadingOlder: boolean;
  error: string | null;
};

export type ConnectionState = "connecting" | "connected" | "disconnected";

export type ChatState = {
  conversations: Record<number, Conversation>;
  conversationsLoaded: boolean;
  conversationsError: string | null;
  messages: Record<number, MessagesState>;
  /** conversationId -> userId -> expiry timestamp */
  typing: Record<number, Record<number, number>>;
  connection: ConnectionState;
};

export const EMPTY_MESSAGES: MessagesState = {
  items: [],
  pending: [],
  hasMore: false,
  loaded: false,
  loadingOlder: false,
  error: null,
};

const TYPING_TTL_MS = 6000;

const makeClientId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function insertMessage(items: Message[], message: Message) {
  const index = items.findIndex(m => m.id === message.id);
  if (index >= 0) {
    const next = items.slice();
    next[index] = message;
    return next;
  }
  const next = [...items, message];
  // Usually appended at the end; only sort when events arrive out of order.
  if (items.length && items[items.length - 1].id > message.id) next.sort((a, b) => a.id - b.id);
  return next;
}

/** Keeps quoted previews in sync when the quoted message is edited or deleted. */
function refreshReplyPreviews(items: Message[], changed: Message) {
  if (!items.some(m => m.replyTo?.id === changed.id)) return items;
  return items.map(m =>
    m.replyTo?.id === changed.id
      ? { ...m, replyTo: { ...m.replyTo, text: changed.deletedAt ? null : changed.text, deleted: !!changed.deletedAt } }
      : m
  );
}

export class ChatStore {
  private state: ChatState = {
    conversations: {},
    conversationsLoaded: false,
    conversationsError: null,
    messages: {},
    typing: {},
    connection: "connecting",
  };
  private listeners = new Set<() => void>();
  private socket: Socket | null = null;
  private readInFlight = new Set<number>();
  private readQueued = new Set<number>();
  private hasConnected = false;

  constructor(
    public me: User,
    private callbacks: { onUserUpdated: (user: User) => void }
  ) {}

  // ─── Subscription (for useSyncExternalStore) ─────────

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private update(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private updateMessages(conversationId: number, fn: (current: MessagesState) => MessagesState) {
    const current = this.state.messages[conversationId] ?? EMPTY_MESSAGES;
    this.update({ messages: { ...this.state.messages, [conversationId]: fn(current) } });
  }

  private updateConversation(conversationId: number, fn: (current: Conversation) => Conversation) {
    const current = this.state.conversations[conversationId];
    if (!current) return;
    this.update({ conversations: { ...this.state.conversations, [conversationId]: fn(current) } });
  }

  private putConversation(conversation: Conversation) {
    this.update({ conversations: { ...this.state.conversations, [conversation.id]: conversation } });
  }

  // ─── Connection ──────────────────────────────────────

  connect() {
    if (this.socket) return;
    const socket = io(API_URL, {
      auth: cb => cb({ token: session.getToken() }),
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    this.socket = socket;

    socket.on("connect", () => {
      this.update({ connection: "connected" });
      // On reconnect, catch up on anything missed while disconnected.
      if (this.hasConnected) this.resync();
      this.hasConnected = true;
    });
    socket.on("disconnect", reason => {
      this.update({ connection: "disconnected", typing: {} });
      // A server-side disconnect is not retried automatically (e.g. password changed elsewhere).
      if (reason === "io server disconnect") setTimeout(() => socket.connect(), 1000);
    });
    socket.on("connect_error", err => {
      this.update({ connection: "disconnected" });
      if (err.message === "unauthorized") {
        // The token may have just been replaced (e.g. after a password change), so confirm
        // with the API before giving up. A 401 there signs the user out.
        api.me().then(() => socket.connect(), () => {});
      }
    });
    socket.io.on("reconnect_attempt", () => this.update({ connection: "connecting" }));

    socket.on("message:new", (message: Message) => this.receiveMessage(message, true));
    socket.on("message:updated", (message: Message) => this.receiveMessage(message, false));
    socket.on("conversation:updated", (conversation: Conversation) => this.putConversation(conversation));
    socket.on("conversation:removed", ({ conversationId }: { conversationId: number }) => {
      const conversations = { ...this.state.conversations };
      delete conversations[conversationId];
      this.update({ conversations });
    });
    socket.on("receipt", this.applyReceipt);
    socket.on("typing", this.applyTyping);
    socket.on("presence", ({ userId, online, lastSeenAt }: { userId: number; online: boolean; lastSeenAt: string | null }) =>
      this.patchUser(userId, { online, lastSeenAt })
    );
    socket.on("user:updated", (user: User) => this.patchUser(user.id, { displayName: user.displayName }));
  }

  disconnect() {
    this.socket?.removeAllListeners();
    this.socket?.io.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }

  private async resync() {
    await this.loadConversations();
    for (const [id, messages] of Object.entries(this.state.messages)) {
      if (messages.loaded) this.loadMessages(Number(id));
    }
  }

  // ─── Incoming events ─────────────────────────────────

  private receiveMessage(message: Message, isNew: boolean) {
    const { conversationId } = message;
    const messages = this.state.messages[conversationId];
    if (messages?.loaded || messages?.pending.length) {
      this.updateMessages(conversationId, current => ({
        ...current,
        items: current.loaded ? refreshReplyPreviews(insertMessage(current.items, message), message) : current.items,
        pending: current.pending.filter(p => p.clientId !== message.clientId || message.senderId !== this.me.id),
      }));
    }

    const conversation = this.state.conversations[conversationId];
    if (!conversation) {
      // A conversation we have not seen yet (e.g. someone just messaged us).
      api.conversation(conversationId).then(c => this.putConversation(c)).catch(() => {});
    } else if (!conversation.lastMessage || message.id >= conversation.lastMessage.id) {
      const fromOther = isNew && message.senderId !== this.me.id;
      const isNewer = !conversation.lastMessage || message.id > conversation.lastMessage.id;
      this.updateConversation(conversationId, c => ({
        ...c,
        lastMessage: message,
        updatedAt: isNewer ? message.createdAt : c.updatedAt,
        unreadCount: fromOther && isNewer ? c.unreadCount + 1 : c.unreadCount,
      }));
    }

    if (isNew && message.senderId !== this.me.id) {
      this.socket?.emit("message:delivered", { conversationId, messageId: message.id });
      this.clearTyping(conversationId, message.senderId);
    }
  }

  private applyReceipt = (receipt: {
    conversationId: number;
    userId: number;
    lastReadMessageId: number;
    lastDeliveredMessageId: number;
  }) => {
    this.updateConversation(receipt.conversationId, c => {
      const members = c.members.map(m =>
        m.id === receipt.userId
          ? { ...m, lastReadMessageId: receipt.lastReadMessageId, lastDeliveredMessageId: receipt.lastDeliveredMessageId }
          : m
      );
      // My own receipt from another device clears the unread badge here too.
      const caughtUp = receipt.userId === this.me.id && receipt.lastReadMessageId >= (c.lastMessage?.id ?? 0);
      return { ...c, members, unreadCount: caughtUp ? 0 : c.unreadCount };
    });
  };

  private applyTyping = ({ conversationId, userId, isTyping }: { conversationId: number; userId: number; isTyping: boolean }) => {
    if (!isTyping) return this.clearTyping(conversationId, userId);
    const expiresAt = Date.now() + TYPING_TTL_MS;
    this.update({
      typing: {
        ...this.state.typing,
        [conversationId]: { ...this.state.typing[conversationId], [userId]: expiresAt },
      },
    });
    setTimeout(() => {
      if (this.state.typing[conversationId]?.[userId] === expiresAt) this.clearTyping(conversationId, userId);
    }, TYPING_TTL_MS);
  };

  private clearTyping(conversationId: number, userId: number) {
    const current = this.state.typing[conversationId];
    if (!current || !(userId in current)) return;
    const next = { ...current };
    delete next[userId];
    this.update({ typing: { ...this.state.typing, [conversationId]: next } });
  }

  private patchUser(userId: number, patch: Partial<User>) {
    let changed = false;
    const conversations: Record<number, Conversation> = {};
    for (const c of Object.values(this.state.conversations)) {
      if (c.members.some(m => m.id === userId)) {
        changed = true;
        conversations[c.id] = { ...c, members: c.members.map(m => (m.id === userId ? { ...m, ...patch } : m)) };
      } else {
        conversations[c.id] = c;
      }
    }
    if (changed) this.update({ conversations });
  }

  // ─── Loading ─────────────────────────────────────────

  async loadConversations() {
    try {
      const list = await api.conversations();
      const conversations: Record<number, Conversation> = {};
      for (const c of list) conversations[c.id] = c;
      this.update({ conversations, conversationsLoaded: true, conversationsError: null });
    } catch (err) {
      this.update({ conversationsLoaded: true, conversationsError: errorMessage(err) });
    }
  }

  /** Loads a conversation that is not in the list yet (e.g. opened from a link). */
  async ensureConversation(conversationId: number) {
    if (this.state.conversations[conversationId]) return;
    this.putConversation(await api.conversation(conversationId));
  }

  /** Loads (or refreshes) the newest page of a conversation and merges it in. */
  async loadMessages(conversationId: number) {
    try {
      const page = await api.messages(conversationId);
      this.updateMessages(conversationId, current => {
        let items = current.loaded ? current.items : [];
        for (const message of page.messages) items = insertMessage(items, message);
        const confirmed = new Set(page.messages.map(m => m.clientId));
        return {
          ...current,
          items,
          pending: current.pending.filter(p => !confirmed.has(p.clientId)),
          hasMore: current.loaded ? current.hasMore || page.hasMore : page.hasMore,
          loaded: true,
          error: null,
        };
      });
    } catch (err) {
      this.updateMessages(conversationId, current => ({ ...current, error: errorMessage(err) }));
    }
  }

  async loadOlder(conversationId: number) {
    const current = this.state.messages[conversationId];
    if (!current?.loaded || !current.hasMore || current.loadingOlder) return;
    this.updateMessages(conversationId, c => ({ ...c, loadingOlder: true }));
    try {
      const page = await api.messages(conversationId, current.items[0]?.id);
      this.updateMessages(conversationId, c => ({
        ...c,
        items: [...page.messages.filter(m => !c.items.some(i => i.id === m.id)), ...c.items],
        hasMore: page.hasMore,
        loadingOlder: false,
      }));
    } catch (err) {
      this.updateMessages(conversationId, c => ({ ...c, loadingOlder: false, error: errorMessage(err) }));
    }
  }

  // ─── Sending ─────────────────────────────────────────

  send(conversationId: number, input: { text: string | null; file: LocalFile | null; replyTo: ReplyPreview | null }) {
    const pending: PendingMessage = {
      clientId: makeClientId(),
      conversationId,
      text: input.text,
      file: input.file,
      replyTo: input.replyTo,
      createdAt: new Date().toISOString(),
      status: "sending",
      error: null,
      attachmentId: null,
    };
    this.updateMessages(conversationId, c => ({ ...c, pending: [...c.pending, pending] }));
    this.setTyping(conversationId, false);
    return this.deliver(pending);
  }

  retry(conversationId: number, clientId: string) {
    const pending = this.state.messages[conversationId]?.pending.find(p => p.clientId === clientId);
    if (!pending || pending.status === "sending") return;
    const next = { ...pending, status: "sending" as const, error: null };
    this.replacePending(next);
    return this.deliver(next);
  }

  discard(conversationId: number, clientId: string) {
    this.updateMessages(conversationId, c => ({ ...c, pending: c.pending.filter(p => p.clientId !== clientId) }));
  }

  private replacePending(next: PendingMessage) {
    this.updateMessages(next.conversationId, c => ({
      ...c,
      pending: c.pending.map(p => (p.clientId === next.clientId ? next : p)),
    }));
  }

  private async deliver(pending: PendingMessage) {
    let attachmentId = pending.attachmentId;
    try {
      if (pending.file && !attachmentId) {
        attachmentId = (await api.uploadAttachment(pending.conversationId, pending.file)).id;
        pending = { ...pending, attachmentId };
        this.replacePending(pending);
      }
      const message = await api.sendMessage(pending.conversationId, {
        text: pending.text,
        clientId: pending.clientId,
        replyToId: pending.replyTo?.id ?? null,
        attachmentId,
      });
      this.receiveMessage(message, false);
    } catch (err) {
      // Still pending (not confirmed by a socket event in the meantime)? Mark it failed.
      if (this.state.messages[pending.conversationId]?.pending.some(p => p.clientId === pending.clientId)) {
        this.replacePending({ ...pending, status: "failed", error: errorMessage(err) });
      }
    }
  }

  // ─── Message actions ─────────────────────────────────

  async editMessage(id: number, text: string) {
    this.receiveMessage(await api.editMessage(id, text), false);
  }

  async deleteMessage(id: number) {
    this.receiveMessage(await api.deleteMessage(id), false);
  }

  async toggleReaction(id: number, emoji: string) {
    this.receiveMessage(await api.toggleReaction(id, emoji), false);
  }

  /** Marks everything up to the newest message as read, if it isn't already. */
  markRead(conversationId: number) {
    const conversation = this.state.conversations[conversationId];
    const latest = conversation?.lastMessage?.id;
    const mine = conversation?.members.find(m => m.id === this.me.id);
    if (!conversation || !latest || !mine) return;
    if (mine.lastReadMessageId >= latest && conversation.unreadCount === 0) return;
    if (this.readInFlight.has(conversationId)) {
      // Newer messages arrived mid-request; mark them once the current request settles.
      this.readQueued.add(conversationId);
      return;
    }

    this.readInFlight.add(conversationId);
    this.applyReceipt({
      conversationId,
      userId: this.me.id,
      lastReadMessageId: Math.max(latest, mine.lastReadMessageId),
      lastDeliveredMessageId: Math.max(latest, mine.lastDeliveredMessageId),
    });
    api
      .markRead(conversationId, latest)
      .catch(() => {
        // Restore the badge so the unread state isn't silently lost.
        this.updateConversation(conversationId, c => ({ ...c, unreadCount: Math.max(c.unreadCount, 1) }));
      })
      .finally(() => {
        this.readInFlight.delete(conversationId);
        if (this.readQueued.delete(conversationId)) this.markRead(conversationId);
      });
  }

  setTyping(conversationId: number, isTyping: boolean) {
    this.socket?.emit("typing", { conversationId, isTyping });
  }

  // ─── Conversations ───────────────────────────────────

  async startDirect(userId: number) {
    const conversation = await api.createDirect(userId);
    this.putConversation(conversation);
    return conversation;
  }

  async createGroup(title: string, userIds: number[]) {
    const conversation = await api.createGroup(title, userIds);
    this.putConversation(conversation);
    return conversation;
  }

  async renameGroup(conversationId: number, title: string) {
    this.putConversation(await api.renameGroup(conversationId, title));
  }

  async leaveGroup(conversationId: number) {
    await api.leaveGroup(conversationId);
    const conversations = { ...this.state.conversations };
    delete conversations[conversationId];
    this.update({ conversations });
  }

  /** Reflects a profile change of mine in every conversation I'm part of. */
  applyMyProfile(user: User) {
    this.me = user;
    this.patchUser(user.id, { displayName: user.displayName });
    this.callbacks.onUserUpdated(user);
  }
}
