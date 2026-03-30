/**
 * WebRTCStream
 *
 * Plays a live camera stream via WebRTC using go2rtc as the bridge server.
 * go2rtc connects to the RTSP camera and re-serves it as WebRTC, so the
 * browser receives real video (hardware decoded) with ~100–300 ms latency
 * -- essentially the same experience as VLC.
 *
 * Signalling flow:
 *   1. Browser creates RTCPeerConnection + SDP offer
 *   2. POST offer to go2rtc at /api/webrtc?src=<cameraId>
 *   3. go2rtc returns SDP answer
 *   4. Browser sets remote description, WebRTC tracks arrive
 *   5. Video is rendered in a <video> element (hardware-decoded by browser)
 *
 * Falls back to a refreshing JPEG snapshot if WebRTC fails.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';

export interface WebRTCStreamProps {
  cameraId: string;
  cameraName?: string;
  go2rtcUrl?: string;         // base URL of go2rtc API, default http://localhost:1984
  snapshotFallbackUrl?: string; // URL to poll for JPEG if WebRTC unavailable
  compact?: boolean;
  autoPlay?: boolean;
}

const DEFAULT_GO2RTC = 'http://localhost:1984';
const SNAPSHOT_INTERVAL_MS = 2_000;

type StreamState = 'idle' | 'connecting' | 'playing' | 'snapshot' | 'error';

const FREEZE_CHECK_MS = 3_000;   // check every 3 s
const FREEZE_TIMEOUT_MS = 6_000; // reconnect if currentTime stalls for 6 s
const MAX_RECONNECT_ATTEMPTS = 5;

const WebRTCStream: React.FC<WebRTCStreamProps> = ({
  cameraId,
  cameraName = 'Camera',
  go2rtcUrl = DEFAULT_GO2RTC,
  snapshotFallbackUrl,
  compact = false,
  autoPlay = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotObjectUrlRef = useRef<string | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimeRef = useRef<number>(0);
  const lastAdvanceRef = useRef<number>(Date.now());
  const reconnectCountRef = useRef<number>(0);
  const startWebRTCRef = useRef<() => void>(() => {});

  const [state, setState] = useState<StreamState>('idle');
  const [error, setError] = useState<string>('');
  const [snapshotSrc, setSnapshotSrc] = useState<string>('');
  const [snapshotConnecting, setSnapshotConnecting] = useState<boolean>(false);

  // ── Snapshot fallback ────────────────────────────────────────────
  const clearSnapshotImage = useCallback(() => {
    if (snapshotObjectUrlRef.current) {
      URL.revokeObjectURL(snapshotObjectUrlRef.current);
      snapshotObjectUrlRef.current = null;
    }
    setSnapshotSrc('');
  }, []);

  const startSnapshot = useCallback(() => {
    if (!snapshotFallbackUrl) { setState('error'); return; }
    setState('snapshot');

    const refresh = async () => {
      try {
        const response = await fetch(`${snapshotFallbackUrl}?t=${Date.now()}`, {
          cache: 'no-store',
        });

        if (response.status === 202) {
          // Backend says ffmpeg is starting up — keep polling, show connecting state
          setSnapshotConnecting(true);
          clearSnapshotImage();
          return;
        }

        if (response.status === 204) {
          // Stream is genuinely unavailable
          setSnapshotConnecting(false);
          clearSnapshotImage();
          return;
        }

        if (!response.ok) {
          throw new Error(`snapshot returned HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (blob.size === 0) {
          setSnapshotConnecting(false);
          clearSnapshotImage();
          return;
        }

        setSnapshotConnecting(false);
        if (snapshotObjectUrlRef.current) {
          URL.revokeObjectURL(snapshotObjectUrlRef.current);
        }
        const nextUrl = URL.createObjectURL(blob);
        snapshotObjectUrlRef.current = nextUrl;
        setSnapshotSrc(nextUrl);
      } catch {
        setSnapshotConnecting(false);
        clearSnapshotImage();
      }
    };

    void refresh();
    snapshotTimerRef.current = setInterval(refresh, SNAPSHOT_INTERVAL_MS);
  }, [clearSnapshotImage, snapshotFallbackUrl]);

  const stopSnapshot = useCallback(() => {
    if (snapshotTimerRef.current) {
      clearInterval(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    clearSnapshotImage();
  }, [clearSnapshotImage]);

  // ── Watchdog: detect frozen video and reconnect ──────────────────
  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const startWatchdog = useCallback(() => {
    stopWatchdog();
    lastAdvanceRef.current = Date.now();
    lastTimeRef.current = videoRef.current?.currentTime ?? 0;

    watchdogRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;

      const now = Date.now();
      if (video.currentTime !== lastTimeRef.current) {
        // Video is advancing — reset the stall timer
        lastTimeRef.current = video.currentTime;
        lastAdvanceRef.current = now;
      } else if (now - lastAdvanceRef.current > FREEZE_TIMEOUT_MS) {
        // Video has been frozen for too long — reconnect
        const attempt = reconnectCountRef.current + 1;
        console.warn(`[WebRTC-${cameraId}] Video frozen for ${FREEZE_TIMEOUT_MS}ms, reconnecting (attempt ${attempt})`);
        stopWatchdog();
        if (attempt > MAX_RECONNECT_ATTEMPTS) {
          console.warn(`[WebRTC-${cameraId}] Max reconnects reached, falling back to snapshot`);
          reconnectCountRef.current = 0;
          startSnapshot();
        } else {
          reconnectCountRef.current = attempt;
          // Brief delay before reconnect so go2rtc can recover too
          setTimeout(() => startWebRTCRef.current(), 1_000);
        }
      }
    }, FREEZE_CHECK_MS);
  }, [cameraId, stopWatchdog, startSnapshot]);

  // ── WebRTC connection ────────────────────────────────────────────
  const stopWebRTC = useCallback(() => {
    stopWatchdog();
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stopWatchdog]);

  const startWebRTC = useCallback(async () => {
    setState('connecting');
    setError('');
    stopWebRTC();
    stopSnapshot();

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
    } catch (rtcErr) {
      console.warn(`[WebRTC-${cameraId}] RTCPeerConnection unavailable:`, (rtcErr as Error).message);
      startSnapshot();
      return;
    }
    pcRef.current = pc;

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (e) => {
      if (videoRef.current && e.streams[0]) {
        videoRef.current.srcObject = e.streams[0];
        reconnectCountRef.current = 0;
        setState('playing');
        startWatchdog();
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        console.warn(`[WebRTC-${cameraId}] ICE failed, reconnecting`);
        stopWebRTC();
        setTimeout(() => startWebRTCRef.current(), 1_000);
      } else if (pc.iceConnectionState === 'disconnected') {
        setTimeout(() => {
          if (pcRef.current?.iceConnectionState === 'disconnected') {
            console.warn(`[WebRTC-${cameraId}] ICE still disconnected, reconnecting`);
            stopWebRTC();
            startWebRTCRef.current();
          }
        }, 4_000);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const resp = await fetch(
        `${go2rtcUrl}/api/webrtc?src=${encodeURIComponent(cameraId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: JSON.stringify(offer) }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!resp.ok) throw new Error(`go2rtc returned HTTP ${resp.status}`);

      const answerText = await resp.text();
      const answer: RTCSessionDescriptionInit = JSON.parse(answerText);
      await pc.setRemoteDescription(answer);
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`[WebRTC-${cameraId}] Signalling failed: ${msg} — falling back to snapshot`);
      setError(msg);
      stopWebRTC();
      startSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, go2rtcUrl, startSnapshot, startWatchdog, stopSnapshot, stopWebRTC]);

  // Keep the ref current so watchdog closures always call the latest startWebRTC
  useEffect(() => {
    startWebRTCRef.current = startWebRTC;
  }, [startWebRTC]);

  // ── Auto-play on mount ────────────────────────────────────────────
  useEffect(() => {
    reconnectCountRef.current = 0;
    if (autoPlay) startWebRTC();
    return () => {
      stopWebRTC();
      stopSnapshot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId]);

  // ── Styles ───────────────────────────────────────────────────────
  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    background: '#000',
    borderRadius: compact ? '4px' : '8px',
    overflow: 'hidden',
    border: compact
      ? '1px solid rgba(0, 217, 255, 0.3)'
      : '2px solid #00d9ff',
    aspectRatio: '16/9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: compact ? '4px' : '8px',
    left: compact ? '4px' : '8px',
    background: 'rgba(0,0,0,0.6)',
    color: '#fff',
    fontSize: compact ? '0.65rem' : '0.75rem',
    padding: '2px 6px',
    borderRadius: '3px',
    pointerEvents: 'none',
  };

  const badgeStyle = (color: string): React.CSSProperties => ({
    position: 'absolute',
    top: compact ? '4px' : '8px',
    right: compact ? '4px' : '8px',
    background: color,
    color: '#fff',
    fontSize: '0.65rem',
    padding: '2px 6px',
    borderRadius: '3px',
    pointerEvents: 'none',
    fontWeight: 600,
    letterSpacing: '0.05em',
  });

  return (
    <div style={containerStyle}>
      {/* WebRTC video element */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: state === 'playing' ? 'block' : 'none',
        }}
      />

      {/* Snapshot fallback image */}
      {state === 'snapshot' && snapshotSrc && (
        <img
          src={snapshotSrc}
          alt={`${cameraName} snapshot`}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      )}

      {state === 'snapshot' && !snapshotSrc && (
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: compact ? '0.75rem' : '0.9rem', textAlign: 'center', padding: '1rem' }}>
          {snapshotConnecting ? 'Connecting to camera...' : 'Stream unavailable'}
        </div>
      )}

      {/* Placeholder while connecting */}
      {(state === 'idle' || state === 'connecting') && (
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: compact ? '0.75rem' : '0.9rem', textAlign: 'center', padding: '1rem' }}>
          {state === 'connecting' ? 'Connecting...' : 'Starting stream...'}
        </div>
      )}

      {/* Error with no fallback */}
      {state === 'error' && (
        <div style={{ color: '#ff8a80', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>
          Stream unavailable
          {error && <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', opacity: 0.8 }}>{error}</div>}
        </div>
      )}

      {/* Camera name overlay */}
      {!compact && <div style={overlayStyle}>{cameraName}</div>}

      {/* Mode badge */}
      {state === 'playing' && <div style={badgeStyle('rgba(0,200,100,0.85)')}>LIVE</div>}
      {state === 'snapshot' && <div style={badgeStyle('rgba(200,120,0,0.85)')}>SNAP</div>}
      {state === 'connecting' && <div style={badgeStyle('rgba(100,100,100,0.85)')}>...</div>}

      {/* Manual retry button when error */}
      {(state === 'error' || state === 'snapshot') && !compact && (
        <button
          onClick={() => { reconnectCountRef.current = 0; startWebRTC(); }}
          style={{
            position: 'absolute',
            bottom: '8px',
            right: '8px',
            background: 'rgba(0, 217, 255, 0.2)',
            border: '1px solid #00d9ff',
            color: '#00d9ff',
            borderRadius: '4px',
            padding: '4px 10px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Retry WebRTC
        </button>
      )}
    </div>
  );
};

export default WebRTCStream;
