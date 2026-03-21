import { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Modal, StyleSheet, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getConversations, getUsers, createConversation } from "../services/api";

export default function Conversations() {
  const router = useRouter();
  const [conversations, setConversations] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchConversations = async () => {
    try {
      const data = await getConversations();
      setConversations(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to load conversations", error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();

    // Poll every 2 seconds for updated last messages
    const interval = setInterval(() => {
      fetchConversations();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const openNewChat = async () => {
    try {
      const data = await getUsers();
      setUsers(Array.isArray(data) ? data : []);
      setShowModal(true);
    } catch (error) {
      console.error("Failed to load users", error);
      setUsers([]);
      setShowModal(false);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem("token");
    router.replace("/");
  };

  const startConversation = async (userId: string, userEmail: string) => {
    try {
      const convo = await createConversation(userId);
      setShowModal(false);
      router.push({
        pathname: "/chat/[id]",
        params: { id: convo.id, email: userEmail },
      });
    } catch (error) {
      console.error("Failed to start conversation", error);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={openNewChat} style={styles.newBtn}>
            <Text style={styles.newBtnText}>+ New</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutBtnText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Conversation List */}
      {conversations.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No conversations yet.</Text>
          <Text style={styles.emptySub}>Tap "+ New" to start one!</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.convoItem}
              onPress={() => router.push({
                pathname: "/chat/[id]",
                params: { id: item.id, email: item.otherUser?.email },
              })}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.otherUser?.email?.[0]?.toUpperCase()}
                </Text>
              </View>
              <View style={styles.convoInfo}>
                <Text style={styles.convoEmail}>{item.otherUser?.email}</Text>
                <Text style={styles.lastMessage}>
                  {item.lastMessage ? item.lastMessage.text : "No messages yet"}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* New Chat Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Start a conversation</Text>

            {users.length === 0 ? (
              <Text style={styles.empty}>No other users found. Register another account first.</Text>
            ) : (
              <FlatList
                data={users}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.userItem}
                    onPress={() => startConversation(item.id, item.email)}
                  >
                    <Text style={styles.userEmail}>{item.email}</Text>
                  </TouchableOpacity>
                )}
              />
            )}

            <TouchableOpacity onPress={() => setShowModal(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  header: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", padding: 20, paddingTop: 60,
    borderBottomWidth: 1, borderBottomColor: "#eee",
  },
  title: { fontSize: 24, fontWeight: "bold" },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  newBtn: {
    backgroundColor: "#007AFF", paddingHorizontal: 16,
    paddingVertical: 8, borderRadius: 20,
  },
  newBtnText: { color: "#fff", fontWeight: "600" },
  logoutBtn: {
    borderWidth: 1, borderColor: "#FF3B30",
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  logoutBtnText: { color: "#FF3B30", fontWeight: "600" },
  empty: { fontSize: 16, color: "#999", marginBottom: 4, textAlign: "center" },
  emptySub: { fontSize: 14, color: "#bbb" },
  convoItem: {
    flexDirection: "row", alignItems: "center",
    padding: 16, borderBottomWidth: 1, borderBottomColor: "#f0f0f0",
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "#007AFF", justifyContent: "center",
    alignItems: "center", marginRight: 12,
  },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  convoInfo: { flex: 1 },
  convoEmail: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  lastMessage: { fontSize: 14, color: "#999" },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#fff", borderTopLeftRadius: 20,
    borderTopRightRadius: 20, padding: 24, maxHeight: "60%",
  },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 16 },
  userItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  userEmail: { fontSize: 16 },
  cancelBtn: { marginTop: 16, alignItems: "center", padding: 12 },
  cancelText: { color: "#FF3B30", fontSize: 16, fontWeight: "600" },
});