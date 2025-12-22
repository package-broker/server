import { useState } from 'react';
import { AlertTriangle, X, Check, Shield, Key, Edit2, Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTokens, createToken, updateToken, deleteToken, getSettings, type Token, type CreatedToken } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export function Tokens() {
  const [showModal, setShowModal] = useState(false);
  const [newToken, setNewToken] = useState<CreatedToken | null>(null);
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  // ... (lines 11-37 unchanged)

  return (
    <div className="space-y-8" data-testid="tokens-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-100 mb-2" data-testid="tokens-heading">Access Tokens</h2>
          <p className="text-slate-400">Manage tokens for Composer authentication</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary"
            data-testid="generate-token-button"
            aria-label="Generate new access token"
          >
            + Generate Token
          </button>
        )}
      </div>

      {/* ... (lines 55-68 unchanged) */}

      {/* Tokens List */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="w-8 h-8 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin mx-auto" />
          </div>
        ) : tokens.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No tokens generated yet. {isAdmin ? 'Create your first token to authenticate Composer.' : 'Ask an admin to generate tokens.'}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-800/50 border-b border-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Permissions
                </th>
                {kvAvailable && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Rate Limit
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Last Used
                </th>
                {isAdmin && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {tokens.map((token) => (
                <TokenRow
                  key={token.id}
                  token={token}
                  onUpdate={(data) => updateMutation.mutate({ id: token.id, data })}
                  onDelete={() => {
                    if (confirm('Revoke this token?')) {
                      deleteMutation.mutate(token.id);
                    }
                  }}
                  isUpdating={updateMutation.isPending}
                  kvAvailable={kvAvailable}
                  isAdmin={isAdmin}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ... */}
    </div>
  );
}

function TokenRow({
  token,
  onUpdate,
  onDelete,
  isUpdating,
  kvAvailable,
  isAdmin,
}: {
  token: Token;
  onUpdate: (data: { description?: string; rate_limit_max?: number | null }) => void;
  onDelete: () => void;
  isUpdating: boolean;
  kvAvailable: boolean;
  isAdmin: boolean;
}) {
  // ... (lines 155-183 unchanged)

  return (
    <tr className="hover:bg-slate-800/30">
      <td className="px-6 py-4 text-sm text-slate-200 font-medium">
        {isEditing ? (
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input w-full text-sm"
            autoFocus
          />
        ) : (
          token.description
        )}
      </td>
      {/* ... (lines 200-245 unchanged) */}

      {isAdmin && (
        <td className="px-6 py-4 text-right">
          <div className="flex items-center justify-end gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={isUpdating}
                  className="text-green-400 hover:text-green-300 text-sm flex items-center gap-1"
                  title="Save"
                >
                  <Save className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCancel}
                  disabled={isUpdating}
                  className="text-slate-400 hover:text-slate-200 text-sm"
                  title="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
                  title="Edit"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={onDelete}
                  className="text-red-400 hover:text-red-300 text-sm"
                  title="Revoke"
                >
                  Revoke
                </button>
              </>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

function GenerateTokenModal({
  onClose,
  onCreated,
  newToken,
  kvAvailable,
}: {
  onClose: () => void;
  onCreated: (token: CreatedToken) => void;
  newToken: CreatedToken | null;
  kvAvailable: boolean;
}) {
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<'readonly' | 'write'>('readonly');
  const [rateLimit, setRateLimit] = useState<string>('1000');
  const [copied, setCopied] = useState(false);

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: createToken,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      onCreated(data);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rateLimitNum = kvAvailable && rateLimit !== '' ? parseInt(rateLimit) : null;
    createMutation.mutate({
      description,
      permissions,
      rate_limit_max: rateLimitNum === null || isNaN(rateLimitNum) ? null : rateLimitNum,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Show token after creation
  if (newToken) {
    const authJsonSnippet = JSON.stringify(
      {
        'http-basic': {
          [window.location.host]: {
            username: 'token',
            password: newToken.token,
          },
        },
      },
      null,
      2
    );

    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="card max-w-lg w-full mx-4 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display text-xl font-bold text-slate-100">Token Generated!</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-yellow-400 text-sm">
              Copy this token now! It won't be shown again.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">Token</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newToken.token}
                  readOnly
                  className="input w-full font-mono text-xs"
                />
                <button
                  onClick={() => copyToClipboard(newToken.token)}
                  className="btn-secondary flex items-center gap-1"
                >
                  {copied ? <Check className="w-4 h-4" /> : null}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div>
              <label className="label">auth.json snippet</label>
              <pre className="bg-slate-950 rounded-lg p-4 overflow-x-auto text-xs text-slate-300">
                <code>{authJsonSnippet}</code>
              </pre>
              <button
                onClick={() => copyToClipboard(authJsonSnippet)}
                className="btn-secondary mt-2 text-sm"
              >
                Copy auth.json
              </button>
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <button onClick={onClose} className="btn-primary">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="card max-w-md w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-xl font-bold text-slate-100">Generate Token</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., CI/CD Pipeline"
              className="input w-full"
              required
            />
          </div>

          <div>
            <label className="label">Permissions</label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-700 bg-slate-800/50 cursor-pointer hover:bg-slate-800/70 transition-colors">
                <input
                  type="radio"
                  name="permissions"
                  value="readonly"
                  checked={permissions === 'readonly'}
                  onChange={(e) => setPermissions(e.target.value as 'readonly' | 'write')}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-slate-200 font-medium">
                    <Shield className="w-4 h-4" />
                    Read-only
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Can only download packages (composer install)
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-700 bg-slate-800/50 cursor-pointer hover:bg-slate-800/70 transition-colors">
                <input
                  type="radio"
                  name="permissions"
                  value="write"
                  checked={permissions === 'write'}
                  onChange={(e) => setPermissions(e.target.value as 'readonly' | 'write')}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-slate-200 font-medium">
                    <Key className="w-4 h-4" />
                    Write
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Can fetch metadata and sync packages (composer require/update)
                  </p>
                </div>
              </label>
            </div>
          </div>

          {kvAvailable && (
            <div>
              <label className="label">Rate Limit (requests/hour)</label>
              <div className="space-y-2">
                <input
                  type="number"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                  placeholder="Unlimited"
                  min={0}
                  max={25000}
                  className="input w-full"
                />
                <p className="text-xs text-slate-400">
                  Leave empty or set to 0 for unlimited (no rate limiting)
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Generating...' : 'Generate Token'}
            </button>
          </div>

          {createMutation.error && (
            <p className="text-red-400 text-sm">
              {(createMutation.error as Error).message}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

