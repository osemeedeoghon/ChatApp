import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { Banner, Button, EmptyState, IconButton, TextField } from "@/components/ui";
import { useIsWide } from "@/hooks/use-layout";
import { api, errorMessage } from "@/lib/api";
import { useChatStore } from "@/lib/chat-context";
import { formatLastSeen } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { User } from "@/lib/types";

export default function NewConversationScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWide = useIsWide();
  const store = useChatStore();

  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState<User[]>([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        api
          .users(query.trim() || undefined)
          .then(found => !cancelled && (setUsers(found), setLoadError(null)))
          .catch(err => !cancelled && setLoadError(errorMessage(err)));
      },
      query ? 250 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, reloadKey]);

  const goTo = (conversationId: number) =>
    router.replace({ pathname: "/chat/[id]", params: { id: String(conversationId) } });

  const close = () => (router.canGoBack() ? router.back() : router.replace("/conversations"));

  const startDirect = async (user: User) => {
    setBusy(true);
    setError(null);
    try {
      goTo((await store.startDirect(user.id)).id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const createGroup = async () => {
    setBusy(true);
    setError(null);
    try {
      goTo((await store.createGroup(groupName.trim(), selected.map(u => u.id))).id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const toggle = (user: User) =>
    setSelected(current => (current.some(u => u.id === user.id) ? current.filter(u => u.id !== user.id) : [...current, user]));

  const groupReady = selected.length >= 2 && groupName.trim().length > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, paddingTop: (isWide ? 0 : insets.top) + space.sm }]}>
      <View style={styles.header}>
        <IconButton icon={isWide ? "close" : "chevron-back"} label="Close" size={24} onPress={close} />
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {groupMode ? "New group" : "New chat"}
        </Text>
        {groupMode && (
          <Button title="Create" loading={busy} disabled={!groupReady} onPress={createGroup} style={styles.createButton} />
        )}
      </View>

      <View style={styles.controls}>
        {groupMode && (
          <>
            <TextField
              label="Group name"
              value={groupName}
              onChangeText={setGroupName}
              placeholder="e.g. Weekend plans"
              maxLength={80}
              hint={selected.length < 2 ? "Pick at least two people." : `${selected.length} people selected`}
            />
            {selected.length > 0 && (
              <View style={styles.chips}>
                {selected.map(user => (
                  <Pressable
                    key={user.id}
                    onPress={() => toggle(user)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${user.displayName}`}
                    style={[styles.chip, { backgroundColor: colors.primarySoft }]}
                  >
                    <Text style={{ color: colors.primary, fontWeight: "600" }}>{user.displayName}</Text>
                    <Ionicons name="close" size={14} color={colors.primary} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or email"
          icon="search"
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={{ marginBottom: space.sm }}
          accessibilityLabel="Search people"
        />
        {error && <Banner tone="error" message={error} />}
      </View>

      {!groupMode && (
        <Pressable
          onPress={() => setGroupMode(true)}
          accessibilityRole="button"
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.row,
            (pressed || hovered) && { backgroundColor: colors.surfaceHover },
          ]}
        >
          <View style={[styles.groupIcon, { backgroundColor: colors.primary }]}>
            <Ionicons name="people" size={22} color={colors.onPrimary} />
          </View>
          <Text style={[styles.name, { color: colors.primary }]}>New group</Text>
        </Pressable>
      )}

      {loadError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load people"
          message={loadError}
          action={<Button title="Try again" icon="refresh" onPress={() => setReloadKey(k => k + 1)} />}
        />
      ) : users === null ? (
        <ActivityIndicator style={{ marginTop: space.xl }} color={colors.primary} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={u => String(u.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + space.lg }}
          ListHeaderComponent={
            users.length ? <Text style={[styles.section, { color: colors.textFaint }]}>People</Text> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="person-add-outline"
              title={query ? "No one found" : "No one else is here yet"}
              message={query ? `No account matches “${query}”.` : "Ask a friend to create an account, then they'll show up here."}
            />
          }
          renderItem={({ item }) => {
            const checked = selected.some(u => u.id === item.id);
            return (
              <Pressable
                disabled={busy}
                onPress={() => (groupMode ? toggle(item) : startDirect(item))}
                accessibilityRole={groupMode ? "checkbox" : "button"}
                accessibilityState={groupMode ? { checked } : undefined}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.row,
                  (pressed || hovered) && { backgroundColor: colors.surfaceHover },
                ]}
              >
                <Avatar name={item.displayName} seed={item.id} online={item.online} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
                    {item.email} · {formatLastSeen(item)}
                  </Text>
                </View>
                {groupMode && (
                  <Ionicons
                    name={checked ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={checked ? colors.primary : colors.textFaint}
                  />
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingBottom: space.sm },
  title: { flex: 1, fontSize: 20, fontWeight: "700" },
  createButton: { minHeight: 36, paddingHorizontal: space.md },
  controls: { paddingHorizontal: space.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: -space.sm, marginBottom: space.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  section: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    marginHorizontal: space.sm,
    borderRadius: radius.md,
  },
  groupIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13, marginTop: 2 },
});
