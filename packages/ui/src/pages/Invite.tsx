import React, { useState } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router';
import { acceptInvite } from '../lib/api';
import { Package } from 'lucide-react';

export default function Invite() {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // If token is in query param instead of path (optional support)
    const [searchParams] = useSearchParams();
    const tokenFromQuery = searchParams.get('token');
    const actualToken = token || tokenFromQuery;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!actualToken) {
            setError('Invalid invite link');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            await acceptInvite(actualToken, password);
            // Pass state to login page to show success message
            navigate('/login', { state: { message: 'Password set successfully! Please login.' } });
        } catch (err: any) {
            setError(err.message || 'Failed to accept invite');
        } finally {
            setIsLoading(false);
        }
    };

    if (!actualToken) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
                <div className="max-w-md w-full mx-4">
                    <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl shadow-2xl border border-slate-700/50 p-8 text-center">
                        <h2 className="text-2xl font-bold text-white mb-2">Invalid Invite Link</h2>
                        <p className="text-slate-400">Please check the link in your email.</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            <div className="max-w-md w-full mx-4">
                <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl shadow-2xl border border-slate-700/50 p-8">

                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 mb-4">
                            <Package className="w-8 h-8 text-white" />
                        </div>
                        <h1 className="text-2xl font-bold text-white">Welcome</h1>
                        <p className="text-slate-400 mt-1">Set your password to accept the invitation</p>
                    </div>

                    <form className="space-y-5" onSubmit={handleSubmit}>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                                New Password
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                                placeholder="Minimum 8 characters"
                                minLength={8}
                            />
                        </div>

                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300 mb-2">
                                Confirm Password
                            </label>
                            <input
                                id="confirmPassword"
                                name="confirmPassword"
                                type="password"
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                                placeholder="Confirm your password"
                            />
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400 text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-3 px-4 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-semibold rounded-lg shadow-lg shadow-orange-500/25 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Setting password...' : 'Set Password and Login'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
