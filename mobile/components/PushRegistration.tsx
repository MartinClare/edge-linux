import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { registerPushTokenWithCmp } from "@/lib/push";

/**
 * Registers Expo push token with CMP when user is signed in (native only).
 * Note: Remote push notifications require a development build or standalone app.
 * They do NOT work in Expo Go (SDK 53+) or the Android emulator without EAS Build.
 */
export function PushRegistration() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const registeredForUser = useRef<string | null>(null);
  const [pushAvailable, setPushAvailable] = useState<boolean | null>(null);

  // Check if push notifications are available in this environment
  useEffect(() => {
    if (Platform.OS === "web") {
      setPushAvailable(false);
      return;
    }
    // Try to check if notifications are available (fails in Expo Go SDK 53+)
    try {
      // Just checking if we can access the module without error
      const _ = Notifications.addNotificationResponseReceivedListener;
      setPushAvailable(true);
    } catch {
      setPushAvailable(false);
      console.info("[PushRegistration] Push notifications not available in this environment (Expo Go or emulator)");
    }
  }, []);

  useEffect(() => {
    if (!ready || !user || Platform.OS === "web" || pushAvailable === false) return;
    if (registeredForUser.current === user.id) return;
    registeredForUser.current = user.id;
    void registerPushTokenWithCmp();
  }, [ready, user?.id, pushAvailable]);

  useEffect(() => {
    if (pushAvailable === false) return;
    
    let sub: { remove: () => void } | null = null;
    try {
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as { incidentId?: string };
        if (data?.incidentId && typeof data.incidentId === "string") {
          router.push(`/incident/${data.incidentId}`);
        }
      });
    } catch (err) {
      console.info("[PushRegistration] Cannot set up notification listener:", err);
    }
    
    return () => sub?.remove?.();
  }, [router, pushAvailable]);

  return null;
}
