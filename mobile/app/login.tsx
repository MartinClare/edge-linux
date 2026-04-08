import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

export default function LoginScreen() {
  const { login, ready, user } = useAuth();
  const router = useRouter();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    const res = await login(email.trim(), password);
    setLoading(false);
    if (res.ok) router.replace('/(tabs)');
    else setError(res.message);
  }

  const c = dark ? colors.dark : colors.light;

  if (ready && user) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: c.bg }]}
    >
      <Text style={[styles.title, { color: c.text }]}>CMP Mobile</Text>
      <Text style={[styles.sub, { color: c.muted }]}>Sign in with your CMP account</Text>
      <TextInput
        style={[styles.input, { borderColor: c.border, backgroundColor: c.inputBg, color: c.text }]}
        placeholder="Email"
        placeholderTextColor={c.placeholder}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
        value={email}
        onChangeText={setEmail}
        editable={!loading}
      />
      <TextInput
        style={[styles.input, { borderColor: c.border, backgroundColor: c.inputBg, color: c.text }]}
        placeholder="Password"
        placeholderTextColor={c.placeholder}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!loading}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={() => void onSubmit()}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign in</Text>
        )}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const colors = {
  light: {
    bg: '#ffffff',
    text: '#18181b',
    muted: '#71717a',
    placeholder: '#a1a1aa',
    border: '#d4d4d8',
    inputBg: '#ffffff',
  },
  dark: {
    bg: '#09090b',
    text: '#fafafa',
    muted: '#a1a1aa',
    placeholder: '#71717a',
    border: '#3f3f46',
    inputBg: '#18181b',
  },
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', maxWidth: 400, alignSelf: 'center', width: '100%' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  sub: { fontSize: 14, marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#f87171', marginBottom: 8, fontSize: 14 },
});
