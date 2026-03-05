import React, { useState, useEffect, useCallback } from 'react';

interface Alarm {
  alarm_id: string;
  camera_id: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  risk_score: number;
  state: 'idle' | 'monitoring' | 'triggered' | 'escalated' | 'acknowledged' | 'resolved';
  triggered_at: string;
  details?: {
    custom_condition?: string;
    condition_name?: string;
    message?: string;
    [key: string]: any;
  };
}

interface AlarmStatus {
  enabled: boolean;
  active_alarms: number;
  total_history: number;
  monitoring_active: boolean;
  config_loaded: boolean;
}

interface AlarmLog {
  timestamp: string;
  alarm_id: string;
  camera_id: string;
  risk_level: string;
  risk_score: number;
  state: string;
  actions: string[];
  details: any;
}

const YOLO_API_URL = process.env.REACT_APP_YOLO_API_URL || 'http://localhost:8000';

const AlarmObserverPanel: React.FC = () => {
  const [status, setStatus] = useState<AlarmStatus | null>(null);
  const [activeAlarms, setActiveAlarms] = useState<Alarm[]>([]);
  const [alarmLogs, setAlarmLogs] = useState<AlarmLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [showLogModal, setShowLogModal] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'high' | 'critical'>('all');

  const fetchAlarmData = useCallback(async () => {
    try {
      // Fetch status
      const statusRes = await fetch(`${YOLO_API_URL}/alarms/status`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStatus(statusData);
      }

      // Fetch active alarms
      const alarmsRes = await fetch(`${YOLO_API_URL}/alarms/active`);
      if (alarmsRes.ok) {
        const alarmsData = await alarmsRes.json();
        setActiveAlarms(alarmsData);
      }

      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError('Connection error');
    }
  }, []);

  const fetchAlarmLogs = useCallback(async () => {
    try {
      const response = await fetch(`${YOLO_API_URL}/alarms/history?limit=100`);
      if (response.ok) {
        const logs = await response.json();
        setAlarmLogs(logs);
      }
    } catch (err) {
      console.error('Failed to fetch alarm logs:', err);
    }
  }, []);

  useEffect(() => {
    fetchAlarmData();
    const interval = setInterval(fetchAlarmData, 3000);
    return () => clearInterval(interval);
  }, [fetchAlarmData]);

  useEffect(() => {
    if (showLogModal) {
      fetchAlarmLogs();
    }
  }, [showLogModal, fetchAlarmLogs]);

  const handleAcknowledge = async (alarmId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`${YOLO_API_URL}/alarms/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alarm_id: alarmId }),
      });
      if (response.ok) {
        fetchAlarmData();
      }
    } catch (err) {
      console.error('Failed to acknowledge alarm:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (alarmId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`${YOLO_API_URL}/alarms/resolve/${alarmId}`, {
        method: 'POST',
      });
      if (response.ok) {
        fetchAlarmData();
      }
    } catch (err) {
      console.error('Failed to resolve alarm:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTestAlarm = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${YOLO_API_URL}/alarms/test`, {
        method: 'POST',
      });
      if (response.ok) {
        fetchAlarmData();
      }
    } catch (err) {
      console.error('Failed to trigger test alarm:', err);
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'critical': return '#f44336';
      case 'high': return '#ff5722';
      case 'medium': return '#ff9800';
      case 'low': return '#4caf50';
      default: return '#9e9e9e';
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'triggered': return '🚨';
      case 'escalated': return '⬆️';
      case 'acknowledged': return '👁️';
      case 'resolved': return '✅';
      default: return '⚪';
    }
  };

  return (
    <div style={{
      padding: '1.25rem',
      background: 'rgba(0, 0, 0, 0.3)',
      borderRadius: '8px',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      marginTop: '1rem',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1rem',
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '1.35rem',
          color: '#00d9ff',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}>
          🔔 Alarm Observer
        </h3>
        <span style={{
          fontSize: '0.9rem',
          color: 'rgba(255,255,255,0.5)',
        }}>
          {lastUpdate.toLocaleTimeString()}
        </span>
      </div>

      {error && (
        <div style={{
          padding: '0.75rem',
          background: 'rgba(244, 67, 54, 0.2)',
          borderRadius: '4px',
          fontSize: '1rem',
          color: '#f44336',
          marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {/* Status Summary */}
      {status && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}>
          <div style={{
            padding: '0.75rem',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '4px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '1.75rem',
              fontWeight: 'bold',
              color: status.active_alarms > 0 ? '#f44336' : '#4caf50',
            }}>
              {status.active_alarms}
            </div>
            <div style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.6)' }}>
              Active Alarms
            </div>
          </div>
          <div style={{
            padding: '0.75rem',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '4px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '1.75rem',
              fontWeight: 'bold',
              color: status.monitoring_active ? '#4caf50' : '#ff9800',
            }}>
              {status.monitoring_active ? 'ON' : 'OFF'}
            </div>
            <div style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.6)' }}>
              Monitoring
            </div>
          </div>
        </div>
      )}

      {/* Active Alarms List */}
      {activeAlarms.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{
            fontSize: '1.1rem',
            color: 'rgba(255,255,255,0.7)',
            margin: '0 0 0.75rem 0',
          }}>
            Active Alerts
          </h4>
          {activeAlarms.map((alarm) => (
            <div
              key={alarm.alarm_id}
              style={{
                padding: '0.75rem',
                background: 'rgba(0,0,0,0.4)',
                borderRadius: '4px',
                marginBottom: '0.75rem',
                borderLeft: `4px solid ${getRiskColor(alarm.risk_level)}`,
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '1.1rem',
                fontWeight: 'bold',
                color: getRiskColor(alarm.risk_level),
              }}>
                {getStateIcon(alarm.state)}
                <span style={{ textTransform: 'uppercase' }}>{alarm.risk_level}</span>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 'normal' }}>
                  ({Math.round(alarm.risk_score * 100)}%)
                </span>
              </div>
              <div style={{
                fontSize: '1rem',
                color: 'rgba(255,255,255,0.6)',
                marginTop: '0.5rem',
              }}>
                📷 {alarm.camera_id}
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: 'rgba(255,255,255,0.4)',
              }}>
                {new Date(alarm.triggered_at).toLocaleTimeString()}
              </div>
              {alarm.state !== 'resolved' && (
                <div style={{
                  display: 'flex',
                  gap: '0.75rem',
                  marginTop: '0.75rem',
                }}>
                  {alarm.state !== 'acknowledged' && (
                    <button
                      onClick={() => handleAcknowledge(alarm.alarm_id)}
                      disabled={loading}
                      style={{
                        flex: 1,
                        padding: '0.5rem 0.75rem',
                        fontSize: '0.95rem',
                        background: 'rgba(33, 150, 243, 0.8)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.6 : 1,
                      }}
                    >
                      Ack
                    </button>
                  )}
                  <button
                    onClick={() => handleResolve(alarm.alarm_id)}
                    disabled={loading}
                    style={{
                      flex: 1,
                      padding: '0.5rem 0.75rem',
                      fontSize: '0.95rem',
                      background: 'rgba(76, 175, 80, 0.8)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      opacity: loading ? 0.6 : 1,
                    }}
                  >
                    Resolve
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Test Button */}
      <button
        onClick={handleTestAlarm}
        disabled={loading}
        style={{
          width: '100%',
          padding: '0.75rem',
          fontSize: '1.1rem',
          background: 'rgba(156, 39, 176, 0.6)',
          color: 'white',
          border: '1px solid rgba(156, 39, 176, 0.8)',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          marginBottom: '0.75rem',
        }}
      >
        🧪 Test Alarm
      </button>

      {/* View Log Button */}
      <button
        onClick={() => setShowLogModal(true)}
        style={{
          width: '100%',
          padding: '0.75rem',
          fontSize: '1.1rem',
          background: 'rgba(33, 150, 243, 0.6)',
          color: 'white',
          border: '1px solid rgba(33, 150, 243, 0.8)',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
        }}
      >
        📋 View Alarm Log
      </button>

      {!status?.enabled && (
        <div style={{
          marginTop: '0.75rem',
          padding: '0.75rem',
          background: 'rgba(255, 152, 0, 0.2)',
          borderRadius: '4px',
          fontSize: '0.95rem',
          color: '#ff9800',
          textAlign: 'center',
        }}>
          ⚠️ Alarm system is disabled in config
        </div>
      )}

      {/* Log Modal */}
      {showLogModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#1a1a2e',
            borderRadius: '12px',
            padding: '1.5rem',
            width: '90%',
            maxWidth: '900px',
            maxHeight: '80vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
            }}>
              <h2 style={{
                margin: 0,
                fontSize: '1.5rem',
                color: '#00d9ff',
              }}>
                📋 Alarm History Log
              </h2>
              <button
                onClick={() => setShowLogModal(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  color: 'white',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  padding: '0.5rem',
                  borderRadius: '4px',
                }}
              >
                ✕
              </button>
            </div>

            {/* Filter Buttons */}
            <div style={{
              display: 'flex',
              gap: '0.5rem',
              marginBottom: '1rem',
            }}>
              {['all', 'high', 'critical'].map((filter) => (
                <button
                  key={filter}
                  onClick={() => setLogFilter(filter as any)}
                  style={{
                    padding: '0.5rem 1rem',
                    fontSize: '0.95rem',
                    background: logFilter === filter ? 'rgba(0, 217, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                    color: logFilter === filter ? '#00d9ff' : 'white',
                    border: logFilter === filter ? '1px solid #00d9ff' : '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {filter === 'all' ? 'All' : filter.toUpperCase()}
                </button>
              ))}
              <span style={{
                marginLeft: 'auto',
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
              }}>
                {alarmLogs.length} records
              </span>
            </div>

            {/* Log List */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '8px',
              padding: '0.5rem',
            }}>
              {alarmLogs
                .filter(log => logFilter === 'all' || log.risk_level === logFilter)
                .map((log, index) => (
                <div
                  key={index}
                  style={{
                    padding: '0.75rem',
                    background: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: '6px',
                    marginBottom: '0.5rem',
                    borderLeft: `4px solid ${getRiskColor(log.risk_level)}`,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.5rem',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}>
                      <span style={{
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        color: getRiskColor(log.risk_level),
                        textTransform: 'uppercase',
                      }}>
                        {log.risk_level}
                      </span>
                      <span style={{
                        fontSize: '0.9rem',
                        color: 'rgba(255, 255, 255, 0.6)',
                      }}>
                        ({Math.round(log.risk_score * 100)}%)
                      </span>
                    </div>
                    <span style={{
                      fontSize: '0.85rem',
                      color: 'rgba(255, 255, 255, 0.5)',
                    }}>
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  
                  <div style={{
                    fontSize: '0.95rem',
                    color: 'rgba(255, 255, 255, 0.8)',
                    marginBottom: '0.25rem',
                  }}>
                    📷 Camera: {log.camera_id}
                  </div>
                  
                  {log.details?.condition_name && (
                    <div style={{
                      fontSize: '0.9rem',
                      color: '#00d9ff',
                      marginBottom: '0.25rem',
                    }}>
                      ⚡ Condition: {log.details.condition_name}
                    </div>
                  )}
                  
                  {log.details?.message && (
                    <div style={{
                      fontSize: '0.9rem',
                      color: 'rgba(255, 255, 255, 0.7)',
                      marginBottom: '0.25rem',
                    }}>
                      💬 {log.details.message}
                    </div>
                  )}
                  
                  <div style={{
                    fontSize: '0.85rem',
                    color: 'rgba(255, 255, 255, 0.5)',
                  }}>
                    ID: {log.alarm_id} | State: {log.state} | Actions: {log.actions?.join(', ') || 'none'}
                  </div>
                </div>
              ))}
              
              {alarmLogs.length === 0 && (
                <div style={{
                  textAlign: 'center',
                  padding: '2rem',
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontSize: '1.1rem',
                }}>
                  No alarm records found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AlarmObserverPanel;
