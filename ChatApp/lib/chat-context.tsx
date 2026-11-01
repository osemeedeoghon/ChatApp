import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "./auth";
import { ChatStore, type ChatState } from "./chat-store";
import type { Conversation, User } from "./types";

const ChatContext = createContext<ChatStore | null>(null);

export function ChatProvider({ user, children }: { user: User; children: ReactNode }) {
  const { setUser } = useAuth();
  // One store per signed-in user (the provider is keyed by user id).
  const [store] = useState(() => new ChatStore(user, { onUserUpdated: setUser }));

  useEffect(() => {
    store.connect();
    store.loadConversations();
    return () => store.disconnect();
  }, [store]);

  return <ChatContext.Provider value={store}>{children}</ChatContext.Provider>;
}

export function useChatStore() {
  const store = useContext(ChatContext);
  if (!store) throw new Error("useChatStore must be used inside ChatProvider");
  return store;
}

/** Subscribes to a slice of chat state. Selectors must return stable references. */
export function useChatState<T>(selector: (state: ChatState) => T): T {
  const store = useChatStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}

export function useSortedConversations(): Conversation[] {
  const conversations = useChatState(s => s.conversations);
  return useMemo(
    () =>
      Object.values(conversations).sort((a, b) => {
        const at = a.lastMessage?.createdAt ?? a.updatedAt;
        const bt = b.lastMessage?.createdAt ?? b.updatedAt;
        return bt.localeCompare(at);
      }),
    [conversations]
  );
}

export function useTotalUnread() {
  const conversations = useChatState(s => s.conversations);
  return useMemo(
    () => Object.values(conversations).reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  );
}
