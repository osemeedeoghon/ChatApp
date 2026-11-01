import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, session } from "./api";
import type { AuthResponse, User } from "./types";

const TOKEN_KEY = "token";
const USER_KEY = "user";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  /** Explains why the user was signed out (e.g. an expired session). */
  notice: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  setUser: (user: User) => void;
  /** Stores a fresh token (e.g. after a password change revoked the old one). */
  replaceSession: (response: AuthResponse) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUserState] = useState<User | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setUser = useCallback((next: User) => {
    setUserState(next);
    AsyncStorage.setItem(USER_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const signOut = useCallback(async (reason?: string) => {
    session.setToken(null);
    setUserState(null);
    setNotice(reason ?? null);
    setStatus("signedOut");
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]).catch(() => {});
  }, []);

  const replaceSession = useCallback(
    async ({ token, user: nextUser }: AuthResponse) => {
      session.setToken(token);
      await AsyncStorage.setItem(TOKEN_KEY, token);
      setUser(nextUser);
      setNotice(null);
      setStatus("signedIn");
    },
    [setUser]
  );

  useEffect(() => {
    session.setUnauthorizedHandler(() => {
      signOut("Your session has expired. Please sign in again.");
    });
    return () => session.setUnauthorizedHandler(null);
  }, [signOut]);

  // Restore a saved session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [[, token], [, cachedUser]] = await AsyncStorage.multiGet([TOKEN_KEY, USER_KEY]).catch(
        () => [[TOKEN_KEY, null], [USER_KEY, null]] as [string, string | null][]
      );
      if (!token) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      session.setToken(token);
      try {
        const me = await api.me();
        if (cancelled) return;
        setUser(me);
        setStatus("signedIn");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status !== 0) {
          // The unauthorized handler has already signed us out for a 401.
          if (err.status !== 401) await signOut();
          return;
        }
        // Offline: keep the saved session so the app opens and reconnects later.
        const parsed = cachedUser ? (JSON.parse(cachedUser) as User) : null;
        if (parsed) {
          setUserState(parsed);
          setStatus("signedIn");
        } else {
          setStatus("signedOut");
          setNotice("Can't reach the server. Check your connection and try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setUser, signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      notice,
      signIn: async (email, password) => replaceSession(await api.login(email, password)),
      signUp: async (email, password, displayName) =>
        replaceSession(await api.register(email, password, displayName)),
      signOut,
      setUser,
      replaceSession,
    }),
    [status, user, notice, signOut, setUser, replaceSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
