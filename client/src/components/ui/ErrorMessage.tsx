import React from "react";
import { Button } from "./Button";

interface ErrorMessageProps {
  title: string;
  message: string;
  onRetry?: () => void;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ title, message, onRetry }) => {
  return (
    <div className="card-bw" style={{ borderColor: "var(--danger)", background: "#fef2f2" }} role="alert">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, gap: 12 }}>
        <div>
          <strong style={{ display: "block", color: "var(--danger)" }}>{title}</strong>
          <span style={{ color: "var(--text-main)", fontSize: 14 }}>{message}</span>
        </div>

        {onRetry && (
          <Button onClick={onRetry} variant="secondary">
            Retry
          </Button>
        )}
      </div>
    </div>
  );
};
