import React from "react";
import { Button } from "./Button";

interface ErrorMessageProps {
  title: string;
  message: string;
  onRetry?: () => void;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ title, message, onRetry }) => {
  return (
    <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg relative" role="alert">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <strong className="font-bold block">{title}</strong>
            <span className="block sm:inline">{message}</span>
          </div>
        </div>
        {onRetry && (
          <Button onClick={onRetry} variant="secondary" className="bg-red-800/50 hover:bg-red-700/50 text-white ml-4">
            Retry
          </Button>
        )}
      </div>
    </div>
  );
};
