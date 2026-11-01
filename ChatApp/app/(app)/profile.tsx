import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { Banner, Button, ConfirmDialog, IconButton, TextField } from "@/components/ui";
import { useIsWide } from "@/hooks/use-layout";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useChatStore } from "@/lib/chat-context";
import { radius, space, useTheme, type ThemePreference } from "@/lib/theme";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function ProfileScreen() {
  const { colors, preference, setPreference } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWide = useIsWide();
  const { user, signOut, replaceSession } = useAuth();
  const store = useChatStore();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [nameStatus, setNameStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  if (!user) return null;

  const saveName = async () => {
    setSavingName(true);
    setNameStatus(null);
    try {
      store.applyMyProfile(await api.updateProfile(displayName.trim()));
      setNameStatus({ tone: "success", message: "Display name updated." });
    } catch (err) {
      setNameStatus({ tone: "error", message: errorMessage(err) });
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async () => {
    setPasswordStatus(null);
    if (newPassword.length < 8) {
      setPasswordError("Use at least 8 characters");
      return;
    }
    setPasswordError(null);
    setSavingPassword(true);
    try {
      // The server revokes all other sessions and returns a fresh token for this one.
      await replaceSession(await api.changePassword(currentPassword, newPassword));
      setCurrentPassword("");
      setNewPassword("");
      setPasswordStatus({ tone: "success", message: "Password changed. Other devices have been signed out." });
    } catch (err) {
      setPasswordStatus({ tone: "error", message: errorMessage(err) });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: (isWide ? 0 : insets.top) + space.sm, backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <IconButton
          icon={isWide ? "close" : "chevron-back"}
          label="Close"
          size={24}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/conversations"))}
        />
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Profile & settings
        </Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
        <View style={styles.identity}>
          <Avatar name={user.displayName} seed={user.id} size={80} />
          <Text style={[styles.name, { color: colors.text }]}>{user.displayName}</Text>
          <Text style={{ color: colors.textMuted }}>{user.email}</Text>
        </View>

        <Section title="Profile">
          <TextField
            label="Display name"
            value={displayName}
            onChangeText={value => {
              setDisplayName(value);
              setNameStatus(null);
            }}
            maxLength={50}
          />
          {nameStatus && (
            <View style={{ marginBottom: space.md }}>
              <Banner tone={nameStatus.tone} message={nameStatus.message} />
            </View>
          )}
          <Button
            title="Save"
            loading={savingName}
            disabled={!displayName.trim() || displayName.trim() === user.displayName}
            onPress={saveName}
          />
        </Section>

        <Section title="Appearance">
          <View style={[styles.segmented, { backgroundColor: colors.surfaceAlt }]} accessibilityRole="radiogroup">
            {THEME_OPTIONS.map(option => {
              const active = preference === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setPreference(option.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  style={[styles.segment, active && [styles.segmentActive, { backgroundColor: colors.surface }]]}
                >
                  <Text style={{ color: active ? colors.text : colors.textMuted, fontWeight: active ? "700" : "500" }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title="Change password">
          <TextField
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureToggle
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
          />
          <TextField
            label="New password"
            value={newPassword}
            onChangeText={value => {
              setNewPassword(value);
              setPasswordError(null);
            }}
            secureToggle
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            error={passwordError}
            hint="At least 8 characters."
          />
          {passwordStatus && (
            <View style={{ marginBottom: space.md }}>
              <Banner tone={passwordStatus.tone} message={passwordStatus.message} />
            </View>
          )}
          <Button
            title="Update password"
            variant="secondary"
            loading={savingPassword}
            disabled={!currentPassword || !newPassword}
            onPress={savePassword}
          />
        </Section>

        <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={() => setConfirmSignOut(true)} />
      </ScrollView>

      <ConfirmDialog
        visible={confirmSignOut}
        title="Sign out?"
        message="You'll need your email and password to sign back in."
        confirmLabel="Sign out"
        destructive
        onConfirm={() => {
          setConfirmSignOut(false);
          signOut();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  title: { fontSize: 20, fontWeight: "700" },
  content: { padding: space.lg, gap: space.lg, maxWidth: 560, width: "100%", alignSelf: "center" },
  identity: { alignItems: "center", gap: 4, paddingVertical: space.md },
  name: { fontSize: 22, fontWeight: "800", marginTop: space.sm },
  section: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: space.md },
  segmented: { flexDirection: "row", borderRadius: radius.md, padding: 4 },
  segment: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: radius.sm },
  segmentActive: { boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)" },
});
