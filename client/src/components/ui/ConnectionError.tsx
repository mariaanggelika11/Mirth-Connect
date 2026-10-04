import React from 'react';
import { Button } from './Button';
import { TriangleAlert as AlertTriangleIcon } from 'lucide-react';

interface ConnectionErrorProps {
  onRetry: () => void;
}

export const ConnectionError: React.FC<ConnectionErrorProps> = ({ onRetry }) => {
  const codeStyle = {
    padding: '2px 6px',
    borderRadius: 4,
    border: '1px solid var(--border-main)',
    background: 'var(--bg-soft)',
    fontFamily: 'monospace',
    fontSize: 12,
  };

  return (
    <div className="card-bw" style={{ maxWidth: 900, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', gap: 16 }}>
        <AlertTriangleIcon style={{ width: 28, height: 28, color: '#f59e0b' }} />

        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Connection to Server Failed</h2>
          <p style={{ marginTop: 8, color: 'var(--text-soft)' }}>
            The application could not communicate with the backend server.
          </p>
        </div>
      </div>

      <div style={{ marginTop: 24, borderTop: '1px solid var(--border-main)', paddingTop: 16 }}>
        <h3 style={{ fontWeight: 600 }}>Troubleshooting Checklist</h3>

        <ul style={{ marginTop: 12, paddingLeft: 20, color: 'var(--text-main)', fontSize: 14 }}>
          <li>
            Backend server running in <code style={codeStyle}>server/</code>
          </li>
          <li>
            Port must be <code style={codeStyle}>http://localhost:9000</code>
          </li>
          <li>
            No <code style={codeStyle}>CORS policy</code> error in console
          </li>
          <li>
            No firewall / proxy blocking <code style={codeStyle}>localhost</code>
          </li>
        </ul>
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={onRetry}>Retry Connection</Button>
      </div>
    </div>
  );
};
