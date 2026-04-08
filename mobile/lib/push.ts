import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { apiFetch } from "@/lib/api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Push notifications are not supported in Expo Go on Android.
 * They require a standalone/development-client build with FCM configured.
 * On iOS Expo Go they work fine. On a built APK/IPA they work on both platforms.
 */
function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

export async function registerPushTokenWithCmp(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!Device.isDevice) return null;

  if (Platform.OS === "android" && isExpoGo()) {
    console.info(
      "[push] Skipped: Android Expo Go does not support push notifications. " +
        "Build a standalone APK (eas build --profile preview --platform android) to enable push."
    );
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== "granted") return null;

  const projectId =
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ||
    Constants.easConfig?.projectId;

  try {
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const expoToken = tokenResult.data;

    const platform = Platform.OS === "ios" ? "ios" : "android";
    const res = await apiFetch<{ device: { id: string } }>("/api/mobile/devices", {
      method: "POST",
      body: JSON.stringify({ token: expoToken, platform }),
    });
    if (!res.ok) {
      console.warn("[push] Register device failed:", res.error.message);
      return null;
    }
    return expoToken;
  } catch (err) {
    console.info("[push] Could not get push token:", (err as Error)?.message ?? err);
    return null;
  }
}
