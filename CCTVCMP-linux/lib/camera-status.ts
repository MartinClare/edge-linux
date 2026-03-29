/**
 * Camera online-status constants — single source of truth for both the API
 * and the UI.  Keep the ratio ONLINE_THRESHOLD_MS / heartbeat comfortably
 * large (≥ 10×) so a few missed heartbeats don't flip the camera offline.
 *
 * Edge heartbeat interval (python/app/main.py → _heartbeat_loop):
 *   HEARTBEAT_INTERVAL_SECONDS = 30 s
 *
 * Online window (CMP side):
 *   ONLINE_THRESHOLD_MS = 10 min  →  ratio = 20×
 *
 * A camera is shown as ONLINE when:
 *   CMP server receive time (lastReportAt) < ONLINE_THRESHOLD_MS ago
 *
 * NOTE: lastReportAt is set to new Date() (CMP server clock) on every incoming
 * webhook — never to the edge device's own timestamp — so clock drift on the
 * edge box cannot cause false-offline readings.
 */
export const ONLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
