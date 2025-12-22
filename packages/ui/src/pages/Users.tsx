
import React, { useEffect, useState } from 'react';
import { User, getUsers, createUser, deleteUser } from '../lib/api';
import { Trash2, UserPlus, Shield, User as UserIcon, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function Users() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const { isAdmin } = useAuth();

    // ... (lines 12-64 unchanged)
    // Invite Form State
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'admin' | 'viewer'>('viewer');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        try {
            const data = await getUsers();
            setUsers(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this user?')) return;

        try {
            await deleteUser(id);
            setUsers(users.filter(u => u.id !== id));
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            await createUser({
                email: inviteEmail,
                role: inviteRole
            });
            setShowInviteModal(false);
            setInviteEmail('');
            loadUsers();
            alert('User invited successfully. They will receive an email to set their password.');
        } catch (err: any) {
            alert(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="text-slate-400">Loading users...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-100">Users</h1>
                    <p className="text-slate-400">Manage access to the Composer Proxy</p>
                </div>
                {isAdmin && (
                    <button
                        onClick={() => setShowInviteModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition"
                    >
                        <UserPlus className="w-5 h-5" />
                        Invite User
                    </button>
                )}
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400">
                    {error}
                </div>
            )}

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-800 border-b border-slate-700">
                            <th className="px-6 py-4 text-sm font-semibold text-slate-300">User</th>
                            <th className="px-6 py-4 text-sm font-semibold text-slate-300">Role</th>
                            <th className="px-6 py-4 text-sm font-semibold text-slate-300">Status</th>
                            <th className="px-6 py-4 text-sm font-semibold text-slate-300">Created</th>
                            {isAdmin && (
                                <th className="px-6 py-4 text-right text-sm font-semibold text-slate-300">Actions</th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                        {users.map((user) => (
                            <tr key={user.id} className="hover:bg-slate-800/30 transition">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                                            <UserIcon className="w-4 h-4 text-slate-400" />
                                        </div>
                                        <div>
                                            <div className="text-slate-200 font-medium">{user.email}</div>
                                            <div className="text-xs text-slate-500 font-mono">{user.id}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-700/50 border border-slate-600 w-fit">
                                        <Shield className="w-3 h-3 text-primary-400" />
                                        <span className="text-xs font-medium text-slate-300 capitalize">{user.role}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.status === 'active' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                                        }`}>
                                        {user.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-400">
                                    {new Date(user.created_at * 1000).toLocaleDateString()}
                                </td>
                                {isAdmin && (
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => handleDelete(user.id)}
                                            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                                            title="Delete User"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Invite Modal */}
            {showInviteModal && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6">
                        <h2 className="text-xl font-bold text-white mb-4">Invite New User</h2>
                        <form onSubmit={handleInvite} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="email"
                                        value={inviteEmail}
                                        onChange={e => setInviteEmail(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                        placeholder="user@example.com"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Role</label>
                                <select
                                    value={inviteRole}
                                    onChange={e => setInviteRole(e.target.value as any)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                >
                                    <option value="viewer">Viewer</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>

                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowInviteModal(false)}
                                    className="px-4 py-2 text-slate-300 hover:text-white transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition disabled:opacity-50"
                                >
                                    {submitting ? 'Inviting...' : 'Invite User'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
