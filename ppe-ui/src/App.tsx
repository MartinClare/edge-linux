import React, { useState, useRef, useCallback } from 'react';
import LoginPage from './components/LoginPage';
import MultiCameraGrid, { type MultiCameraGridHandle } from './components/MultiCameraGrid';
import SystemHealthPanel from './components/SystemHealthPanel';
import './App.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => sessionStorage.getItem('vd2_auth') === 'true'
  );

  const multiCameraGridRef = useRef<MultiCameraGridHandle>(null);

  // Stable callbacks so MultiCameraGrid's poller dependency array doesn't
  // restart on every render (passing `() => {}` inline creates a new reference
  // each time, which breaks the useEffect interval).
  const handleGeminiResult = useCallback(() => {}, []);
  const handleAlertResult  = useCallback(() => {}, []);

  if (!isAuthenticated) {
    return <LoginPage onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="App">
      <div className="container">
        <aside className="sidebar">
              <div style={{
                padding: '1rem',
                background: 'rgba(0, 217, 255, 0.08)',
                borderRadius: '8px',
                border: '1px solid rgba(0, 217, 255, 0.2)',
                color: 'rgba(255,255,255,0.9)',
            fontSize: '0.95rem',
              }}>
            <p style={{ margin: 0 }}>📡 Live Monitoring</p>
                <p style={{ margin: '0.5rem 0 0 0', opacity: 0.85 }}>
              Streams and settings are on the <strong>main screen</strong> →
            </p>
            <button
              type="button"
              onClick={() => multiCameraGridRef.current?.openSettings()}
              style={{
                marginTop: '0.85rem',
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #00d9ff',
                background: 'rgba(0, 217, 255, 0.12)',
                color: '#00d9ff',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
              }}
            >
              ⚙️ Settings
            </button>
          </div>

          <SystemHealthPanel />
        </aside>

        <main className="main-content">
                  <MultiCameraGrid
            ref={multiCameraGridRef}
            analysisMode="gemini"
            onGeminiResult={handleGeminiResult}
            onAlertResult={handleAlertResult}
          />
        </main>
      </div>
    </div>
  );
}

export default App;
