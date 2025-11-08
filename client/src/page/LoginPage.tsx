import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { login, isLoading } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || !password) {
      setError("Both username and password are required.");
      return;
    }
    try {
      await login(username, password);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("An unexpected error occurred.");
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0b1220]">
      <div className="w-[360px] p-10 bg-slate-800 rounded-2xl shadow-2xl border border-slate-700">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white">Sign in to your account</h2>
          <p className="mt-2 text-sm text-slate-400">to access the Channel Dashboard</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          {error && <div className="p-3 bg-red-500/20 border border-red-500/50 text-red-300 rounded-md text-sm">{error}</div>}

          <div className="space-y-3">
            <input
              id="username"
              name="username"
              type="text"
              placeholder="Username"
              autoComplete="username"
              required
              className="w-full px-3 py-2 rounded-md bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />

            <input
              id="password"
              name="password"
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              required
              className="w-full px-3 py-2 rounded-md bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" disabled={isLoading} className="w-full py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-all duration-200 disabled:bg-indigo-500/50 disabled:cursor-not-allowed">
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
