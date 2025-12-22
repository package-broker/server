import { useState, useEffect } from 'react';
import { Shield, Smartphone, Key, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { setup2FA, enable2FA, disable2FA, getAuthToken } from '../lib/api';

interface UserData {
    id: string;
    email: string;
    role: string;
    two_factor_enabled: boolean;
}

export function Profile() {
    const [user, setUser] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
    const [code, setCode] = useState('');
    const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        fetchUser();
    }, []);

    const fetchUser = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch('/api/auth/me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.user) {
                setUser(data.user);
            }
        } catch (err) {
            console.error('Failed to fetch user', err);
        } finally {
            setLoading(false);
        }
    };

    const handleStartSetup = async () => {
        setActionLoading(true);
        setError(null);
        try {
            const data = await setup2FA();
            setSetupData(data);
        } catch (err) {
            setError('Failed to start 2FA setup');
        } finally {
            setActionLoading(false);
        }
    };

    const handleEnable = async () => {
        if (!setupData) return;
        setActionLoading(true);
        setError(null);
        try {
            const res = await enable2FA(setupData.secret, code);
            setRecoveryCodes(res.recoveryCodes);
            setSetupData(null);
            setCode('');
            await fetchUser(); // Update status
        } catch (err) {
            setError('Invalid code');
        } finally {
            setActionLoading(false);
        }
    };

    const handleDisable = async () => {
        if (!confirm('Are you sure you want to disable 2FA? Your account will be less secure.')) return;
        setActionLoading(true);
        setError(null);
        try {
            await disable2FA();
            await fetchUser();
        } catch (err) {
            setError('Failed to disable 2FA');
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-400">Loading profile...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-100 font-display">My Profile</h1>
            </div>

            <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-16 h-16 bg-slate-700 rounded-full flex items-center justify-center text-2xl font-bold text-slate-300">
                        {user?.email[0].toUpperCase()}
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-white">{user?.email}</h2>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 capitalize">
                            {user?.role}
                        </span>
                    </div>
                </div>

                <div className="border-t border-slate-700 pt-6">
                    <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                        <Shield className="w-5 h-5 text-orange-500" />
                        Security
                    </h3>

                    <div className="bg-slate-900/50 rounded-lg p-6 border border-slate-700/50">
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h4 className="font-medium text-slate-200 flex items-center gap-2">
                                    Two-Factor Authentication (2FA)
                                    {user?.two_factor_enabled && (
                                        <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">Enabled</span>
                                    )}
                                </h4>
                                <p className="text-sm text-slate-400 mt-1">
                                    Add an extra layer of security to your account by requiring a code from your authenticator app.
                                </p>
                            </div>

                            {!user?.two_factor_enabled && !setupData && (
                                <button
                                    onClick={handleStartSetup}
                                    disabled={actionLoading}
                                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition"
                                >
                                    Enable 2FA
                                </button>
                            )}

                            {user?.two_factor_enabled && (
                                <button
                                    onClick={handleDisable}
                                    disabled={actionLoading}
                                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium transition"
                                >
                                    Disable
                                </button>
                            )}
                        </div>

                        {/* Setup Flow */}
                        {setupData && (
                            <div className="mt-6 p-4 bg-slate-800 rounded-lg border border-slate-700 animate-in fade-in slide-in-from-top-4">
                                <h5 className="font-medium text-white mb-4 flex items-center gap-2">
                                    <Smartphone className="w-4 h-4" />
                                    Scan QR Code
                                </h5>
                                <div className="grid md:grid-cols-2 gap-8">
                                    <div className="flex flex-col items-center">
                                        <div className="bg-white p-2 rounded-lg mb-4">
                                            <img src={setupData.qrCode} alt="2FA QR Code" className="w-48 h-48" />
                                        </div>
                                        <p className="text-xs text-slate-500 text-center max-w-xs">
                                            Scan this code with Google Authenticator, Authy, or 1Password.
                                        </p>
                                    </div>
                                    <div className="flex flex-col justify-center space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-400 mb-1">
                                                Manual Entry Code
                                            </label>
                                            <code className="block w-full p-2 bg-slate-900 rounded text-slate-300 font-mono text-sm select-all">
                                                {setupData.secret}
                                            </code>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-400 mb-1">
                                                Verification Code
                                            </label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={code}
                                                    onChange={e => setCode(e.target.value)}
                                                    placeholder="000000"
                                                    maxLength={6}
                                                    className="bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white w-32 focus:ring-2 focus:ring-orange-500 outline-none"
                                                />
                                                <button
                                                    onClick={handleEnable}
                                                    disabled={code.length !== 6 || actionLoading}
                                                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded font-medium disabled:opacity-50"
                                                >
                                                    Verify & Enable
                                                </button>
                                            </div>
                                            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Recovery Codes */}
                        {recoveryCodes && (
                            <div className="mt-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                                <div className="flex items-center gap-2 text-green-400 font-medium mb-2">
                                    <Check className="w-5 h-5" />
                                    2FA Enabled Successfully!
                                </div>
                                <div className="mb-4 text-slate-300 text-sm">
                                    Please save these recovery codes in a secure place. You will need them if you lose access to your authenticator device.
                                </div>
                                <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-slate-900 p-4 rounded border border-slate-700">
                                    {recoveryCodes.map(c => (
                                        <div key={c} className="text-slate-300 select-all">{c}</div>
                                    ))}
                                </div>
                                <button
                                    onClick={() => setRecoveryCodes(null)}
                                    className="mt-4 text-sm text-slate-400 hover:text-white underline"
                                >
                                    I have saved these codes
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
