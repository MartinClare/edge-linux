import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config/api';

interface ServiceHealth {
  ok: boolean;
  port: number;
}

interface HealthData {
  timestamp: string;
  services: Record<string, ServiceHealth>;
  systemd: Record<string, string>;
  streams: Record<string, boolean>;
}

const REFRESH_INTERVAL = 30_000; // 30 s

const statusColor = (ok: boolean) => ok ? '#4caf50' : '#f44336';
const statusBg    = (ok: boolean) => ok ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.12)';
const statusBorder= (ok: boolean) => ok ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)';

const Dot: React.FC<{ ok: boolean }> = ({ ok }) => (
  <span style={{
    display: 'inline-block',
    width: 9, height: 9,
    borderRadius: '50%',
    background: statusColor(ok),
    flexShrink: 0,
    boxShadow: ok ? '0 0 6px rgba(76,175,80,0.7)' : '0 0 6px rgba(244,67,54,0.7)',
  }} />
);

const SystemHealthPanel: React.FC = () => {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health/all`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: HealthData = await res.json();
      setData(json);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError('Unable to reach health endpoint');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, REFRESH_INTERVAL);
    return () => clearInterval(t);
  }, [fetchHealth]);

  const allOk = data
    ? Object.values(data.services).every(s => s.ok)
    : false;

  const streamEntries = data ? Object.entries(data.streams) : [];
  const allStreamsOk = streamEntries.length > 0 && streamEntries.every(([, ok]) => ok);

  return (
    <div style={{
      padding: '1.25rem',
      background: 'rgba(0,0,0,0.3)',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.1)',
      marginTop: '1rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#00d9ff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.1rem' }}>🖥</span> System Health
          {!loading && data && (
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 'normal',
              padding: '2px 8px',
              borderRadius: '99px',
              background: allOk ? 'rgba(76,175,80,0.2)' : 'rgba(244,67,54,0.2)',
              color: allOk ? '#4caf50' : '#f44336',
              border: `1px solid ${allOk ? 'rgba(76,175,80,0.4)' : 'rgba(244,67,54,0.4)'}`,
            }}>
              {allOk ? 'All OK' : 'Issue Detected'}
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {lastUpdate && (
            <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)' }}>
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchHealth}
            title="Refresh"
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              padding: '3px 8px',
            }}
          >
            ↻
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '0.6rem 0.75rem',
          background: 'rgba(244,67,54,0.15)',
          border: '1px solid rgba(244,67,54,0.3)',
          borderRadius: '6px',
          color: '#f44336',
          fontSize: '0.85rem',
          marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem 0' }}>
          Checking services…
        </div>
      )}

      {/* Services */}
      {data && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '1rem' }}>
            {Object.entries(data.services).map(([name, svc]) => (
              <div key={name} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0.7rem',
                borderRadius: '6px',
                background: statusBg(svc.ok),
                border: `1px solid ${statusBorder(svc.ok)}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <Dot ok={svc.ok} />
                  <span style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.85)' }}>{name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)' }}>:{svc.port}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: statusColor(svc.ok) }}>
                    {svc.ok ? 'UP' : 'DOWN'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Camera Streams */}
          {streamEntries.length > 0 && (
            <>
              <div style={{
                fontSize: '0.78rem',
                color: 'rgba(255,255,255,0.4)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: '0.4rem',
              }}>
                Camera Streams
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.4rem', marginBottom: '1rem' }}>
                {streamEntries.map(([cam, ok]) => (
                  <div key={cam} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    background: statusBg(ok),
                    border: `1px solid ${statusBorder(ok)}`,
                  }}>
                    <Dot ok={ok} />
                    <span style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.8)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cam}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Summary footer */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '0.6rem',
            borderTop: '1px solid rgba(255,255,255,0.07)',
          }}>
            <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)' }}>
              Refreshes every 30 s
            </span>
            <span style={{
              fontSize: '0.8rem',
              color: (allOk && (streamEntries.length === 0 || allStreamsOk)) ? '#4caf50' : '#f44336',
            }}>
              {Object.values(data.services).filter(s => s.ok).length}/{Object.keys(data.services).length} services up
              {streamEntries.length > 0 && ` · ${streamEntries.filter(([, ok]) => ok).length}/${streamEntries.length} streams`}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default SystemHealthPanel;
