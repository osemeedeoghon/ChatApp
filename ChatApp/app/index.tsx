import { useState } from "react";
import { View, TextInput, Button, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { register, login } from "../services/api";

export default function HomeScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleRegister = async () => {
    try {
      const res = await register(email, password);
      setMessage(JSON.stringify(res));
    } catch (err: any) {
      setMessage(err.message);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await login(email, password);
      if (res.token) {
        router.replace("/conversations");
      } else {
        setMessage(JSON.stringify(res));
      }
    } catch (err: any) {
      setMessage(err.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ChatApp</Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        secureTextEntry
        onChangeText={setPassword}
        style={styles.input}
      />

      <Button title="Register" onPress={handleRegister} />
      <View style={{ height: 10 }} />
      <Button title="Login" onPress={handleLogin} />

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "bold", marginBottom: 32, textAlign: "center" },
  label: { marginBottom: 4, fontWeight: "500" },
  input: {
    borderWidth: 1, borderColor: "#ccc", borderRadius: 8,
    padding: 10, marginBottom: 16,
  },
  message: { marginTop: 16, color: "gray", textAlign: "center" },
});