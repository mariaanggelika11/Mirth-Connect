import React, { useState, useEffect } from "react";
import { checkServerStatus } from "../services/api";

const ServerStatusIndicator: React.FC = () => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        await checkServerStatus();
        setIsConnected(true);
      } catch (error) {
        setIsConnected(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkStatus(); // Initial check
    const intervalId = setInterval(checkStatus, 5000); // Check every 5 seconds

    return () => clearInterval(intervalId);
  }, []);

  const statusConfig = isConnected
    ? {
        dotColor: "bg-green-500",
        textColor: "text-green-400",
        text: "Connected",
        tooltip: "Successfully connected to the backend server at http://localhost:9000.",
      }
    : {
        dotColor: "bg-red-500",
        textColor: "text-red-400",
        text: "Disconnected",
        tooltip: "Cannot connect to the backend server. Please make sure the server process is running.",
      };

  return (
    <div className="group relative mt-auto p-2 bg-slate-900/50 rounded-md">
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${isChecking ? "bg-yellow-500 animate-pulse" : statusConfig.dotColor}`} />
        <span className={`text-sm font-medium ${isChecking ? "text-yellow-400" : statusConfig.textColor}`}>{isChecking ? "Checking..." : statusConfig.text}</span>
      </div>
      <div className="absolute left-0 bottom-full mb-2 w-64 p-2 text-xs text-slate-200 bg-slate-700 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
        {isChecking ? "Attempting to connect to the backend..." : statusConfig.tooltip}
      </div>
    </div>
  );
};

export default ServerStatusIndicator;
