"use strict";

const http = require("node:http");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const { openDatabase } = require("./db");
const { createStore } = require("./store");
const { createRealtime } = require("./realtime");
const { createAttachmentStorage } = require("./attachments");
const v = require("./validation");
const { HttpError } = v;

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const MAX_MESSAGE_LENGTH = 4000;
const MAX_GROUP_MEMBERS = 50;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

function createChatServer(config) {
  const db = openDatabase(config.dbFile);
  const files = createAttachmentStorage(config.uploadDir);

  // Presence is wired up after the realtime layer exists (they depend on each other).
  const presence = { isOnline: () => false };
  const store = createStore(db, {
    presence: { isOnline: id => presence.isOnline(id) },
    attachmentUrl: (attachmentId, viewerId) => {
      const token = jwt.sign({ typ: "att", a: attachmentId, u: viewerId }, config.jwtSecret, {
        expiresIn: config.attachmentTokenTtl,
      });
      return `/api/attachments/${attachmentId}?token=${encodeURIComponent(token)}`;
    },
  });

  // ─── Auth helpers ────────────────────────────────────

  function issueToken(user) {
    return jwt.sign({ id: user.id, tv: user.token_version }, config.jwtSecret, {
      expiresIn: config.tokenTtl,
    });
  }

  /** Returns the user row for a valid, unrevoked session token, otherwise null. */
  function authenticateToken(token) {
    if (typeof token !== "string" || !token) return null;
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      if (payload.typ) return null; // Attachment tokens are not session tokens.
      const user = store.getUserRow(payload.id);
      if (!user || user.token_version !== payload.tv) return null;
      return user;
    } catch {
      return null;
    }
  }

  const auth = (req, res, next) => {
    const header = req.headers.authorization || "";
    const user = authenticateToken(header.startsWith("Bearer ") ? header.slice(7) : null);
    if (!user) return next(new HttpError(401, "Your session has expired. Please sign in again."));
    req.user = user;
    next();
  };

  // Fixed-window limiter for credential endpoints; in-memory is enough for one process.
  const attempts = new Map();
  function rateLimit(key, limit, windowMs = 15 * 60 * 1000) {
    const nowMs = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt < nowMs) {
      attempts.set(key, { count: 1, resetAt: nowMs + windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > limit) throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
  }

  function requireMember(conversationId, userId) {
    const membership = store.membership(conversationId, userId);
    // 404 rather than 403 so conversation ids cannot be probed.
    if (!membership) throw new HttpError(404, "Conversation not found");
    return membership;
  }

  function requireOwnMessage(messageId, userId) {
    const message = store.getMessageRow(messageId);
    if (!message || !store.membership(message.conversation_id, userId)) {
      throw new HttpError(404, "Message not found");
    }
    if (message.sender_id !== userId) throw new HttpError(403, "You can only change your own messages");
    if (message.deleted_at) throw new HttpError(409, "This message was deleted");
    return message;
  }

  // ─── Event fan-out ───────────────────────────────────

  function pushConversation(conversationId, userIds = store.memberIds(conversationId)) {
    realtime.emitToUsers(userIds, "conversation:updated", userId =>
      store.getConversation(conversationId, userId)
    );
  }

  function pushMessage(event, messageId, conversationId) {
    realtime.emitToUsers(store.memberIds(conversationId), event, userId =>
      store.getMessage(messageId, userId)
    );
  }

  // ─── HTTP app ────────────────────────────────────────

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(cors({ origin: config.corsOrigin }));
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  });

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  // ─── Auth ────────────────────────────────────────────

  app.post("/api/register", async (req, res) => {
    rateLimit(`register:${req.ip}`, config.rateLimits.register);
    const email = v.email(req.body?.email);
    const password = v.password(req.body?.password);
    const displayName =
      v.optionalString(req.body?.displayName, "Display name", { max: 50 }) || email.split("@")[0];

    if (store.getUserByEmail(email)) throw new HttpError(409, "An account with this email already exists");
    const user = store.createUser(email, displayName, await bcrypt.hash(password, 12));
    res.status(201).json({ token: issueToken(user), user: store.publicUser(user) });
  });

  app.post("/api/login", async (req, res) => {
    const email = v.email(req.body?.email);
    const password = v.string(req.body?.password, "Password", { max: 128, trim: false });
    rateLimit(`login:${req.ip}:${email}`, config.rateLimits.login);

    const user = store.getUserByEmail(email);
    // Compare against a dummy hash when the user does not exist to keep timing uniform.
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, "Incorrect email or password");
    res.json({ token: issueToken(user), user: store.publicUser(user) });
  });

  app.get("/api/me", auth, (req, res) => res.json(store.publicUser(req.user)));

  app.patch("/api/me", auth, (req, res) => {
    const displayName = v.string(req.body?.displayName, "Display name", { max: 50 });
    store.setDisplayName(req.user.id, displayName);
    const user = store.getUserRow(req.user.id);
    realtime.emitToUsers(store.contactIds(user.id), "user:updated", store.publicUser(user));
    res.json(store.publicUser(user));
  });

  app.post("/api/me/password", auth, async (req, res) => {
    rateLimit(`password:${req.user.id}`, config.rateLimits.password);
    const current = v.string(req.body?.currentPassword, "Current password", { max: 128, trim: false });
    const next = v.password(req.body?.newPassword, "New password");
    if (!(await bcrypt.compare(current, req.user.password_hash))) {
      throw new HttpError(400, "Current password is incorrect");
    }
    store.setPassword(req.user.id, await bcrypt.hash(next, 12));
    // Revoke every existing session (the token version changed) and hand back a fresh one.
    realtime.disconnectUser(req.user.id);
    const user = store.getUserRow(req.user.id);
    res.json({ token: issueToken(user), user: store.publicUser(user) });
  });

  // ─── Users ───────────────────────────────────────────

  app.get("/api/users", auth, (req, res) => {
    const search = v.optionalString(req.query.q, "Search", { max: 100 });
    res.json(store.listUsers(req.user.id, search));
  });

  // ─── Conversations ───────────────────────────────────

  app.get("/api/conversations", auth, (req, res) => {
    const conversations = store.listConversations(req.user.id);
    // The latest message of every conversation has now reached this client.
    store.markAllDelivered(req.user.id);
    res.json(conversations);
  });

  app.post("/api/conversations", auth, (req, res) => {
    const me = req.user.id;

    if (req.body?.userId !== undefined) {
      const otherId = v.id(req.body.userId, "userId");
      if (otherId === me) throw new HttpError(400, "You can't start a conversation with yourself");
      if (!store.getUserRow(otherId)) throw new HttpError(404, "User not found");
      const { id, created } = store.findOrCreateDirect(me, otherId);
      if (created) pushConversation(id);
      return res.status(created ? 201 : 200).json(store.getConversation(id, me));
    }

    const title = v.string(req.body?.title, "Group name", { max: 80 });
    if (!Array.isArray(req.body?.userIds)) throw new HttpError(400, "Choose at least two people");
    const memberIds = [...new Set(req.body.userIds.map(id => v.id(id, "userId")))].filter(id => id !== me);
    if (memberIds.length < 2) throw new HttpError(400, "A group needs at least two other people");
    if (memberIds.length >= MAX_GROUP_MEMBERS) throw new HttpError(400, `Groups are limited to ${MAX_GROUP_MEMBERS} people`);
    if (memberIds.some(id => !store.getUserRow(id))) throw new HttpError(404, "User not found");

    const id = store.createGroup(me, title, memberIds);
    pushConversation(id);
    res.status(201).json(store.getConversation(id, me));
  });

  app.get("/api/conversations/:id", auth, (req, res) => {
    const conversationId = v.id(req.params.id);
    requireMember(conversationId, req.user.id);
    res.json(store.getConversation(conversationId, req.user.id));
  });

  app.patch("/api/conversations/:id", auth, (req, res) => {
    const conversationId = v.id(req.params.id);
    requireMember(conversationId, req.user.id);
    const conversation = store.getConversation(conversationId, req.user.id);
    if (conversation.type !== "group") throw new HttpError(400, "Only group chats can be renamed");
    store.renameConversation(conversationId, v.string(req.body?.title, "Group name", { max: 80 }));
    pushConversation(conversationId);
    res.json(store.getConversation(conversationId, req.user.id));
  });

  app.post("/api/conversations/:id/leave", auth, (req, res) => {
    const conversationId = v.id(req.params.id);
    requireMember(conversationId, req.user.id);
    if (store.getConversation(conversationId, req.user.id).type !== "group") {
      throw new HttpError(400, "You can only leave group chats");
    }
    store.removeMember(conversationId, req.user.id);
    pushConversation(conversationId);
    realtime.emitToUsers([req.user.id], "conversation:removed", { conversationId });
    res.status(204).end();
  });

  app.post("/api/conversations/:id/read", auth, (req, res) => {
    const conversationId = v.id(req.params.id);
    requireMember(conversationId, req.user.id);
    const messageId = v.id(req.body?.messageId, "messageId");
    const message = store.getMessageRow(messageId);
    if (!message || message.conversation_id !== conversationId) throw new HttpError(404, "Message not found");
    const membership = store.markRead(conversationId, req.user.id, messageId);
    realtime.emitReceipt(conversationId, membership);
    res.json({ lastReadMessageId: membership.last_read_message_id });
  });

  // ─── Messages ────────────────────────────────────────

  app.get("/api/conversations/:id/messages", auth, (req, res) => {
    const conversationId = v.id(req.params.id);
    requireMember(conversationId, req.user.id);
    const before = v.optionalId(req.query.before, "before");
    const limit = Math.min(Number(req.query.limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const page = store.listMessages(conversationId, req.user.id, { before, limit: Math.max(1, limit) });

    const newest = page.messages[page.messages.length - 1];
    if (!before && newest) {
      const updated = store.markDelivered(conversationId, req.user.id, newest.id);
      if (updated) realtime.emitReceipt(conversationId, updated);
    }
    res.json(page);
  });

  app.post("/api/conversations/:id/messages", auth, (req, res) => {
    const conversationId = v.id(req.params.id);
    const me = req.user.id;
    requireMember(conversationId, me);

    const clientId = v.optionalString(req.body?.clientId, "clientId", { max: 64 });
    if (clientId) {
      // Retried send: return the message that was already stored instead of duplicating it.
      const existing = store.getMessageByClientId(me, clientId, me);
      if (existing) {
        if (existing.conversationId !== conversationId) throw new HttpError(409, "clientId already used");
        return res.json(existing);
      }
    }

    const text = v.optionalString(req.body?.text, "Message", { max: MAX_MESSAGE_LENGTH });
    const attachmentId = v.optionalString(req.body?.attachmentId, "attachmentId", { max: 64 });
    if (!text && !attachmentId) throw new HttpError(400, "Message can't be empty");

    const replyToId = v.optionalId(req.body?.replyToId, "replyToId");
    if (replyToId) {
      const target = store.getMessageRow(replyToId);
      if (!target || target.conversation_id !== conversationId) throw new HttpError(400, "The message you replied to no longer exists");
    }

    if (attachmentId) {
      const attachment = store.getAttachment(attachmentId);
      if (!attachment || attachment.uploader_id !== me || attachment.conversation_id !== conversationId) {
        throw new HttpError(400, "Attachment not found");
      }
      if (attachment.message_id) throw new HttpError(409, "Attachment was already sent");
    }

    const id = store.createMessage({ conversationId, senderId: me, clientId, body: text, replyToId, attachmentId });
    pushMessage("message:new", id, conversationId);
    res.status(201).json(store.getMessage(id, me));
  });

  app.patch("/api/messages/:id", auth, (req, res) => {
    const messageId = v.id(req.params.id);
    const message = requireOwnMessage(messageId, req.user.id);
    const text = v.string(req.body?.text, "Message", { max: MAX_MESSAGE_LENGTH });
    store.editMessage(messageId, text);
    pushMessage("message:updated", messageId, message.conversation_id);
    res.json(store.getMessage(messageId, req.user.id));
  });

  app.delete("/api/messages/:id", auth, (req, res) => {
    const messageId = v.id(req.params.id);
    const message = requireOwnMessage(messageId, req.user.id);
    store.deleteMessage(messageId);
    if (message.attachment_id) {
      const attachment = store.getAttachment(message.attachment_id);
      store.deleteAttachment(message.attachment_id);
      if (attachment) files.remove(attachment.storage_name);
    }
    pushMessage("message:updated", messageId, message.conversation_id);
    res.json(store.getMessage(messageId, req.user.id));
  });

  app.post("/api/messages/:id/reactions", auth, (req, res) => {
    const messageId = v.id(req.params.id);
    const message = store.getMessageRow(messageId);
    if (!message || !store.membership(message.conversation_id, req.user.id)) {
      throw new HttpError(404, "Message not found");
    }
    if (message.deleted_at) throw new HttpError(409, "This message was deleted");
    const emoji = req.body?.emoji;
    if (!REACTIONS.includes(emoji)) throw new HttpError(400, "Unsupported reaction");
    store.toggleReaction(messageId, req.user.id, emoji);
    pushMessage("message:updated", messageId, message.conversation_id);
    res.json(store.getMessage(messageId, req.user.id));
  });

  app.get("/api/search", auth, (req, res) => {
    const text = v.string(req.query.q, "Search", { min: 2, max: 100 });
    res.json(store.searchMessages(req.user.id, text));
  });

  // ─── Attachments ─────────────────────────────────────

  app.post("/api/conversations/:id/attachments", auth, (req, res, next) => {
    const conversationId = v.id(req.params.id);
    requireMember(conversationId, req.user.id);
    upload.single("file")(req, res, err => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(new HttpError(413, `Files must be smaller than ${Math.round(config.maxUploadBytes / 1048576)} MB`));
        }
        return next(new HttpError(400, "Upload failed"));
      }
      try {
        const saved = files.save(req.file);
        store.createAttachment({ ...saved, conversationId, uploaderId: req.user.id });
        res.status(201).json({ id: saved.id, name: saved.name, mimeType: saved.mimeType, size: saved.size });
      } catch (e) {
        next(e);
      }
    });
  });

  app.get("/api/attachments/:id", (req, res) => {
    let payload;
    try {
      payload = jwt.verify(String(req.query.token || ""), config.jwtSecret);
    } catch {
      throw new HttpError(401, "This link has expired");
    }
    const attachment = store.getAttachment(req.params.id);
    const allowed =
      payload.typ === "att" &&
      payload.a === req.params.id &&
      attachment &&
      store.membership(attachment.conversation_id, payload.u);
    if (!allowed) throw new HttpError(404, "Attachment not found");

    const inline = attachment.mime_type.startsWith("image/");
    res.set("Content-Type", attachment.mime_type);
    res.set("Cache-Control", "private, max-age=3600");
    res.set("Content-Security-Policy", "default-src 'none'; sandbox");
    res.set(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`
    );
    res.sendFile(files.pathFor(attachment.storage_name));
  });

  // ─── Errors ──────────────────────────────────────────

  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON" });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  // ─── Wiring ──────────────────────────────────────────

  const httpServer = http.createServer(app);
  const realtime = createRealtime(httpServer, { config, store, authenticateToken });
  presence.isOnline = realtime.isOnline;

  // Uploads that were never attached to a message are removed after a day.
  function cleanupOrphans() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    for (const attachment of store.orphanAttachments(cutoff)) {
      store.deleteAttachment(attachment.id);
      files.remove(attachment.storage_name);
    }
  }
  cleanupOrphans();
  const cleanupTimer = setInterval(cleanupOrphans, 60 * 60 * 1000);
  cleanupTimer.unref();

  return {
    app,
    httpServer,
    io: realtime.io,
    close() {
      clearInterval(cleanupTimer);
      realtime.io.close();
      db.close();
    },
  };
}

// Hash of a random string, used only to equalise login timing for unknown emails.
const DUMMY_HASH = bcrypt.hashSync(require("node:crypto").randomBytes(16).toString("hex"), 12);

module.exports = { createChatServer, REACTIONS };
