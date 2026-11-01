"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io: connect } = require("socket.io-client");

const { loadConfig } = require("../src/config");
const { createChatServer } = require("../src/server");

let server;
let baseUrl;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-test-"));
  server = createChatServer(loadConfig({ dataDir, jwtSecret: "test-secret", rateLimits: { register: 1000, login: 3, password: 10 } }));
  await new Promise(resolve => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});

after(() => {
  server.close();
  server.httpServer.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function api(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(baseUrl + url, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

let counter = 0;
async function registerUser(name = "user") {
  counter += 1;
  const email = `${name}${counter}@example.com`;
  const { status, data } = await api("POST", "/api/register", {
    body: { email, password: "correct horse", displayName: `${name} ${counter}` },
  });
  assert.equal(status, 201);
  return { ...data.user, token: data.token, email };
}

function socketFor(user) {
  return new Promise((resolve, reject) => {
    const socket = connect(baseUrl, { auth: { token: user.token }, transports: ["websocket"] });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

const nextEvent = (socket, event) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 2000);
    socket.once(event, payload => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

test("registration validates input and rejects duplicates", async () => {
  let res = await api("POST", "/api/register", { body: { email: "bad", password: "longenough" } });
  assert.equal(res.status, 400);
  res = await api("POST", "/api/register", { body: { email: "a@b.co", password: "short" } });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /at least 8/);

  const user = await registerUser();
  res = await api("POST", "/api/register", { body: { email: user.email.toUpperCase(), password: "whatever123" } });
  assert.equal(res.status, 409);
});

test("login returns a token and rejects wrong passwords", async () => {
  const user = await registerUser();
  let res = await api("POST", "/api/login", { body: { email: user.email, password: "wrong password" } });
  assert.equal(res.status, 401);
  res = await api("POST", "/api/login", { body: { email: user.email, password: "correct horse" } });
  assert.equal(res.status, 200);
  assert.ok(res.data.token);
  assert.equal(res.data.user.email, user.email);
  assert.equal(res.data.user.password_hash, undefined);
});

test("login attempts are rate limited per account", async () => {
  const user = await registerUser();
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    statuses.push((await api("POST", "/api/login", { body: { email: user.email, password: "nope nope" } })).status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 429]);
});

test("protected endpoints require a valid token", async () => {
  assert.equal((await api("GET", "/api/conversations")).status, 401);
  assert.equal((await api("GET", "/api/conversations", { token: "garbage" })).status, 401);
});

test("only members can read or write a conversation", async () => {
  const alice = await registerUser("alice");
  const bob = await registerUser("bob");
  const eve = await registerUser("eve");

  const { data: convo } = await api("POST", "/api/conversations", { token: alice.token, body: { userId: bob.id } });
  const again = await api("POST", "/api/conversations", { token: bob.token, body: { userId: alice.id } });
  assert.equal(again.data.id, convo.id, "direct conversations are not duplicated");

  await api("POST", `/api/conversations/${convo.id}/messages`, { token: alice.token, body: { text: "secret" } });

  assert.equal((await api("GET", `/api/conversations/${convo.id}/messages`, { token: eve.token })).status, 404);
  assert.equal(
    (await api("POST", `/api/conversations/${convo.id}/messages`, { token: eve.token, body: { text: "hi" } })).status,
    404
  );
  const { data: page } = await api("GET", `/api/conversations/${convo.id}/messages`, { token: bob.token });
  assert.equal(page.messages[0].text, "secret");
});

test("sending is idempotent per clientId and validates content", async () => {
  const alice = await registerUser("alice");
  const bob = await registerUser("bob");
  const { data: convo } = await api("POST", "/api/conversations", { token: alice.token, body: { userId: bob.id } });
  const url = `/api/conversations/${convo.id}/messages`;

  assert.equal((await api("POST", url, { token: alice.token, body: { text: "   " } })).status, 400);
  assert.equal((await api("POST", url, { token: alice.token, body: { text: "x".repeat(4001) } })).status, 400);

  const first = await api("POST", url, { token: alice.token, body: { text: "hello", clientId: "c-1" } });
  const retry = await api("POST", url, { token: alice.token, body: { text: "hello", clientId: "c-1" } });
  assert.equal(first.status, 201);
  assert.equal(retry.data.id, first.data.id);

  const { data: page } = await api("GET", url, { token: bob.token });
  assert.equal(page.messages.length, 1);
});

test("unread counts, read receipts, edit, delete, reactions and replies", async () => {
  const alice = await registerUser("alice");
  const bob = await registerUser("bob");
  const { data: convo } = await api("POST", "/api/conversations", { token: alice.token, body: { userId: bob.id } });
  const url = `/api/conversations/${convo.id}/messages`;
  const { data: m1 } = await api("POST", url, { token: alice.token, body: { text: "one" } });
  const { data: m2 } = await api("POST", url, { token: alice.token, body: { text: "two", replyToId: m1.id } });
  assert.equal(m2.replyTo.text, "one");

  let { data: list } = await api("GET", "/api/conversations", { token: bob.token });
  assert.equal(list.find(c => c.id === convo.id).unreadCount, 2);

  await api("POST", `/api/conversations/${convo.id}/read`, { token: bob.token, body: { messageId: m2.id } });
  ({ data: list } = await api("GET", "/api/conversations", { token: bob.token }));
  const seen = list.find(c => c.id === convo.id);
  assert.equal(seen.unreadCount, 0);
  assert.equal(seen.members.find(m => m.id === bob.id).lastReadMessageId, m2.id);

  assert.equal((await api("PATCH", `/api/messages/${m1.id}`, { token: bob.token, body: { text: "hacked" } })).status, 403);
  const edited = await api("PATCH", `/api/messages/${m1.id}`, { token: alice.token, body: { text: "uno" } });
  assert.equal(edited.data.text, "uno");
  assert.ok(edited.data.editedAt);

  const reacted = await api("POST", `/api/messages/${m1.id}/reactions`, { token: bob.token, body: { emoji: "👍" } });
  assert.deepEqual(reacted.data.reactions, [{ emoji: "👍", userIds: [bob.id] }]);
  const unreacted = await api("POST", `/api/messages/${m1.id}/reactions`, { token: bob.token, body: { emoji: "👍" } });
  assert.deepEqual(unreacted.data.reactions, []);
  assert.equal((await api("POST", `/api/messages/${m1.id}/reactions`, { token: bob.token, body: { emoji: "<b>" } })).status, 400);

  const deleted = await api("DELETE", `/api/messages/${m1.id}`, { token: alice.token });
  assert.equal(deleted.data.text, null);
  assert.ok(deleted.data.deletedAt);
  const { data: page } = await api("GET", url, { token: bob.token });
  assert.equal(page.messages[1].replyTo.deleted, true);
});

test("message history paginates", async () => {
  const alice = await registerUser("alice");
  const bob = await registerUser("bob");
  const { data: convo } = await api("POST", "/api/conversations", { token: alice.token, body: { userId: bob.id } });
  const url = `/api/conversations/${convo.id}/messages`;
  for (let i = 0; i < 5; i++) await api("POST", url, { token: alice.token, body: { text: `m${i}` } });

  const first = await api("GET", `${url}?limit=3`, { token: bob.token });
  assert.deepEqual(first.data.messages.map(m => m.text), ["m2", "m3", "m4"]);
  assert.equal(first.data.hasMore, true);
  const second = await api("GET", `${url}?limit=3&before=${first.data.messages[0].id}`, { token: bob.token });
  assert.deepEqual(second.data.messages.map(m => m.text), ["m0", "m1"]);
  assert.equal(second.data.hasMore, false);
});

test("group chats, search and leaving", async () => {
  const alice = await registerUser("alice");
  const bob = await registerUser("bob");
  const carol = await registerUser("carol");
  const outsider = await registerUser("dave");

  assert.equal(
    (await api("POST", "/api/conversations", { token: alice.token, body: { title: "Team", userIds: [bob.id] } })).status,
    400
  );
  const { data: group } = await api("POST", "/api/conversations", {
    token: alice.token,
    body: { title: "Team", userIds: [bob.id, carol.id] },
  });
  assert.equal(group.type, "group");
  assert.equal(group.members.length, 3);

  await api("POST", `/api/conversations/${group.id}/messages`, { token: bob.token, body: { text: "launch 100% ready" } });
  const found = await api("GET", "/api/search?q=100%25", { token: carol.token });
  assert.equal(found.data.length, 1);
  const hidden = await api("GET", "/api/search?q=launch", { token: outsider.token });
  assert.equal(hidden.data.length, 0);

  assert.equal((await api("POST", `/api/conversations/${group.id}/leave`, { token: carol.token })).status, 204);
  assert.equal((await api("GET", `/api/conversations/${group.id}/messages`, { token: carol.token })).status, 404);
});

test("attachments are validated and only served to members", async () => {
  const alice = await registerUser("alice");
  const bob = await registerUser("bob");
  const eve = await registerUser("eve");
  const { data: convo } = await api("POST", "/api/conversations", { token: alice.token, body: { userId: bob.id } });

  const fake = new FormData();
  fake.append("file", new Blob(["not really a png"], { type: "image/png" }), "x.png");
  assert.equal((await api("POST", `/api/conversations/${convo.id}/attachments`, { token: alice.token, form: fake })).status, 415);

  const svg = new FormData();
  svg.append("file", new Blob(["<svg/>"], { type: "image/svg+xml" }), "x.svg");
  assert.equal((await api("POST", `/api/conversations/${convo.id}/attachments`, { token: alice.token, form: svg })).status, 415);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "../../photo.png");
  assert.equal((await api("POST", `/api/conversations/${convo.id}/attachments`, { token: eve.token, form })).status, 404);

  const uploaded = await api("POST", `/api/conversations/${convo.id}/attachments`, { token: alice.token, form });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.data.name, "photo.png");

  // Someone else cannot attach Alice's upload.
  const stolen = await api("POST", `/api/conversations/${convo.id}/messages`, {
    token: bob.token,
    body: { attachmentId: uploaded.data.id },
  });
  assert.equal(stolen.status, 400);

  const { data: message } = await api("POST", `/api/conversations/${convo.id}/messages`, {
    token: alice.token,
    body: { attachmentId: uploaded.data.id },
  });
  assert.equal(message.attachment.isImage, true);

  const { data: page } = await api("GET", `/api/conversations/${convo.id}/messages`, { token: bob.token });
  const download = await fetch(baseUrl + page.messages[0].attachment.url);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);

  const noToken = await fetch(`${baseUrl}/api/attachments/${uploaded.data.id}`);
  assert.equal(noToken.status, 401);
});

test("password change revokes old sessions", async () => {
  const user = await registerUser();
  const res = await api("POST", "/api/me/password", {
    token: user.token,
    body: { currentPassword: "correct horse", newPassword: "battery staple" },
  });
  assert.equal(res.status, 200);
  assert.equal((await api("GET", "/api/me", { token: user.token })).status, 401);
  assert.equal((await api("GET", "/api/me", { token: res.data.token })).status, 200);
});

test("realtime: new messages, typing, delivery receipts and presence", async () => {
  const alice = await registerUser("alice");
  const bob = await registerUser("bob");
  const eve = await registerUser("eve");
  const { data: convo } = await api("POST", "/api/conversations", { token: alice.token, body: { userId: bob.id } });

  const aliceSocket = await socketFor(alice);
  const eveSocket = await socketFor(eve);
  const presence = nextEvent(aliceSocket, "presence");
  const bobSocket = await socketFor(bob);
  assert.deepEqual((await presence).online, true);

  let eveSawMessage = false;
  eveSocket.on("message:new", () => (eveSawMessage = true));

  const incoming = nextEvent(bobSocket, "message:new");
  const { data: sent } = await api("POST", `/api/conversations/${convo.id}/messages`, {
    token: alice.token,
    body: { text: "ping" },
  });
  const received = await incoming;
  assert.equal(received.id, sent.id);

  const receipt = nextEvent(aliceSocket, "receipt");
  bobSocket.emit("message:delivered", { conversationId: convo.id, messageId: sent.id });
  const r = await receipt;
  assert.equal(r.userId, bob.id);
  assert.equal(r.lastDeliveredMessageId, sent.id);
  assert.equal(r.lastReadMessageId, 0);

  const typing = nextEvent(aliceSocket, "typing");
  bobSocket.emit("typing", { conversationId: convo.id, isTyping: true });
  assert.deepEqual(await typing, { conversationId: convo.id, userId: bob.id, isTyping: true });

  // Non-members cannot spoof typing into the conversation.
  let spoofed = false;
  aliceSocket.once("typing", () => (spoofed = true));
  eveSocket.emit("typing", { conversationId: convo.id, isTyping: true });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(spoofed, false);
  assert.equal(eveSawMessage, false);

  const offline = nextEvent(aliceSocket, "presence");
  bobSocket.disconnect();
  const p = await offline;
  assert.equal(p.online, false);
  assert.ok(p.lastSeenAt);

  aliceSocket.disconnect();
  eveSocket.disconnect();
});

test("sockets reject invalid tokens", async () => {
  await assert.rejects(socketFor({ token: "nope" }));
});
