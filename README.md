# ChatApp

A real-time messaging app: an Expo (React Native + web) client in `ChatApp/` and a Node.js
server in `chat-server/`.

## Features

- Email/password accounts with display names, profile editing and password changes
- One-to-one and group conversations (create, rename, leave)
- Real-time delivery over Socket.IO with automatic reconnection and catch-up
- Sent / delivered / read indicators backed by server-side receipts
- Typing indicators and online / last-seen presence
- Replies, editing, delete-for-everyone and emoji reactions
- Photo and file attachments (validated on the server, served only to conversation members)
- Search across conversations and message text
- Unread counts (also shown in the browser tab title) and paginated history
- Light, dark and system themes; responsive layout with a split view on tablets and desktops

## Running locally

Requires **Node.js 22.13 or newer** (the server uses the built-in `node:sqlite` module).

```bash
cd chat-server
npm install
npm start          # http://localhost:3000
```

```bash
cd ChatApp
npm install
npx expo start     # press w for web, or scan the QR code with Expo Go
```

The app finds the server automatically on port 3000 of the machine serving the app. To point it
elsewhere, set `EXPO_PUBLIC_API_URL` (for example `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000`).

### Server configuration

Copy `chat-server/.env.example` to `chat-server/.env` (git-ignored) and adjust as needed:

| Variable        | Default          | Notes |
| --------------- | ---------------- | ----- |
| `JWT_SECRET`    | generated        | **Required in production.** In development a random secret is created in `data/.jwt-secret`. |
| `PORT`          | `3000`           | |
| `DATA_DIR`      | `chat-server/data` | SQLite database and uploaded files. |
| `CORS_ORIGIN`   | `*`              | Comma-separated list of allowed browser origins. |
| `MAX_UPLOAD_MB` | `10`             | |
| `TOKEN_TTL`     | `7d`             | Session lifetime. |

## Checks

```bash
cd chat-server && npm test          # API, authorization and real-time integration tests
cd ChatApp && npx tsc --noEmit      # type check
cd ChatApp && npm run lint
cd ChatApp && npx expo export       # production bundles for web, iOS and Android
```

## Security notes

- Passwords are hashed with bcrypt; login and password endpoints are rate limited.
- Every conversation, message, receipt, typing and attachment request checks membership on the
  server. Non-members get `404` so conversation ids can't be probed.
- Changing a password revokes all existing sessions.
- Uploads are restricted to an allowlist of types whose file signatures are checked; SVG/HTML are
  rejected. Downloads use short-lived links signed for a specific user and re-check membership.
- Messages are stored in plain text on the server. **There is no end-to-end encryption.** Use HTTPS
  (e.g. behind a reverse proxy) for anything beyond local development.

## Known limitations

- Single server process: presence and rate limiting are kept in memory, so running several
  instances needs a shared store (e.g. Redis and the Socket.IO Redis adapter).
- No push notifications; new-message alerts appear only while the app is open.
- Every registered user can see every other user's display name and email when starting a chat.
- Edits to older messages made while a client was offline appear after the conversation is reopened.
