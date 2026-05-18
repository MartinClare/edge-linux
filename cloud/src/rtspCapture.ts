/**
 * RTSP Frame Capture via persistent ffmpeg processes
 *
 * Instead of spawning a new ffmpeg per frame (slow due to RTSP handshake),
 * we keep one long-running ffmpeg per camera that outputs a continuous
 * stream of JPEG frames at a low refresh rate (~0.25 fps). The latest complete frame is always
 * available in memory for instant retrieval.
 *
 * Requirements: ffmpeg must be installed on the host (`apt install ffmpeg`).
 */

import { spawn, type ChildProcess } from 'node:child_process';

const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

/**
 * Kill ffmpeg and restart if no new frame arrives within this window.
 * With `-timeout 10000000` (10 s) in the ffmpeg args, ffmpeg will usually
 * exit on its own when the RTSP source goes silent.  This watchdog is a
 * belt-and-suspenders fallback for cases where ffmpeg stays alive but
 * simply stops producing output (e.g. codec hang, pipe stall).
 */
const STALE_KILL_MS = 20_000;
const IDLE_KILL_MS = 45_000;
const CAPTURE_START_SPACING_MS = 1_500;
const SINGLE_FRAME_TIMEOUT_MS = 15_000;

interface PersistentCapture {
  process: ChildProcess;
  latestFrame: Buffer | null;
  accum: Buffer;
  lastFrameAt: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  staleWatchdog: ReturnType<typeof setInterval> | null;
  url: string;
  lastAccessAt: number;
  stopReason: 'idle' | 'shutdown' | null;
}

const captures = new Map<string, PersistentCapture>();
const queuedCaptureStarts = new Set<string>();
const captureStartQueue: string[] = [];
let captureStartTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persist the last received frame even after the ffmpeg process exits.
 * This lets the snapshot endpoint serve a (slightly stale) image during
 * the restart window so the UI never flashes "Stream unavailable".
 */
const lastKnownFrames = new Map<string, { frame: Buffer; at: number }>();

function extractLatestJpeg(buffer: Buffer): Buffer | null {
  const soiIdx = buffer.indexOf(JPEG_SOI);
  if (soiIdx < 0) return null;
  const eoiIdx = buffer.indexOf(JPEG_EOI, soiIdx + 2);
  if (eoiIdx < 0) return null;
  return Buffer.from(buffer.subarray(soiIdx, eoiIdx + 2));
}

function scheduleCaptureStartQueue(delayMs = 0): void {
  if (captureStartTimer) return;
  captureStartTimer = setTimeout(() => {
    captureStartTimer = null;
    processNextCaptureStart();
  }, delayMs);
}

function processNextCaptureStart(): void {
  const rtspUrl = captureStartQueue.shift();
  if (!rtspUrl) return;

  queuedCaptureStarts.delete(rtspUrl);
  if (!captures.has(rtspUrl)) {
    const cap = startPersistentCapture(rtspUrl);
    captures.set(rtspUrl, cap);
  }

  if (captureStartQueue.length > 0) {
    scheduleCaptureStartQueue(CAPTURE_START_SPACING_MS);
  }
}

function requestCaptureStart(rtspUrl: string): PersistentCapture | null {
  const cap = captures.get(rtspUrl);
  if (cap) {
    cap.lastAccessAt = Date.now();
    return cap;
  }

  if (!queuedCaptureStarts.has(rtspUrl)) {
    queuedCaptureStarts.add(rtspUrl);
    captureStartQueue.push(rtspUrl);
    scheduleCaptureStartQueue();
  }

  return null;
}

