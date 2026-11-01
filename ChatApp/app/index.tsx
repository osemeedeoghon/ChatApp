import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect } from "expo-router";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Banner, Button, FullScreenLoader, TextField } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { radius, space, useTheme } from "@/lib/theme";

type Mode = "signIn" | "signUp";
type FieldErrors = Partial<Record<"displayName" | "email" | "password", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(mode: Mode, values: { displayName: string; email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (mode === "signUp" && values.displayName.trim().length > 50) errors.displayName = "Keep it under 50 characters";
  if (!values.email.trim()) errors.email = "Enter your email address";
  else if (!EMAIL_RE.test(values.email.trim())) errors.email = "That doesn't look like a valid email";
  if (!values.password) errors.password = "Enter your password";
  else if (mode === "signUp" && values.password.length < 8) errors.password = "Use at least 8 characters";
  return errors;
}

export default function AuthScreen() {
  const { colors } = useTheme();
  const { status, notice, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signIn");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  if (status === "loading") return <FullScreenLoader />;
  if (status === "signedIn") return <Redirect href="/conversations" />;

  const isSignUp = mode === "signUp";

  const submit = async () => {
    const values = { displayName, email, password };
    const nextErrors = validate(mode, values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      if (isSignUp) await signUp(email.trim(), password, displayName.trim());
      else await signIn(email.trim(), password);
    } catch (err) {
      // Attach server validation messages to the most relevant field.
      const message = errorMessage(err);
      if (err instanceof ApiError && err.status === 409) setErrors({ email: message });
      else if (err instanceof ApiError && err.status === 400 && /password/i.test(message)) setErrors({ password: message });
      else if (err instanceof ApiError && err.status === 400 && /email/i.test(message)) setErrors({ email: message });
      else setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode(isSignUp ? "signIn" : "signUp");
    setErrors({});
    setFormError(null);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.brand}>
            <View style={[styles.logo, { backgroundColor: colors.primary }]}>
              <Ionicons name="chatbubbles" size={28} color={colors.onPrimary} />
            </View>
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              {isSignUp ? "Create your account" : "Welcome back"}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              {isSignUp ? "Start chatting in under a minute." : "Sign in to pick up where you left off."}
            </Text>
          </View>

          {(formError || notice) && (
            <View style={{ marginBottom: space.lg }}>
              <Banner tone="error" message={formError ?? notice!} />
            </View>
          )}

          {isSignUp && (
            <TextField
              label="Display name"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="How others will see you"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              error={errors.displayName}
              hint="Optional. Defaults to the first part of your email."
              maxLength={50}
            />
          )}
          <TextField
            ref={emailRef}
            label="Email"
            value={email}
            onChangeText={value => {
              setEmail(value);
              if (errors.email) setErrors(e => ({ ...e, email: undefined }));
            }}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            error={errors.email}
          />
          <TextField
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={value => {
              setPassword(value);
              if (errors.password) setErrors(e => ({ ...e, password: undefined }));
            }}
            placeholder={isSignUp ? "At least 8 characters" : "Your password"}
            secureToggle
            autoCapitalize="none"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            textContentType={isSignUp ? "newPassword" : "password"}
            returnKeyType="go"
            onSubmitEditing={submit}
            error={errors.password}
          />

          <Button title={isSignUp ? "Create account" : "Sign in"} loading={submitting} onPress={submit} style={{ marginTop: space.sm }} />

          <View style={styles.switchRow}>
            <Text style={{ color: colors.textMuted }}>{isSignUp ? "Already have an account?" : "New here?"}</Text>
            <Pressable onPress={switchMode} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.switchLink, { color: colors.primary }]}>{isSignUp ? "Sign in" : "Create an account"}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: space.lg },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.lg + 6,
    borderWidth: 1,
    padding: space.xl,
  },
  brand: { alignItems: "center", marginBottom: space.xl },
  logo: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: space.lg },
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5, textAlign: "center" },
  subtitle: { fontSize: 15, marginTop: 6, textAlign: "center" },
  switchRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: space.xl, flexWrap: "wrap" },
  switchLink: { fontWeight: "700" },
});
