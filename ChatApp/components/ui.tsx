import Ionicons from "@expo/vector-icons/Ionicons";
import { forwardRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type ViewStyle,
} from "react-native";
import { radius, space, useTheme } from "@/lib/theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

// ─── Buttons ───────────────────────────────────────────

type ButtonProps = Omit<PressableProps, "style"> & {
  title: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconName;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ title, variant = "primary", icon, loading, disabled, style, ...rest }: ButtonProps) {
  const { colors } = useTheme();
  const palette = {
    primary: { bg: colors.primary, pressed: colors.primaryPressed, fg: colors.onPrimary, border: colors.primary },
    secondary: { bg: colors.surface, pressed: colors.surfaceHover, fg: colors.text, border: colors.border },
    ghost: { bg: "transparent", pressed: colors.surfaceHover, fg: colors.primary, border: "transparent" },
    danger: { bg: colors.dangerSoft, pressed: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft },
  }[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border },
        inactive && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={palette.fg} />}
          <Text style={[styles.buttonText, { color: palette.fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

type IconButtonProps = Omit<PressableProps, "style"> & {
  icon: IconName;
  label: string;
  size?: number;
  color?: string;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({ icon, label, size = 22, color, filled, disabled, style, ...rest }: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // Tooltip on web.
      {...(Platform.OS === "web" ? { title: label } : null)}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.iconButton,
        filled && { backgroundColor: colors.primary },
        !filled && (pressed || hovered) && { backgroundColor: colors.surfaceHover },
        filled && pressed && { backgroundColor: colors.primaryPressed },
        disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      <Ionicons name={icon} size={size} color={color ?? (filled ? colors.onPrimary : colors.textMuted)} />
    </Pressable>
  );
}

// ─── Inputs ────────────────────────────────────────────

type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
  icon?: IconName;
  secureToggle?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, icon, secureToggle, secureTextEntry, containerStyle, style, onFocus, onBlur, ...rest },
  ref
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View style={[styles.field, containerStyle]}>
      {label && <Text style={[styles.label, { color: colors.text }]}>{label}</Text>}
      <View style={[styles.inputWrap, { borderColor, backgroundColor: colors.surface }]}>
        {icon && <Ionicons name={icon} size={18} color={colors.textFaint} style={styles.inputIcon} />}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          style={[styles.input, { color: colors.text }, webNoOutline, style]}
          onFocus={e => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={e => {
            setFocused(false);
            onBlur?.(e);
          }}
          aria-invalid={!!error}
          {...rest}
        />
        {secureToggle && (
          <IconButton
            icon={hidden ? "eye-outline" : "eye-off-outline"}
            label={hidden ? "Show password" : "Hide password"}
            size={18}
            onPress={() => setHidden(h => !h)}
          />
        )}
      </View>
      {error ? (
        <Text style={[styles.helper, { color: colors.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.helper, { color: colors.textFaint }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

/** Removes the browser focus ring; the field border shows focus instead. */
export const webNoOutline = Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null;

// ─── Feedback ──────────────────────────────────────────

export function FullScreenLoader() {
  const { colors } = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function EmptyState({
  icon, title, message, action,
}: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      {message && <Text style={[styles.emptyMessage, { color: colors.textMuted }]}>{message}</Text>}
      {action && <View style={{ marginTop: space.lg }}>{action}</View>}
    </View>
  );
}

export function Banner({
  tone, message, icon, action,
}: { tone: "error" | "warning" | "success"; message: string; icon?: IconName; action?: ReactNode }) {
  const { colors } = useTheme();
  const palette = {
    error: { bg: colors.dangerSoft, fg: colors.danger, icon: "alert-circle" as IconName },
    warning: { bg: colors.warningSoft, fg: colors.warning, icon: "cloud-offline-outline" as IconName },
    success: { bg: colors.primarySoft, fg: colors.primary, icon: "checkmark-circle" as IconName },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg }]} accessibilityRole="alert">
      <Ionicons name={icon ?? palette.icon} size={18} color={palette.fg} />
      <Text style={[styles.bannerText, { color: palette.fg }]}>{message}</Text>
      {action}
    </View>
  );
}

// ─── Dialogs ───────────────────────────────────────────

export function ConfirmDialog({
  visible, title, message, confirmLabel, destructive, loading, onConfirm, onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={[styles.overlay, { backgroundColor: colors.overlay }]} onPress={onCancel}>
        <Pressable style={[styles.dialog, { backgroundColor: colors.surface }]} onPress={() => {}}>
          <Text style={[styles.dialogTitle, { color: colors.text }]}>{title}</Text>
          {message && <Text style={[styles.dialogMessage, { color: colors.textMuted }]}>{message}</Text>}
          <View style={styles.dialogActions}>
            <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              title={confirmLabel}
              variant={destructive ? "danger" : "primary"}
              loading={loading}
              onPress={onConfirm}
              style={{ flex: 1 }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  field: { marginBottom: space.lg },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 46,
  },
  inputIcon: { marginRight: space.sm },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  helper: { fontSize: 13, marginTop: 6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xxl },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.lg,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  emptyMessage: { fontSize: 15, textAlign: "center", marginTop: 6, maxWidth: 320, lineHeight: 21 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  bannerText: { flex: 1, fontSize: 14, fontWeight: "500" },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  dialog: { width: "100%", maxWidth: 380, borderRadius: radius.lg, padding: space.xl },
  dialogTitle: { fontSize: 18, fontWeight: "700" },
  dialogMessage: { fontSize: 15, marginTop: space.sm, lineHeight: 21 },
  dialogActions: { flexDirection: "row", gap: space.md, marginTop: space.xl },
});
