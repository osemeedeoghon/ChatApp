"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { HttpError } = require("./validation");

// Only formats we can sanity-check are accepted. SVG and HTML are deliberately
// excluded because they can carry script when served back to a browser.
const ALLOWED_TYPES = {
  "image/jpeg": buf => startsWith(buf, [0xff, 0xd8, 0xff]),
  "image/png": buf => startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/gif": buf => buf.subarray(0, 6).toString("latin1").startsWith("GIF8"),
  "image/webp": buf =>
    buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP",
  "application/pdf": buf => buf.subarray(0, 5).toString("latin1") === "%PDF-",
  "application/zip": isZip,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZip,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZip,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": isZip,
  "text/plain": isText,
  "text/csv": isText,
};

function startsWith(buf, bytes) {
  return buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);
}

function isZip(buf) {
  return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
}

function isText(buf) {
  return !buf.subarray(0, 8192).includes(0);
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || "file")).replace(/[\u0000-\u001f\u007f"\\/]/g, "_").trim();
  return (base || "file").slice(0, 120);
}

function createAttachmentStorage(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });

  return {
    /** Validates an uploaded multer file and writes it to disk. */
    save(file) {
      if (!file) throw new HttpError(400, "No file was uploaded");
      const mimeType = String(file.mimetype || "").toLowerCase();
      const check = ALLOWED_TYPES[mimeType];
      if (!check) throw new HttpError(415, "This file type is not supported");
      if (file.size === 0) throw new HttpError(400, "The file is empty");
      if (!check(file.buffer)) throw new HttpError(415, "The file contents do not match its type");

      const id = crypto.randomBytes(16).toString("hex");
      fs.writeFileSync(path.join(uploadDir, id), file.buffer, { mode: 0o600 });
      return { id, storageName: id, name: sanitizeFilename(file.originalname), mimeType, size: file.size };
    },

    pathFor: storageName => path.join(uploadDir, path.basename(storageName)),

    remove(storageName) {
      fs.rm(path.join(uploadDir, path.basename(storageName)), { force: true }, () => {});
    },
  };
}

module.exports = { createAttachmentStorage, ALLOWED_MIME_TYPES: Object.keys(ALLOWED_TYPES) };
