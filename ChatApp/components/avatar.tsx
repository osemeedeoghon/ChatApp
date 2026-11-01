import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

// Muted, distinct hues that keep white initials readable in both themes.
const HUES = ["#0E7C6B", "#3B6FD1", "#8A4FD3", "#C2416C", "#C46A12", "#2F8A3B", "#5560C9", "#A1527A"];

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

export function Avatar({
  name, seed, size = 44, online, group,
}: { name: string; seed: number; size?: number; online?: boolean; group?: boolean }) {
  const { colors } = useTheme();
  const background = HUES[Math.abs(seed) % HUES.length];
  const dot = Math.max(10, Math.round(size * 0.28));

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no">
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: background }]}>
        {group ? (
          <Ionicons name="people" size={size * 0.48} color="#fff" />
        ) : (
          <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
        )}
      </View>
      {online && (
        <View
          style={[
            styles.dot,
            { width: dot, height: dot, borderRadius: dot / 2, backgroundColor: colors.online, borderColor: colors.surface },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { color: "#fff", fontWeight: "700", letterSpacing: 0.3 },
  dot: { position: "absolute", right: 0, bottom: 0, borderWidth: 2 },
});
