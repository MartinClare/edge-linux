import React, { useState } from 'react';

interface LoginPageProps {
  onLogin: () => void;
}

const CREDENTIALS: Record<string, string> = {
  admin: '852852',
};

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (CREDENTIALS[username] && CREDENTIALS[username] === password) {
      sessionStorage.setItem('vd2_auth', 'true');
      onLogin();
    } else {
      setError('Invalid username or password.');
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    }}>
      <div style={{
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0, 217, 255, 0.2)',
        borderRadius: '16px',
        padding: '2.5rem 3rem',
        width: '360px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        animation: shaking ? 'shake 0.4s ease' : undefined,
      }}>
        {/* Logo / Title */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            fontSize: '2.5rem',
            marginBottom: '0.5rem',
          }}>🛡️</div>
          <h1 style={{
            fontSize: '1.4rem',
            fontWeight: 700,
            color: '#00d9ff',
            letterSpacing: '0.05em',
            marginBottom: '0.25rem',
          }}>Vision Safety Monitor</h1>
          <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
            Please sign in to continue
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block',
              fontSize: '0.8rem',
              color: 'rgba(255,255,255,0.6)',
              marginBottom: '0.4rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              autoComplete="username"
              autoFocus
              placeholder="Enter username"
              style={{
                width: '100%',
                padding: '0.65rem 0.9rem',
                background: 'rgba(255,255,255,0.07)',
                border: error ? '1px solid #e94560' : '1px solid rgba(0,217,255,0.25)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.95rem',
                outline: 'none',
                transition: 'border-color 0.2s',
                boxSizing: 'border-box',
              }}
              onFocus={e => { if (!error) e.target.style.borderColor = '#00d9ff'; }}
              onBlur={e => { if (!error) e.target.style.borderColor = 'rgba(0,217,255,0.25)'; }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{
              display: 'block',
              fontSize: '0.8rem',
              color: 'rgba(255,255,255,0.6)',
              marginBottom: '0.4rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              autoComplete="current-password"
              placeholder="Enter password"
              style={{
                width: '100%',
                padding: '0.65rem 0.9rem',
                background: 'rgba(255,255,255,0.07)',
                border: error ? '1px solid #e94560' : '1px solid rgba(0,217,255,0.25)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.95rem',
                outline: 'none',
                transition: 'border-color 0.2s',
                boxSizing: 'border-box',
              }}
              onFocus={e => { if (!error) e.target.style.borderColor = '#00d9ff'; }}
              onBlur={e => { if (!error) e.target.style.borderColor = 'rgba(0,217,255,0.25)'; }}
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(233, 69, 96, 0.15)',
              border: '1px solid rgba(233, 69, 96, 0.4)',
              borderRadius: '8px',
              padding: '0.5rem 0.75rem',
              marginBottom: '1rem',
              fontSize: '0.85rem',
              color: '#e94560',
              textAlign: 'center',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '0.75rem',
              background: 'linear-gradient(135deg, #00d9ff 0%, #0099bb 100%)',
              border: 'none',
              borderRadius: '8px',
              color: '#0f1923',
              fontWeight: 700,
              fontSize: '1rem',
              cursor: 'pointer',
              letterSpacing: '0.05em',
              transition: 'opacity 0.2s, transform 0.1s',
            }}
            onMouseOver={e => (e.currentTarget.style.opacity = '0.9')}
            onMouseOut={e => (e.currentTarget.style.opacity = '1')}
            onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
            onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
          >
            Sign In
          </button>
        </form>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-8px); }
          40%       { transform: translateX(8px); }
          60%       { transform: translateX(-6px); }
          80%       { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
};

export default LoginPage;
