import React, { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../../components/ui/Button";

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { login, isLoading } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username || !password) {
      setError("Username and password are required.");
      return;
    }

    try {
      await login(username, password);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("Login failed.");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-soft)",
      }}
    >
      <div className="card-bw" style={{ width: 360, padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Sign in to your account</h2>
          <p style={{ marginTop: 6, color: "var(--text-soft)", fontSize: 14 }}>to access the Channel Dashboard</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div
              style={{
                padding: 12,
                border: `1px solid var(--danger)`,
                background: "#fef2f2",
                color: "var(--danger)",
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <input type="text" placeholder="Username" autoComplete="username" className="input-bw" value={username} onChange={(e) => setUsername(e.target.value)} />

          <input type="password" placeholder="Password" autoComplete="current-password" className="input-bw" value={password} onChange={(e) => setPassword(e.target.value)} />

          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
