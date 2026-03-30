/**
 * RTSP Frame Capture via persistent ffmpeg processes
 *
 * Instead of spawning a new ffmpeg per frame (slow due to RTSP handshake),
 * we keep one long-running ffmpeg per camera that outputs a continuous
 * stream of JPEG frames at ~2 fps.  The latest complete frame is always
 * available in memory for instant retrieval.
 *
 * Requirements: ffmpeg must be installed on the host (`apt install ffmpeg`).
 */

import { spawn, type ChildProcess } from 'node:child_process';

const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

/**
 * Kill ffmpeg and restart if no new frame arrives within this window.
 * With `-stimeout 10000000` (10 s) in the ffmpeg args, ffmpeg will usually
 * exit on its own when the RTSP source goes silent.  This watchdog is a
 * belt-and-suspenders fallback for cases where ffmpeg stays alive but
 * simply stops producing output (e.g. codec hang, pipe stall).
 */
const STALE_KILL_MS = 20_000;

interface PersistentCapture {
  process: ChildProcess;
  latestFrame: Buffer | null;
  accum: Buffer;
  lastFrameAt: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  staleWatchdog: ReturnType<typeof setInterval> | null;
  url: string;
}

const captures = new Map<string, PersistentCapture>();

/**
 * Persist the last received frame even after the ffmpeg process exits.
 * This lets the snapshot endpoint serve a (slightly stale) image during
 * the restart window so the UI never flashes "Stream unavailable".
 */
const lastKnownFrames = new Map<string, { frame: Buffer; at: number }>();

function startPersistentCapture(rtspUrl: string): PersistentCapture {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-rtsp_transport', 'tcp',
    '-stimeout', '10000000',   // 10 s socket timeout: exit cleanly if RTSP stalls
    '-i', rtspUrl,
    '-r', '2',                    // 2 fps output
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', '5',                  // moderate quality, smaller frames
    'pipe:1',
  ];

  const child = spawn('ffmpeg', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const cap: PersistentCapture = {
    process: child,
    latestFrame: null,
    accum: Buffer.alloc(0),
    lastFrameAt: 0,
    restartTimer: null,
    staleWatchdog: null,
    url: rtspUrl,
  };

  child.stdout!.on('data', (chunk: Buffer) => {
    cap.accum = Buffer.concat([cap.accum, chunk]);

    // Extract complete JPEG frames from the accumulated buffer
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const soiIdx = cap.accum.indexOf(JPEG_SOI);
      if (soiIdx < 0) { cap.accum = Buffer.alloc(0); break; }

      const eoiIdx = cap.accum.indexOf(JPEG_EOI, soiIdx + 2);
      if (eoiIdx < 0) {
        // Incomplete frame -- trim anything before SOI and wait for more data
        if (soiIdx > 0) cap.accum = cap.accum.subarray(soiIdx);
        break;
      }

      const frame = cap.accum.subarray(soiIdx, eoiIdx + 2);
      cap.latestFrame = Buffer.from(frame);
      cap.lastFrameAt = Date.now();
      // New frame received — remove the stale fallback for this URL
      lastKnownFrames.delete(rtspUrl);
      cap.accum = cap.accum.subarray(eoiIdx + 2);
    }

    // Prevent unbounded accumulation
    if (cap.accum.length > 5 * 1024 * 1024) {
      cap.accum = Buffer.alloc(0);
    }
  });

  child.stderr!.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.warn(`[rtspCapture] ffmpeg stderr (${rtspUrl}): ${msg}`);
  });

  child.on('exit', (code) => {
    // Persist the last frame before the capture is removed so callers can
    // continue serving it during the restart window.
    if (cap.latestFrame) {
      lastKnownFrames.set(rtspUrl, { frame: cap.latestFrame, at: cap.lastFrameAt });
    }
    if (cap.staleWatchdog) { clearInterval(cap.staleWatchdog); cap.staleWatchdog = null; }
    console.warn(`[rtspCapture] ffmpeg exited (code=${code}) for ${rtspUrl}, restarting in 3s`);
    cap.restartTimer = setTimeout(() => {
      captures.delete(rtspUrl);
      ensureCapture(rtspUrl);
    }, 3_000);
  });

  // Stale watchdog: kill ffmpeg if it stops producing frames.
  // The exit handler above will restart it automatically.
  cap.staleWatchdog = setInterval(() => {
    if (cap.latestFrame && Date.now() - cap.lastFrameAt > STALE_KILL_MS) {
      console.warn(`[rtspCapture] No frame for ${STALE_KILL_MS / 1000}s on ${rtspUrl} — killing stale ffmpeg`);
      cap.process.kill('SIGTERM');
      // exit handler fires → 3s delay → restart
    }
  }, 5_000);

  return cap;
}

