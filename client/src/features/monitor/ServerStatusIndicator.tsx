import React, { useState, useEffect } from 'react';
import { checkServerStatus } from '../../services/server.api';

const ServerStatusIndicator: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        setIsConnected(await checkServerStatus());
      } catch {
        setIsConnected(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkStatus();
    const intervalId = setInterval(checkStatus, 5000);
    return () => clearInterval(intervalId);
  }, []);

  const statusText = isChecking ? 'Checking...' : isConnected ? 'Connected' : 'Disconnected';

  return (
    <div
      className="card-bw"
      style={{
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
      }}
      title={isConnected ? 'Backend Connected' : 'Backend Disconnected'}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: isChecking ? '#f59e0b' : isConnected ? '#16a34a' : '#dc2626',
        }}
      />
      <span>{statusText}</span>
    </div>
  );
};

export default ServerStatusIndicator;
