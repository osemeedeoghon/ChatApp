import { useEffect, useState, useRef } from "react";
import {
  View, Text, FlatList, TextInput,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getMessages, sendMessage } from "../../services/api";

export default function ChatScreen() {
  const { id, email } = useLocalSearchParams();
  const router = useRouter();
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  const displayName = email
    ? (email as string).split("@")[0]
    : "Chat";

  const formatTime = (createdAt: string) => {
    const date = new Date(createdAt);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  useEffect(() => {
    const load = async () => {
      const token = await AsyncStorage.getItem("token");
      if (token) {
        const payload = JSON.parse(atob(token.split(".")[1]));
        setMyId(payload.id);
      }
      const data = await getMessages(id as string);
      setMessages(Array.isArray(data) ? data : []);
      setLoading(false);
    };
    load();

    const interval = setInterval(async () => {
      const data = await getMessages(id as string);
      setMessages(Array.isArray(data) ? data : []);
    }, 2000);

    return () => clearInterval(interval);
  }, [id]);

  const handleSend = async () => {
    if (!text.trim()) return;
    const msg = await sendMessage(id as string, text.trim());
    setMessages(prev => [...prev, msg]);
    setText("");
    flatListRef.current?.scrollToEnd({ animated: true });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <View style={styles.headerAvatar}>
            <Text style={styles.headerAvatarText}>
              {displayName[0].toUpperCase()}
            </Text>
          </View>
          <Text style={styles.headerTitle}>{displayName}</Text>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const isMine = item.senderId === myId;
          return (
            <View style={[styles.bubbleRow, isMine ? styles.myRow : styles.theirRow]}>
              <View style={styles.bubbleWrapper}>
                <View style={[styles.bubble, isMine ? styles.myBubble : styles.theirBubble]}>
                  <Text style={[styles.bubbleText, isMine ? styles.myText : styles.theirText]}>
                    {item.text}
                  </Text>
                </View>
                <Text style={[styles.timestamp, isMine ? styles.myTimestamp : styles.theirTimestamp]}>
                  {formatTime(item.createdAt)}
                </Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No messages yet. Say hi! 👋</Text>
          </View>
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Type a message..."
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim()}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row", alignItems: "center",
    padding: 16, paddingTop: 60, backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#eee", gap: 12,
  },
  back: { fontSize: 16, color: "#007AFF" },
  headerInfo: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#007AFF", justifyContent: "center", alignItems: "center",
  },
  headerAvatarText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  headerTitle: { fontSize: 18, fontWeight: "bold" },
  messagesList: { padding: 16, flexGrow: 1 },
  bubbleRow: { marginBottom: 8, flexDirection: "row" },
  myRow: { justifyContent: "flex-end" },
  theirRow: { justifyContent: "flex-start" },
  bubbleWrapper: { maxWidth: "75%" },
  bubble: { padding: 12, borderRadius: 18 },
  myBubble: { backgroundColor: "#007AFF", borderBottomRightRadius: 4 },
  theirBubble: { backgroundColor: "#fff", borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 16 },
  myText: { color: "#fff" },
  theirText: { color: "#000" },
  timestamp: { fontSize: 11, marginTop: 3, color: "#999" },
  myTimestamp: { textAlign: "right" },
  theirTimestamp: { textAlign: "left" },
  emptyText: { color: "#999", fontSize: 16 },
  inputRow: {
    flexDirection: "row", padding: 12, backgroundColor: "#fff",
    borderTopWidth: 1, borderTopColor: "#eee", alignItems: "flex-end", gap: 8,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 16,
    maxHeight: 100, backgroundColor: "#f9f9f9",
  },
  sendBtn: {
    backgroundColor: "#007AFF", paddingHorizontal: 20,
    paddingVertical: 10, borderRadius: 20,
  },
  sendBtnDisabled: { backgroundColor: "#b0d0ff" },
  sendBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});