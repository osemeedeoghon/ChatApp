import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="conversations" />
      <Stack.Screen name="chat/[id]" />
    </Stack>
  );
}