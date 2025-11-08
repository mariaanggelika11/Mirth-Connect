import React from "react";
import { Button } from "./Button";
import { AlertTriangleIcon } from "../icons/Icon";

interface ConnectionErrorProps {
  onRetry: () => void;
}

export const ConnectionError: React.FC<ConnectionErrorProps> = ({ onRetry }) => {
  const codeStyle = "px-2 py-1 bg-slate-700 rounded-md font-mono text-sm text-indigo-300";
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-3xl mx-auto my-8">
      <div className="flex items-start gap-4">
        <AlertTriangleIcon className="h-8 w-8 text-yellow-400 flex-shrink-0 mt-1" />
        <div>
          <h2 className="text-2xl font-bold text-white">Connection to Server Failed</h2>
          <p className="mt-2 text-slate-400">The application could not communicate with the backend server. Please use the checklist below to troubleshoot the issue.</p>
        </div>
      </div>

      <div className="mt-6 border-t border-slate-700 pt-6">
        <h3 className="font-semibold text-lg text-slate-200">Troubleshooting Checklist</h3>
        <ul className="mt-3 list-disc list-inside space-y-3 text-slate-300">
          <li>
            <strong>Is the backend server running?</strong>
            <p className="text-sm text-slate-400 ml-6">
              Make sure you have started the server process in the <code className={codeStyle}>server/</code> directory (e.g., by running <code className={codeStyle}>npm run dev</code> or{" "}
              <code className={codeStyle}>node dist/index.js</code>).
            </p>
          </li>
          <li>
            <strong>Is the port correct?</strong>
            <p className="text-sm text-slate-400 ml-6">
              The UI is trying to connect to <code className={codeStyle}>http://localhost:9000</code>. Verify that your server is configured to run on this port.
            </p>
          </li>
          <li>
            <strong>Check for CORS errors.</strong>
            <p className="text-sm text-slate-400 ml-6">
              Open your browser's developer console (F12) and check the "Console" tab for any errors related to <code className={codeStyle}>CORS policy</code>. If you see them, your server needs to be configured to allow requests from the
              UI's origin.
            </p>
          </li>
          <li>
            <strong>Is a firewall or proxy blocking the connection?</strong>
            <p className="text-sm text-slate-400 ml-6">
              Ensure that no personal firewall, VPN, or network proxy is blocking local network connections to <code className={codeStyle}>localhost</code>.
            </p>
          </li>
        </ul>
      </div>

      <div className="mt-6 border-t border-slate-700 pt-6 flex justify-end">
        <Button onClick={onRetry} variant="primary">
          Retry Connection
        </Button>
      </div>
    </div>
  );
};
