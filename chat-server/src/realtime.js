"use strict";

const { Server } = require("socket.io");

const userRoom = userId => `user:${userId}`;

/**
 * Socket.IO is used only for pushing events and for ephemeral signals (typing,
 * presence, delivery acks). Messages are always written through the REST API so
 * every message is persisted before anyone is told about it.
 */
function createRealtime(httpServer, { config, store, authenticateToken }) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin },
    maxHttpBufferSize: 16 * 1024,
  });

  const connectionCounts = new Map();
  const isOnline = userId => (connectionCounts.get(userId) || 0) > 0;

  function emitToUsers(userIds, event, payloadFor) {
    for (const userId of new Set(userIds)) {
      const payload = typeof payloadFor === "function" ? payloadFor(userId) : payloadFor;
      if (payload !== undefined) io.to(userRoom(userId)).emit(event, payload);
    }
  }

  function broadcastPresence(userId) {
    const user = store.getUserRow(userId);
    if (!user) return;
    emitToUsers(store.contactIds(userId), "presence", {
      userId,
      online: isOnline(userId),
      lastSeenAt: user.last_seen_at,
    });
  }

  io.use((socket, next) => {
    const user = authenticateToken(socket.handshake.auth?.token);
    if (!user) return next(new Error("unauthorized"));
    socket.data.userId = user.id;
    next();
  });

  io.on("connection", socket => {
    const { userId } = socket.data;
    socket.join(userRoom(userId));
    const count = (connectionCounts.get(userId) || 0) + 1;
    connectionCounts.set(userId, count);
    if (count === 1) broadcastPresence(userId);

    socket.on("typing", payload => {
      const conversationId = Number(payload?.conversationId);
      if (!Number.isSafeInteger(conversationId) || !store.membership(conversationId, userId)) return;
      const others = store.memberIds(conversationId).filter(id => id !== userId);
      emitToUsers(others, "typing", { conversationId, userId, isTyping: Boolean(payload.isTyping) });
    });

    // The client acknowledges that a pushed message reached the device.
    socket.on("message:delivered", payload => {
      const conversationId = Number(payload?.conversationId);
      const messageId = Number(payload?.messageId);
      if (!Number.isSafeInteger(conversationId) || !Number.isSafeInteger(messageId)) return;
      if (!store.membership(conversationId, userId)) return;
      const message = store.getMessageRow(messageId);
      if (!message || message.conversation_id !== conversationId) return;
      const updated = store.markDelivered(conversationId, userId, messageId);
      if (updated) emitReceipt(conversationId, updated);
    });

    socket.on("disconnect", () => {
      const remaining = (connectionCounts.get(userId) || 1) - 1;
      if (remaining > 0) {
        connectionCounts.set(userId, remaining);
        return;
      }
      connectionCounts.delete(userId);
      store.touchLastSeen(userId);
      broadcastPresence(userId);
    });
  });

  function emitReceipt(conversationId, membership) {
    emitToUsers(store.memberIds(conversationId), "receipt", {
      conversationId,
      userId: membership.user_id,
      lastReadMessageId: membership.last_read_message_id,
      lastDeliveredMessageId: membership.last_delivered_message_id,
    });
  }

  return {
    io,
    isOnline,
    emitToUsers,
    emitReceipt,
    disconnectUser: userId => io.in(userRoom(userId)).disconnectSockets(true),
  };
}

module.exports = { createRealtime };
