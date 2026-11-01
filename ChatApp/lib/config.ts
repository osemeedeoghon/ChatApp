import Constants from "expo-constants";
import { Platform } from "react-native";

const SERVER_PORT = 3000;

/**
 * Where the chat server lives. Set EXPO_PUBLIC_API_URL to override; otherwise the
 * app talks to port 3000 on the same machine that serves the app (the browser's
 * host on web, the Expo dev server's LAN address on a device).
 */
function resolveApiUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
    return `http://${window.location.hostname}:${SERVER_PORT}`;
  }
  const devHost = Constants.expoConfig?.hostUri?.split(":")[0];
  if (devHost) return `http://${devHost}:${SERVER_PORT}`;
  return `http://localhost:${SERVER_PORT}`;
}

export const API_URL = resolveApiUrl();

export const absoluteUrl = (path: string) => (path.startsWith("http") ? path : `${API_URL}${path}`);

/** Mirrors the server's limits so users get instant feedback; the server still enforces them. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = 4000;
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
];
