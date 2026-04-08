# CMP Mobile (Expo)

Native shell for AXON Vision CMP: push alerts (per-user risk threshold), incident list/detail, summary KPIs, and edge device status.

## Configure API URL

- **Dev:** set `expo.extra.cmpApiUrl` in [app.json](./app.json), or export `EXPO_PUBLIC_CMP_API_URL` when starting Metro (must be reachable from the device or emulator, e.g. LAN IP of the machine running CMP, not `localhost` on a physical phone).
- **Production builds:** use EAS secrets or `app.config.js` to inject the CMP base URL (no trailing slash).

## CMP server

1. Apply Prisma migrations (includes `push_devices`, `user_alert_preferences`, `mobile_push_logs`).
2. Set **`EXPO_ACCESS_TOKEN`** on the CMP host ([Expo access token](https://expo.dev/accounts/[account]/settings/access-tokens) with push permissions).
3. Optional: **`MOBILE_PUSH_ENABLED=false`** to turn off incident push fan-out.

## Push notifications

- After login, the app registers an Expo push token with `POST /api/mobile/devices`.
- **Minimum risk**, **project filter**, and **critical types only** are stored in `UserAlertPreference` and are **editable only by CMP administrators** (CMP Settings → Mobile app, or an admin signed into the mobile app). Other users see their current settings as read-only and can still register the device for push.
- **Test:** Settings → “Send test notification” (requires `EXPO_ACCESS_TOKEN`).

For production push, create an EAS project and set **`extra.eas.projectId`** in `app.json` (or run `eas init`).

## Internal distribution (EAS)

- **Android APK:** `eas build --profile preview --platform android`
- **iOS:** same profile uses internal distribution (Ad Hoc / enterprise / TestFlight per your Apple setup). See [EAS Build](https://docs.expo.dev/build/introduction/).

## Scripts

```bash
npm install
npm start              # Expo dev server
```

Admin-only **Mobile app** tab in CMP Settings lists users, device counts, and **Clear push tokens** per user.
