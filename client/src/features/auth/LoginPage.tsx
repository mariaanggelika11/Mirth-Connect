import React, { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { EyeIcon, EyeOffIcon } from "lucide-react";

const LoginPage: React.FC = () => {
  const { login, isLoading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(username, password);
    } catch {
      setError("Invalid username or password");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-soft)]">
      <div className="card-bw w-full max-w-md p-8">
        <h1 className="text-2xl font-extrabold text-center mb-2">Sign in to your account</h1>
        <p className="text-center text-sm text-[var(--text-soft)] mb-6">Access the Channel Dashboard</p>

        {error && <div className="mb-4 text-sm text-red-600 bg-red-100 border border-red-200 rounded px-3 py-2">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Username</label>
            <input type="text" className="input-bw w-full px-3 py-2" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="input-bw w-full px-3 py-2 pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                required
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className={`absolute right-2 top-1/2 -translate-y-1/2 transition-transform duration-200 ${showPassword ? "rotate-180 scale-110" : "scale-100"}`}>
                {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>

            {capsLock && <div className="text-xs text-orange-600 mt-1">Caps Lock is ON</div>}
          </div>

          <button type="submit" disabled={isLoading} className="btn-primary w-full py-2 mt-2 disabled:opacity-60">
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
