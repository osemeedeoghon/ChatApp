"use strict";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function string(value, field, { min = 1, max = 1000, trim = true } = {}) {
  if (typeof value !== "string") throw new HttpError(400, `${field} is required`);
  const result = trim ? value.trim() : value;
  if (result.length < min) {
    throw new HttpError(400, min <= 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  }
  if (result.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return result;
}

function optionalString(value, field, options) {
  if (value === undefined || value === null || value === "") return null;
  return string(value, field, options);
}

function email(value) {
  const result = string(value, "Email", { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(result)) throw new HttpError(400, "Enter a valid email address");
  return result;
}

function password(value, field = "Password") {
  // Not trimmed: whitespace is a legitimate part of a password.
  return string(value, field, { min: 8, max: 128, trim: false });
}

function id(value, field = "id") {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, `${field} is invalid`);
  return n;
}

function optionalId(value, field) {
  if (value === undefined || value === null) return null;
  return id(value, field);
}

module.exports = { HttpError, string, optionalString, email, password, id, optionalId };
