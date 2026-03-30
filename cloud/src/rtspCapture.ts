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

interface PersistentCapture {
  process: ChildProcess;
  latestFrame: Buffer | null;
  accum: Buffer;
  lastFrameAt: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  url: string;
}

const captures = new Map<string, PersistentCapture>();

function startPersistentCapture(rtspUrl: string): PersistentCapture {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-rtsp_transport', 'tcp',
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
    console.warn(`[rtspCapture] ffmpeg exited (code=${code}) for ${rtspUrl}, restarting in 3s`);
    cap.restartTimer = setTimeout(() => {
      captures.delete(rtspUrl);
      ensureCapture(rtspUrl);
    }, 3_000);
  });

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
 */
export function getLatestFrame(rtspUrl: string): Buffer | null {
  return captures.get(rtspUrl)?.latestFrame ?? null;
}

/**
 * Stop all persistent captures (for graceful shutdown).
 */
export function stopAllCaptures(): void {
  for (const [url, cap] of captures) {
    if (cap.restartTimer) clearTimeout(cap.restartTimer);
    cap.process.kill('SIGTERM');
    captures.delete(url);
  }
}
