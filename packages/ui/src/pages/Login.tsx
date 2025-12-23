import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const { login, authError } = useAuth() as any;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Don't clear error if it triggered 2FA input
    if (error !== '2FA required') {
      setError(null);
    }
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, code }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        login(data.token);
        onSuccess();
      } else {
        if (data.code === '2fa_required') {
          setError('2FA required');
        } else {
          setError(data.error || 'Invalid credentials');
        }
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-md w-full mx-4">
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl shadow-2xl border border-slate-700/50 p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 mb-4">
              <Package className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Composer Proxy</h1>
            <p className="text-slate-400 mt-1">Sign in to manage your packages</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5" data-testid="login-form">
            {authError && (
              <div
                role="alert"
                aria-live="polite"
                data-testid="auth-context-error"
                className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400 text-sm mb-4"
              >
                Auth Error: {authError}
              </div>
            )}
            {error && (
              <div
                role="alert"
                aria-live="polite"
                data-testid="login-error"
                className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400 text-sm"
              >
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder="admin@example.com"
                required
                aria-label="Email address"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder="Enter your password"
                required
                aria-label="Password"
                disabled={loading}
              />
            </div>

            {error === '2FA required' && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <label htmlFor="code" className="block text-sm font-medium text-slate-300 mb-2">
                  2FA Code
                </label>
                <input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                  placeholder="000000"
                  required
                  autoFocus
                  maxLength={6}
                  pattern="\d{6}"
                  aria-label="2FA Code"
                  disabled={loading}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password || (error === '2FA required' && code.length !== 6)}
              className="w-full py-3 px-4 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-semibold rounded-lg shadow-lg shadow-orange-500/25 transition disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Sign in"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Help text removed */}
        </div>
      </div>
    </div>
  );
}

