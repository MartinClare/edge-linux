/**
 * go2rtc Manager
 *
 * go2rtc (https://github.com/AlexxIT/go2rtc) is a tiny, zero-dependency
 * binary that bridges RTSP cameras to WebRTC, allowing browsers to play
 * live video with near-zero latency without any transcoding.
 *
 * This module:
 *  1. Writes a go2rtc.yaml config from the current app.config.json cameras.
 *  2. Spawns go2rtc as a child process managed by the edge-cloud service.
 *  3. Restarts it automatically on exit.
 *  4. Exposes the go2rtc API base URL so the PPE-UI knows where to connect.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const GO2RTC_PORT = 1984;
export const GO2RTC_API_BASE = `http://localhost:${GO2RTC_PORT}`;

// Search for the go2rtc binary in common locations
const BINARY_CANDIDATES = [
  '/usr/local/bin/go2rtc',
  '/usr/bin/go2rtc',
  join(__dirname, '../../go2rtc'),
  join(__dirname, '../../../go2rtc'),
];

const CONFIG_PATH = join(__dirname, '../../go2rtc.yaml');

let go2rtcProcess: ChildProcess | null = null;
let lastStreams: Record<string, string> = {};
let shouldRun = false;

function findBinary(): string | null {
  for (const p of BINARY_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

function writeConfig(streams: Record<string, string>): void {
  const streamLines = Object.entries(streams)
    .map(([name, url]) => `  ${name}: "${url}"`)
    .join('\n');

  const yaml = [
    'api:',
    `  listen: ":${GO2RTC_PORT}"`,
    '  origin: "*"',
    'rtsp:',
    '  listen: ":8555"',      // internal RTSP server (not exposed)
    'webrtc:',
    '  ice_servers:',
    '    - urls: [stun:stun.l.google.com:19302]',
    '    - urls: [stun:stun1.l.google.com:19302]',
    // Force TCP transport for RTSP sources and set reconnect on error
    'ffmpeg:',
    '  bin: ffmpeg',
    streamLines ? `streams:\n${streamLines}` : 'streams: {}',
    '',
  ].join('\n');

  writeFileSync(CONFIG_PATH, yaml, 'utf8');
}

function doStart(binary: string, streams: Record<string, string>): void {
  writeConfig(streams);

  const child = spawn(binary, ['-config', CONFIG_PATH], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  go2rtcProcess = child;

  child.stdout!.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.log(`[go2rtc] ${line}`);
  });

  child.stderr!.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.warn(`[go2rtc] ${line}`);
  });

  child.on('exit', (code) => {
    go2rtcProcess = null;
    if (shouldRun) {
      console.warn(`[go2rtc] Process exited (code=${code}), restarting in 5s`);
      setTimeout(() => {
        if (shouldRun) doStart(binary, lastStreams);
      }, 5_000);
    }
  });

  console.log(`[go2rtc] Started (pid=${child.pid}) with ${Object.keys(streams).length} stream(s) on port ${GO2RTC_PORT}`);
}

/**
 * Start go2rtc with the given camera streams.
 * streams: { cameraId -> rtspUrl }
 */
export function startGo2RTC(streams: Record<string, string>): void {
  const binary = findBinary();
  if (!binary) {
    console.warn(
      '[go2rtc] Binary not found. WebRTC streaming unavailable.\n' +
      '         Install it with:  sudo bash deploy/install_go2rtc.sh',
    );
    return;
  }

  // Kill any stale go2rtc processes left over from a previous (unclean) run.
  // This prevents "address already in use" errors on port 1984.
  // Set lastStreams immediately so warmup's updateGo2RTCStreams() won't spawn a second instance.
  shouldRun = true;
  lastStreams = streams;

  const killed = spawnSync('pkill', ['-f', 'go2rtc'], { timeout: 3_000 });
  if (killed.status === 0) {
    console.log('[go2rtc] Killed stale go2rtc process(es) before starting');
    // Give the OS a moment to release the port before binding
    setTimeout(() => { if (shouldRun) doStart(binary, streams); }, 1_500);
    return;
  }

  doStart(binary, streams);
}

/**
 * Stop go2rtc (called on server shutdown).
 */
export function stopGo2RTC(): void {
  shouldRun = false;
  if (go2rtcProcess) {
    go2rtcProcess.kill('SIGTERM');
    go2rtcProcess = null;
  }
}

/**
 * Update running streams without a full restart by killing and restarting
 * with the new config.  go2rtc restarts in <1 s so this is acceptable.
 */
export function updateGo2RTCStreams(streams: Record<string, string>): void {
  if (JSON.stringify(streams) === JSON.stringify(lastStreams)) return;
  lastStreams = streams;
  const binary = findBinary();
  if (!binary) return;
  if (go2rtcProcess) {
    go2rtcProcess.removeAllListeners('exit');
    go2rtcProcess.kill('SIGTERM');
    go2rtcProcess = null;
  }
  setTimeout(() => doStart(binary, streams), 500);
}

export function isGo2RTCAvailable(): boolean {
  return !!findBinary();
}
