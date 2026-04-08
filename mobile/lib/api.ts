import * as SecureStore from "expo-secure-store";
import { CMP_API_URL } from "@/constants/Config";

const TOKEN_KEY = "cmp_access_token";
const AUTOLOGIN_EMAIL_KEY = "cmp_autologin_email";
const AUTOLOGIN_PASSWORD_KEY = "cmp_autologin_password";

export async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setStoredToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearStoredToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getStoredCredentials(): Promise<{ email: string; password: string } | null> {
  try {
    const [email, password] = await Promise.all([
      SecureStore.getItemAsync(AUTOLOGIN_EMAIL_KEY),
      SecureStore.getItemAsync(AUTOLOGIN_PASSWORD_KEY),
    ]);
    if (!email || !password) return null;
    return { email, password };
  } catch {
    return null;
  }
}

export async function setStoredCredentials(email: string, password: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(AUTOLOGIN_EMAIL_KEY, email),
    SecureStore.setItemAsync(AUTOLOGIN_PASSWORD_KEY, password),
  ]);
}

export async function clearStoredCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(AUTOLOGIN_EMAIL_KEY),
    SecureStore.deleteItemAsync(AUTOLOGIN_PASSWORD_KEY),
  ]);
}

export type ApiError = { message: string; status: number };

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  const token = options.token !== undefined ? options.token : await getStoredToken();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${CMP_API_URL}${path}`, { ...options, headers });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
  }

  if (!res.ok) {
    const msg =
      typeof json === "object" && json && "message" in json
        ? String((json as { message: unknown }).message)
        : res.statusText;
    return { ok: false, error: { message: msg, status: res.status } };
  }

  return { ok: true, data: json as T };
}
