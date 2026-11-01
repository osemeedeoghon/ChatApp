"use strict";

const { transaction } = require("./db");

const REPLY_PREVIEW_LENGTH = 120;

const MESSAGE_SELECT = `
  SELECT msg.*, u.display_name AS sender_name,
    a.original_name AS att_name, a.mime_type AS att_mime, a.size AS att_size,
    r.sender_id AS reply_sender_id, ru.display_name AS reply_sender_name,
    r.body AS reply_body, r.deleted_at AS reply_deleted_at, r.attachment_id AS reply_attachment_id
  FROM messages msg
  JOIN users u ON u.id = msg.sender_id
  LEFT JOIN attachments a ON a.id = msg.attachment_id
  LEFT JOIN messages r ON r.id = msg.reply_to_id
  LEFT JOIN users ru ON ru.id = r.sender_id
`;

const now = () => new Date().toISOString();

/**
 * All SQL lives here so route handlers only deal with validated input and
 * serialized output. `presence` supplies online state for user payloads and
 * `attachmentUrl(attachmentId, viewerId)` signs per-viewer download links.
 */
function createStore(db, { presence, attachmentUrl }) {
  const q = {
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    insertUser: db.prepare(
      "INSERT INTO users (email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)"
    ),
    updateDisplayName: db.prepare("UPDATE users SET display_name = ? WHERE id = ?"),
    updatePassword: db.prepare(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?"
    ),
    touchLastSeen: db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?"),
    otherUsers: db.prepare(
      "SELECT * FROM users WHERE id != ? ORDER BY display_name COLLATE NOCASE LIMIT 200"
    ),
    searchUsers: db.prepare(`
      SELECT * FROM users WHERE id != ? AND (display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
      ORDER BY display_name COLLATE NOCASE LIMIT 50
    `),
    contactsOf: db.prepare(`
      SELECT DISTINCT other.user_id AS id FROM conversation_members me
      JOIN conversation_members other ON other.conversation_id = me.conversation_id
      WHERE me.user_id = ? AND other.user_id != ?
    `),

    conversationById: db.prepare("SELECT * FROM conversations WHERE id = ?"),
    conversationByDirectKey: db.prepare("SELECT * FROM conversations WHERE direct_key = ?"),
    insertConversation: db.prepare(`
      INSERT INTO conversations (type, title, direct_key, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    renameConversation: db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"),
    touchConversation: db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?"),
    conversationsForUser: db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM messages msg
          WHERE msg.conversation_id = c.id AND msg.id > m.last_read_message_id
            AND msg.sender_id != m.user_id AND msg.deleted_at IS NULL) AS unread_count,
        (SELECT MAX(id) FROM messages WHERE conversation_id = c.id) AS last_message_id
      FROM conversations c
      JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
      ORDER BY c.updated_at DESC
    `),
    unreadCount: db.prepare(`
      SELECT COUNT(*) AS n FROM messages msg
      JOIN conversation_members m ON m.conversation_id = msg.conversation_id AND m.user_id = ?
      WHERE msg.conversation_id = ? AND msg.id > m.last_read_message_id
        AND msg.sender_id != m.user_id AND msg.deleted_at IS NULL
    `),
    lastMessageId: db.prepare("SELECT MAX(id) AS id FROM messages WHERE conversation_id = ?"),

    membership: db.prepare(
      "SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    ),
    members: db.prepare(`
      SELECT m.*, u.email, u.display_name, u.last_seen_at FROM conversation_members m
      JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? ORDER BY m.joined_at, u.id
    `),
    memberIds: db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?"),
    insertMember: db.prepare(`
      INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_message_id, last_delivered_message_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    deleteMember: db.prepare(
      "DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    ),
    advanceRead: db.prepare(`
      UPDATE conversation_members SET
        last_read_message_id = MAX(last_read_message_id, ?),
        last_delivered_message_id = MAX(last_delivered_message_id, ?)
      WHERE conversation_id = ? AND user_id = ?
    `),
    advanceDelivered: db.prepare(`
      UPDATE conversation_members SET last_delivered_message_id = MAX(last_delivered_message_id, ?)
      WHERE conversation_id = ? AND user_id = ?
    `),
    advanceDeliveredAll: db.prepare(`
      UPDATE conversation_members SET last_delivered_message_id = MAX(last_delivered_message_id,
        COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id = conversation_members.conversation_id), 0))
      WHERE user_id = ?
    `),

    messageById: db.prepare(`${MESSAGE_SELECT} WHERE msg.id = ?`),
    messageByClientId: db.prepare(`${MESSAGE_SELECT} WHERE msg.sender_id = ? AND msg.client_id = ?`),
    messagesBefore: db.prepare(`
      ${MESSAGE_SELECT} WHERE msg.conversation_id = ? AND msg.id < ? ORDER BY msg.id DESC LIMIT ?
    `),
    insertMessage: db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_id, body, reply_to_id, attachment_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    editMessage: db.prepare("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?"),
    softDeleteMessage: db.prepare(
      "UPDATE messages SET body = NULL, attachment_id = NULL, deleted_at = ? WHERE id = ?"
    ),
    searchMessages: db.prepare(`
      ${MESSAGE_SELECT}
      JOIN conversation_members cm ON cm.conversation_id = msg.conversation_id AND cm.user_id = ?
      WHERE msg.deleted_at IS NULL AND msg.body LIKE ? ESCAPE '\\'
      ORDER BY msg.id DESC LIMIT 30
    `),

    insertReaction: db.prepare(
      "INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)"
    ),
    deleteReaction: db.prepare(
      "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?"
    ),
    hasReaction: db.prepare(
      "SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?"
    ),
    clearReactions: db.prepare("DELETE FROM reactions WHERE message_id = ?"),

    insertAttachment: db.prepare(`
      INSERT INTO attachments (id, conversation_id, uploader_id, original_name, mime_type, size, storage_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    attachmentById: db.prepare(`
      SELECT a.*, msg.id AS message_id FROM attachments a
      LEFT JOIN messages msg ON msg.attachment_id = a.id WHERE a.id = ?
    `),
    deleteAttachment: db.prepare("DELETE FROM attachments WHERE id = ?"),
    orphanAttachments: db.prepare(`
      SELECT a.* FROM attachments a LEFT JOIN messages msg ON msg.attachment_id = a.id
      WHERE msg.id IS NULL AND a.created_at < ?
    `),
  };

  // ─── Serializers ─────────────────────────────────────

  function publicUser(row) {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      lastSeenAt: row.last_seen_at || null,
      online: presence.isOnline(row.id),
    };
  }

  function reactionsFor(messageIds) {
    const byMessage = new Map();
    if (messageIds.length === 0) return byMessage;
    const placeholders = messageIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${placeholders}) ORDER BY created_at`
      )
      .all(...messageIds);
    for (const row of rows) {
      const list = byMessage.get(row.message_id) || [];
      let entry = list.find(r => r.emoji === row.emoji);
      if (!entry) list.push((entry = { emoji: row.emoji, userIds: [] }));
      entry.userIds.push(row.user_id);
      byMessage.set(row.message_id, list);
    }
    return byMessage;
  }

  function serializeMessages(rows, viewerId) {
    const reactions = reactionsFor(rows.map(r => r.id));
    return rows.map(row => {
      const deleted = Boolean(row.deleted_at);
      return {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        senderName: row.sender_name,
        clientId: row.client_id,
        text: deleted ? null : row.body,
        createdAt: row.created_at,
        editedAt: row.edited_at,
        deletedAt: row.deleted_at,
        replyTo: row.reply_to_id
          ? {
              id: row.reply_to_id,
              senderId: row.reply_sender_id,
              senderName: row.reply_sender_name,
              text: row.reply_deleted_at ? null : truncate(row.reply_body, REPLY_PREVIEW_LENGTH),
              deleted: Boolean(row.reply_deleted_at),
              hasAttachment: Boolean(row.reply_attachment_id),
            }
          : null,
        attachment:
          row.attachment_id && !deleted
            ? {
                id: row.attachment_id,
                name: row.att_name,
                mimeType: row.att_mime,
                size: row.att_size,
                isImage: row.att_mime.startsWith("image/"),
                url: attachmentUrl(row.attachment_id, viewerId),
              }
            : null,
        reactions: deleted ? [] : reactions.get(row.id) || [],
      };
    });
  }

  function getMessage(messageId, viewerId) {
    const row = q.messageById.get(messageId);
    return row ? serializeMessages([row], viewerId)[0] : null;
  }

  function serializeConversation(row, viewerId, unreadCount, lastMessageId) {
    const members = q.members.all(row.id).map(m => ({
      ...publicUser({ ...m, id: m.user_id }),
      role: m.role,
      lastReadMessageId: m.last_read_message_id,
      lastDeliveredMessageId: m.last_delivered_message_id,
    }));
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      members,
      unreadCount,
      lastMessage: lastMessageId ? getMessage(lastMessageId, viewerId) : null,
    };
  }

  // ─── Users ───────────────────────────────────────────

  return {
    publicUser,

    getUserRow: id => q.userById.get(id),
    getUserByEmail: email => q.userByEmail.get(email),
    createUser(email, displayName, passwordHash) {
      const { lastInsertRowid } = q.insertUser.run(email, displayName, passwordHash, now());
      return q.userById.get(Number(lastInsertRowid));
    },
    setDisplayName: (userId, displayName) => q.updateDisplayName.run(displayName, userId),
    setPassword: (userId, hash) => q.updatePassword.run(hash, userId),
    touchLastSeen: userId => q.touchLastSeen.run(now(), userId),
    listUsers(viewerId, search) {
      if (!search) return q.otherUsers.all(viewerId).map(publicUser);
      const like = `%${escapeLike(search)}%`;
      return q.searchUsers.all(viewerId, like, like).map(publicUser);
    },
    contactIds: userId => q.contactsOf.all(userId, userId).map(r => r.id),

    // ─── Conversations ─────────────────────────────────

    membership: (conversationId, userId) => q.membership.get(conversationId, userId),
    memberIds: conversationId => q.memberIds.all(conversationId).map(r => r.user_id),

    listConversations(userId) {
      return q.conversationsForUser
        .all(userId)
        .map(row => serializeConversation(row, userId, row.unread_count, row.last_message_id));
    },

    getConversation(conversationId, viewerId) {
      const row = q.conversationById.get(conversationId);
      if (!row) return null;
      const { n } = q.unreadCount.get(viewerId, conversationId);
      return serializeConversation(row, viewerId, n, q.lastMessageId.get(conversationId).id);
    },

    /** Returns the existing direct conversation between the two users, or creates it. */
    findOrCreateDirect(userId, otherId) {
      const key = [userId, otherId].sort((a, b) => a - b).join(":");
      return transaction(db, () => {
        const existing = q.conversationByDirectKey.get(key);
        if (existing) return { id: existing.id, created: false };
        const ts = now();
        const { lastInsertRowid } = q.insertConversation.run("direct", null, key, userId, ts, ts);
        const id = Number(lastInsertRowid);
        q.insertMember.run(id, userId, "member", ts, 0, 0);
        q.insertMember.run(id, otherId, "member", ts, 0, 0);
        return { id, created: true };
      });
    },

    createGroup(creatorId, title, memberIds) {
      return transaction(db, () => {
        const ts = now();
        const { lastInsertRowid } = q.insertConversation.run("group", title, null, creatorId, ts, ts);
        const id = Number(lastInsertRowid);
        q.insertMember.run(id, creatorId, "admin", ts, 0, 0);
        for (const memberId of memberIds) q.insertMember.run(id, memberId, "member", ts, 0, 0);
        return id;
      });
    },

    renameConversation: (conversationId, title) =>
      q.renameConversation.run(title, now(), conversationId),

    removeMember: (conversationId, userId) => q.deleteMember.run(conversationId, userId),

    markRead(conversationId, userId, messageId) {
      q.advanceRead.run(messageId, messageId, conversationId, userId);
      return q.membership.get(conversationId, userId);
    },

    markDelivered(conversationId, userId, messageId) {
      const before = q.membership.get(conversationId, userId);
      q.advanceDelivered.run(messageId, conversationId, userId);
      const after = q.membership.get(conversationId, userId);
      return after.last_delivered_message_id !== before.last_delivered_message_id ? after : null;
    },

    /** Called when a user's client has fetched every conversation's latest message. */
    markAllDelivered: userId => q.advanceDeliveredAll.run(userId),

    // ─── Messages ──────────────────────────────────────

    getMessage,
    getMessageRow: messageId => q.messageById.get(messageId),
    getMessageByClientId(senderId, clientId, viewerId) {
      const row = q.messageByClientId.get(senderId, clientId);
      return row ? serializeMessages([row], viewerId)[0] : null;
    },

    listMessages(conversationId, viewerId, { before, limit }) {
      const rows = q.messagesBefore.all(conversationId, before ?? Number.MAX_SAFE_INTEGER, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).reverse();
      return { messages: serializeMessages(page, viewerId), hasMore };
    },

    createMessage({ conversationId, senderId, clientId, body, replyToId, attachmentId }) {
      return transaction(db, () => {
        const ts = now();
        const { lastInsertRowid } = q.insertMessage.run(
          conversationId, senderId, clientId, body, replyToId, attachmentId, ts
        );
        const id = Number(lastInsertRowid);
        q.touchConversation.run(ts, conversationId);
        // Sending implies the sender has seen everything up to their own message.
        q.advanceRead.run(id, id, conversationId, senderId);
        return id;
      });
    },

    editMessage: (messageId, body) => q.editMessage.run(body, now(), messageId),

    deleteMessage(messageId) {
      transaction(db, () => {
        q.softDeleteMessage.run(now(), messageId);
        q.clearReactions.run(messageId);
      });
    },

    toggleReaction(messageId, userId, emoji) {
      if (q.hasReaction.get(messageId, userId, emoji)) {
        q.deleteReaction.run(messageId, userId, emoji);
      } else {
        q.insertReaction.run(messageId, userId, emoji, now());
      }
    },

    searchMessages(userId, text) {
      const rows = q.searchMessages.all(userId, `%${escapeLike(text)}%`);
      return serializeMessages(rows, userId);
    },

    // ─── Attachments ───────────────────────────────────

    createAttachment(attachment) {
      q.insertAttachment.run(
        attachment.id, attachment.conversationId, attachment.uploaderId, attachment.name,
        attachment.mimeType, attachment.size, attachment.storageName, now()
      );
    },
    getAttachment: id => q.attachmentById.get(id),
    deleteAttachment: id => q.deleteAttachment.run(id),
    orphanAttachments: olderThan => q.orphanAttachments.all(olderThan),
  };
}

function truncate(text, length) {
  if (!text) return text;
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, ch => `\\${ch}`);
}

module.exports = { createStore };
