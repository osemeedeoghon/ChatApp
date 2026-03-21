const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const SECRET = "secret123";

let users = [];
let conversations = [];

// ─── AUTH MIDDLEWARE ───────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ─── REGISTER ─────────────────────────────────────────
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  if (users.find(u => u.email === email))
    return res.status(400).json({ error: "User already exists" });

  const hashed = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), email, password: hashed };
  users.push(user);
  res.json({ message: "User created" });
});

// ─── LOGIN ────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user.id, email: user.email }, SECRET);
  res.json({ token });
});

// ─── GET ALL USERS (except self) ──────────────────────
app.get("/api/users", auth, (req, res) => {
  const others = users
    .filter(u => u.id !== req.user.id)
    .map(u => ({ id: u.id, email: u.email }));
  res.json(others);
});

// ─── GET MY CONVERSATIONS ─────────────────────────────
app.get("/api/conversations", auth, (req, res) => {
  const mine = conversations
    .filter(c => c.participants.includes(req.user.id))
    .map(c => {
      const otherId = c.participants.find(id => id !== req.user.id);
      const other = users.find(u => u.id === otherId);
      return {
        id: c.id,
        otherUser: { id: other?.id, email: other?.email },
        lastMessage: c.messages[c.messages.length - 1] || null,
      };
    });
  res.json(mine);
});

// ─── CREATE OR GET CONVERSATION ───────────────────────
app.post("/api/conversations", auth, (req, res) => {
  const { userId } = req.body;
  const existing = conversations.find(
    c => c.participants.includes(req.user.id) && c.participants.includes(userId)
  );
  if (existing) return res.json(existing);

  const convo = {
    id: Date.now().toString(),
    participants: [req.user.id, userId],
    messages: [],
  };
  conversations.push(convo);
  res.json(convo);
});

// ─── GET MESSAGES ─────────────────────────────────────
app.get("/api/conversations/:id/messages", auth, (req, res) => {
  const convo = conversations.find(c => c.id === req.params.id);
  if (!convo) return res.status(404).json({ error: "Conversation not found" });
  res.json(convo.messages);
});

// ─── SEND MESSAGE ─────────────────────────────────────
app.post("/api/conversations/:id/messages", auth, (req, res) => {
  const convo = conversations.find(c => c.id === req.params.id);
  if (!convo) return res.status(404).json({ error: "Conversation not found" });

  const message = {
    id: Date.now().toString(),
    senderId: req.user.id,
    text: req.body.text,
    createdAt: new Date().toISOString(),
  };

  convo.messages.push(message);
  res.json(message);
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));