function ensureCapture(rtspUrl: string): PersistentCapture {
  let cap = captures.get(rtspUrl);
  if (cap) return cap;
  cap = startPersistentCapture(rtspUrl);
  captures.set(rtspUrl, cap);
  return cap;
}

/**
 * Get the latest captured JPEG frame for an RTSP URL.
 * On first call for a given URL, starts a persistent ffmpeg process.
 * Returns null if no frame has been captured yet.
 */
export function captureFrameFromRTSP(rtspUrl: string): Promise<Buffer | null> {
  const cap = ensureCapture(rtspUrl);
  return Promise.resolve(cap.latestFrame);
}

/**
 * Get the latest frame synchronously (for the snapshot endpoint).
 * Returns null if no frame has arrived yet or the last frame is older than maxAgeMs.
 */
export function getLatestFrame(rtspUrl: string, maxAgeMs = Number.POSITIVE_INFINITY): Buffer | null {
  const cap = captures.get(rtspUrl);
  if (!cap?.latestFrame) return null;
  if (Date.now() - cap.lastFrameAt > maxAgeMs) return null;
  return cap.latestFrame;
}

/**
 * Return the last frame received before the ffmpeg process last exited.
 * Used as a fallback during the restart/reconnect window so the UI can
 * keep showing a (slightly stale) image instead of going blank.
 * Returns null if we have never received a frame for this URL.
 */
export function getLastKnownFrame(rtspUrl: string): Buffer | null {
  return lastKnownFrames.get(rtspUrl)?.frame ?? null;
}

/**
 * Status of the capture process for a given URL.
 *   'connecting'  – ffmpeg is running but no frame has arrived yet
 *   'live'        – a recent frame is available
 *   'stale'       – ffmpeg is running but the last frame is older than maxAgeMs
 *   'stopped'     – no ffmpeg process at all
 */
export function getCaptureStatus(rtspUrl: string, maxAgeMs: number): 'connecting' | 'live' | 'stale' | 'stopped' {
  const cap = captures.get(rtspUrl);
  if (!cap) return 'stopped';
  if (!cap.latestFrame || cap.lastFrameAt === 0) return 'connecting';
  if (Date.now() - cap.lastFrameAt > maxAgeMs) return 'stale';
  return 'live';
}

/**
 * Stop all persistent captures and wait for the ffmpeg processes to exit.
 * Uses SIGKILL so children die immediately rather than waiting for a graceful
 * shutdown — this prevents orphaned ffmpeg processes from blocking systemd.
 */
export async function stopAllCaptures(): Promise<void> {
  const exits: Promise<void>[] = [];
  for (const [url, cap] of captures) {
    if (cap.restartTimer) { clearTimeout(cap.restartTimer); cap.restartTimer = null; }
    if (cap.staleWatchdog) { clearInterval(cap.staleWatchdog); cap.staleWatchdog = null; }
    if (!cap.process.killed) {
      exits.push(new Promise<void>((resolve) => {
        cap.process.once('exit', () => resolve());
        // Safety timeout: if the process doesn't exit within 2 s, resolve anyway.
        setTimeout(resolve, 2_000);
      }));
      cap.process.kill('SIGKILL');
    }
    captures.delete(url);
  }
  lastKnownFrames.clear();
  await Promise.all(exits);
}
