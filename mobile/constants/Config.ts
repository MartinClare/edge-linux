import Constants from "expo-constants";

/** CMP base URL (no trailing slash). Override in app.json `expo.extra.cmpApiUrl` or EXPO_PUBLIC_CMP_API_URL. */
export const CMP_API_URL: string =
  (Constants.expoConfig?.extra?.cmpApiUrl as string | undefined)?.replace(/\/$/, "") ||
  process.env.EXPO_PUBLIC_CMP_API_URL?.replace(/\/$/, "") ||
  "http://localhost:3002";


export function resolveCmpAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const assetUrl = new URL(url);
    const apiUrl = new URL(CMP_API_URL);
    if (assetUrl.hostname === "localhost" || assetUrl.hostname === "127.0.0.1") {
      assetUrl.protocol = apiUrl.protocol;
      assetUrl.hostname = apiUrl.hostname;
      assetUrl.port = apiUrl.port;
    }
    return assetUrl.toString();
  } catch {
    return url.startsWith("/") ? `${CMP_API_URL}${url}` : url;
  }
}
