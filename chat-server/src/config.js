"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Reads the JWT secret from the environment. Outside production a random secret is
 * generated once and stored (git-ignored) in the data directory so sessions survive
 * restarts without anyone ever committing a secret.
 */
function loadJwtSecret(dataDir, isProduction) {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isProduction) throw new Error("JWT_SECRET must be set when NODE_ENV=production");

  const file = path.join(dataDir, ".jwt-secret");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // Not created yet.
  }
  const secret = crypto.randomBytes(48).toString("hex");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  console.warn(`JWT_SECRET not set: generated a local development secret in ${file}`);
  return secret;
}

function loadConfig(overrides = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  const dataDir = path.resolve(
    overrides.dataDir || process.env.DATA_DIR || path.join(__dirname, "..", "data")
  );
  fs.mkdirSync(dataDir, { recursive: true });

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean)
    : "*";

  return {
    port: Number(process.env.PORT) || 3000,
    dataDir,
    dbFile: path.join(dataDir, "chat.db"),
    uploadDir: path.join(dataDir, "uploads"),
    jwtSecret: overrides.jwtSecret || loadJwtSecret(dataDir, isProduction),
    tokenTtl: process.env.TOKEN_TTL || "7d",
    attachmentTokenTtl: "12h",
    maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024,
    corsOrigin,
    // Attempts per 15 minutes for credential endpoints.
    rateLimits: { register: 20, login: 10, password: 10 },
    ...overrides,
  };
}

module.exports = { loadConfig };