function startPersistentCapture(rtspUrl: string): PersistentCapture {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-rtsp_transport', 'tcp',
    '-timeout', '10000000',    // 10 s socket timeout: exit cleanly if RTSP stalls
    '-i', rtspUrl,
    '-vf', 'scale=640:-2',        // low-load snapshot resolution
    '-r', '0.25',                 // 0.25 fps (~1 frame / 4s) for low-CPU grid snapshots
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', '8',                  // lower bandwidth/CPU snapshot quality
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
    lastAccessAt: Date.now(),
    stopReason: null,
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
    if (cap.stopReason === 'idle' || cap.stopReason === 'shutdown') {
      captures.delete(rtspUrl);
      return;
    }
    console.warn(`[rtspCapture] ffmpeg exited (code=${code}) for ${rtspUrl}, restarting in 3s`);
    cap.restartTimer = setTimeout(() => {
      captures.delete(rtspUrl);
      requestCaptureStart(rtspUrl);
    }, 3_000);
  });

  // Stale watchdog: kill ffmpeg if it stops producing frames.
  // The exit handler above will restart it automatically.
  cap.staleWatchdog = setInterval(() => {
    if (Date.now() - cap.lastAccessAt > IDLE_KILL_MS) {
      console.warn(`[rtspCapture] No snapshot consumers for ${IDLE_KILL_MS / 1000}s on ${rtspUrl} — stopping ffmpeg`);
      if (cap.latestFrame) {
        lastKnownFrames.set(rtspUrl, { frame: cap.latestFrame, at: cap.lastFrameAt });
      }
      cap.stopReason = 'idle';
      if (!cap.process.killed) cap.process.kill('SIGTERM');
      captures.delete(rtspUrl);
      return;
    }
    if (cap.latestFrame && Date.now() - cap.lastFrameAt > STALE_KILL_MS) {
      console.warn(`[rtspCapture] No frame for ${STALE_KILL_MS / 1000}s on ${rtspUrl} — killing stale ffmpeg`);
      cap.process.kill('SIGTERM');
      // exit handler fires → 3s delay → restart
    }
  }, 5_000);

  return cap;
}

/**
 * Get the latest captured JPEG frame for an RTSP URL.
 * On first call for a given URL, starts a persistent ffmpeg process.
 * Returns null if no frame has been captured yet.
 */
export function captureFrameFromRTSP(rtspUrl: string): Promise<Buffer | null> {
  const cap = requestCaptureStart(rtspUrl);
  return Promise.resolve(cap?.latestFrame ?? null);
}

/**
 * Capture a single low-resolution JPEG frame and exit. This is used by the
 * analysis scheduler so capture stays sequential while vLLM workers can run
 * concurrently on frames that are already captured.
 */
export function captureSingleFrameFromRTSP(rtspUrl: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-timeout', '10000000',
      '-i', rtspUrl,
      '-frames:v', '1',
      '-vf', 'scale=640:-2',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '8',
      'pipe:1',
    ];

    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (frame: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill('SIGKILL');
      resolve(frame);
    };

    const timer = setTimeout(() => finish(null), SINGLE_FRAME_TIMEOUT_MS);

    child.stdout!.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const frame = extractLatestJpeg(Buffer.concat(chunks));
      if (frame) finish(frame);
    });

    child.stderr!.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.warn(`[rtspCapture] single-frame stderr (${rtspUrl}): ${msg}`);
    });

    child.on('exit', () => {
      const frame = extractLatestJpeg(Buffer.concat(chunks));
      finish(frame);
    });
  });
}

/**
 * Get the latest frame synchronously (for the snapshot endpoint).
 * Returns null if no frame has arrived yet or the last frame is older than maxAgeMs.
 */
export function getLatestFrame(rtspUrl: string, maxAgeMs = Number.POSITIVE_INFINITY): Buffer | null {
  const cap = captures.get(rtspUrl);
  if (!cap?.latestFrame) return null;
  cap.lastAccessAt = Date.now();
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
  if (!cap && queuedCaptureStarts.has(rtspUrl)) return 'connecting';
  if (!cap) return 'stopped';
  cap.lastAccessAt = Date.now();
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
  if (captureStartTimer) {
    clearTimeout(captureStartTimer);
    captureStartTimer = null;
  }
  captureStartQueue.splice(0, captureStartQueue.length);
  queuedCaptureStarts.clear();
  for (const [url, cap] of captures) {
    if (cap.restartTimer) { clearTimeout(cap.restartTimer); cap.restartTimer = null; }
    if (cap.staleWatchdog) { clearInterval(cap.staleWatchdog); cap.staleWatchdog = null; }
    if (!cap.process.killed) {
      exits.push(new Promise<void>((resolve) => {
        cap.process.once('exit', () => resolve());
        // Safety timeout: if the process doesn't exit within 2 s, resolve anyway.
        setTimeout(resolve, 2_000);
      }));
      cap.stopReason = 'shutdown';
      cap.process.kill('SIGKILL');
    }
    captures.delete(url);
  }
  lastKnownFrames.clear();
  await Promise.all(exits);
}
