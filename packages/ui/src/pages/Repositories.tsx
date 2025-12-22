import { useState } from 'react';
import { X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRepositories,
  createRepository,
  updateRepository,
  deleteRepository,
  syncRepository,
  getSettings,
  updatePackagistMirroring,
  type Repository,
} from '../lib/api';
import { CREDENTIAL_FIELD_DEFINITIONS, CREDENTIALS_BY_SOURCE_TYPE, type CredentialType } from '@package-broker/shared';
import { useAuth } from '../context/AuthContext';

export function Repositories() {
  const [showModal, setShowModal] = useState(false);
  const [editingRepository, setEditingRepository] = useState<Repository | null>(null);
  const queryClient = useQueryClient();

  const { data: repositories = [], isLoading } = useQuery({
    queryKey: ['repositories'],
    queryFn: getRepositories,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  // Filter repositories: only show Packagist when mirroring is enabled
  const mirroringEnabled = settings?.packagist_mirroring_enabled ?? true;
  const filteredRepositories = repositories.filter(
    (repo) => repo.id !== 'packagist' || mirroringEnabled
  );

  const deleteMutation = useMutation({
    mutationFn: deleteRepository,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: syncRepository,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] });
    },
  });

  const getStatusBadge = (status: Repository['status']) => {
    const styles = {
      active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      error: 'bg-red-500/20 text-red-400 border-red-500/30',
      pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      syncing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full border ${styles[status]}`}>
        {status}
      </span>
    );
  };

  const { isAdmin } = useAuth();

  return (
    <div className="space-y-8" data-testid="repositories-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-100 mb-2" data-testid="repositories-heading">Repositories</h2>
          <p className="text-slate-400">Manage your package sources. Packages are loaded on-demand when requested.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary"
            data-testid="add-repository-button"
            aria-label="Add new repository"
          >
            + Add Repository
          </button>
        )}
      </div>

      {/* Repositories List */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="w-8 h-8 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin mx-auto" />
          </div>
        ) : filteredRepositories.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No repositories configured yet. {isAdmin ? 'Add your first repository to get started.' : 'Ask an admin to configure repositories.'}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-800/50 border-b border-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  URL
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Last Tested
                </th>
                {isAdmin && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredRepositories.map((repo) => {
                const isPackagist = repo.id === 'packagist';
                return (
                  <tr key={repo.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-200 font-medium truncate max-w-xs">
                        {repo.url}
                        {isPackagist && (
                          <span className="ml-2 text-xs text-slate-500">(Public Packagist)</span>
                        )}
                      </div>
                      {repo.error_message && (
                        <div className="text-xs text-red-400 mt-1">{repo.error_message}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {repo.vcs_type} / {repo.credential_type}
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(repo.status)}</td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {repo.last_synced_at
                        ? new Date(repo.last_synced_at * 1000).toLocaleString()
                        : 'Never'}
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right space-x-3">
                        {!isPackagist && (
                          <>
                            <button
                              onClick={() => syncMutation.mutate(repo.id)}
                              disabled={syncMutation.isPending || repo.status === 'syncing'}
                              className="text-primary-400 hover:text-primary-300 text-sm disabled:opacity-50"
                              title="Test connection and validate credentials. Packages are loaded on-demand when requested."
                            >
                              {repo.status === 'syncing' ? 'Testing...' : 'Test'}
                            </button>
                            <button
                              onClick={() => setEditingRepository(repo)}
                              className="text-slate-400 hover:text-slate-200 text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Delete this repository?')) {
                                  deleteMutation.mutate(repo.id);
                                }
                              }}
                              className="text-red-400 hover:text-red-300 text-sm"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {isPackagist && (
                          <span className="text-xs text-slate-500 italic">Managed by system</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Public Packagist Mirroring Section */}
      <PackagistMirroringSection />

      {/* Add Repository Modal */}
      {showModal && (
        <AddRepositoryModal onClose={() => setShowModal(false)} />
      )}

      {/* Edit Repository Modal */}
      {editingRepository && (
        <EditRepositoryModal
          repository={editingRepository}
          onClose={() => setEditingRepository(null)}
        />
      )}
    </div>
  );
}


function AddRepositoryModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [sourceType, setSourceType] = useState<'git' | 'composer'>('composer');
  const [credentialType, setCredentialType] = useState<CredentialType>('http_basic');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [composerJsonPath, setComposerJsonPath] = useState('');
  const [packageFilter, setPackageFilter] = useState('');

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: createRepository,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] });
      onClose();
    },
  });

  // Get allowed credential types for current source type
  const allowedCredentialTypes = CREDENTIALS_BY_SOURCE_TYPE[sourceType] || [];
  const credentialFields = CREDENTIAL_FIELD_DEFINITIONS[credentialType]?.fields || [];

  // Handle source type change - reset credential type to first valid option
  const handleSourceTypeChange = (newSourceType: 'git' | 'composer') => {
    setSourceType(newSourceType);
    const allowed = CREDENTIALS_BY_SOURCE_TYPE[newSourceType] || [];
    if (allowed.length > 0 && !allowed.includes(credentialType)) {
      setCredentialType(allowed[0]);
      setCredentials({});
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      url,
      vcs_type: sourceType,
      credential_type: credentialType,
      auth_credentials: credentials,
      composer_json_path: composerJsonPath || undefined,
      package_filter: packageFilter || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="card max-w-lg w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-xl font-bold text-slate-100">Add Repository</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Repository URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo or https://composer.example.com"
              className="input w-full"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Source Type</label>
              <select
                value={sourceType}
                onChange={(e) => handleSourceTypeChange(e.target.value as 'git' | 'composer')}
                className="input w-full"
              >
                <option value="composer">Composer Repository</option>
                <option value="git">Git Repository</option>
              </select>
            </div>

            <div>
              <label className="label">Credential Type</label>
              <select
                value={credentialType}
                onChange={(e) => {
                  setCredentialType(e.target.value as CredentialType);
                  setCredentials({});
                }}
                className="input w-full"
              >
                {allowedCredentialTypes.map((type) => (
                  <option key={type} value={type}>
                    {CREDENTIAL_FIELD_DEFINITIONS[type]?.label || type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dynamic credential fields */}
          {credentialFields.map((field) => (
            <div key={field.name}>
              <label className="label">{field.label}</label>
              <input
                type={field.type}
                value={credentials[field.name] || ''}
                onChange={(e) =>
                  setCredentials((prev) => ({ ...prev, [field.name]: e.target.value }))
                }
                className="input w-full"
                required
              />
            </div>
          ))}

          {sourceType === 'git' && (
            <div>
              <label className="label">Composer.json Path (optional)</label>
              <input
                type="text"
                value={composerJsonPath}
                onChange={(e) => setComposerJsonPath(e.target.value)}
                placeholder="**/composer.json"
                className="input w-full"
              />
              <p className="text-xs text-slate-500 mt-1">
                Glob pattern to find composer.json files. Default: **/composer.json
              </p>
            </div>
          )}

          {sourceType === 'composer' && (
            <div>
              <label className="label">Package Filter (optional)</label>
              <input
                type="text"
                value={packageFilter}
                onChange={(e) => setPackageFilter(e.target.value)}
                placeholder="vendor/package1, vendor/package2"
                className="input w-full"
              />
              <p className="text-xs text-slate-500 mt-1">
                Comma-separated list of packages to filter. Optional - leave empty to allow all packages.
                Packages are loaded on-demand when requested by Composer.
              </p>
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
              {createMutation.isPending ? 'Adding...' : 'Add Repository'}
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

function EditRepositoryModal({ repository, onClose }: { repository: Repository; onClose: () => void }) {
  const [url, setUrl] = useState(repository.url);
  const [sourceType, setSourceType] = useState<'git' | 'composer'>(repository.vcs_type as 'git' | 'composer');
  const [credentialType, setCredentialType] = useState<CredentialType>(repository.credential_type as CredentialType);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [composerJsonPath, setComposerJsonPath] = useState(repository.composer_json_path || '');
  const [packageFilter, setPackageFilter] = useState(repository.package_filter || '');

  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateRepository>[1]) => updateRepository(repository.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] });
      onClose();
    },
  });

  // Get allowed credential types for current source type
  const allowedCredentialTypes = CREDENTIALS_BY_SOURCE_TYPE[sourceType] || [];
  const credentialFields = CREDENTIAL_FIELD_DEFINITIONS[credentialType]?.fields || [];

  // Handle source type change - reset credential type to first valid option
  const handleSourceTypeChange = (newSourceType: 'git' | 'composer') => {
    setSourceType(newSourceType);
    const allowed = CREDENTIALS_BY_SOURCE_TYPE[newSourceType] || [];
    if (allowed.length > 0 && !allowed.includes(credentialType)) {
      setCredentialType(allowed[0]);
      setCredentials({});
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Build update payload with only changed fields
    const updateData: Parameters<typeof updateRepository>[1] = {};

    if (url !== repository.url) {
      updateData.url = url;
    }
    if (sourceType !== repository.vcs_type) {
      updateData.vcs_type = sourceType;
    }
    if (credentialType !== repository.credential_type) {
      updateData.credential_type = credentialType;
    }
    // Only include credentials if user has filled in any field
    const hasCredentials = Object.values(credentials).some((v) => v.trim() !== '');
    if (hasCredentials) {
      updateData.auth_credentials = credentials;
    }
    if (composerJsonPath !== (repository.composer_json_path || '')) {
      updateData.composer_json_path = composerJsonPath || undefined;
    }
    if (packageFilter !== (repository.package_filter || '')) {
      updateData.package_filter = packageFilter || undefined;
    }

    // Only submit if there are changes
    if (Object.keys(updateData).length === 0) {
      onClose();
      return;
    }

    updateMutation.mutate(updateData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="card max-w-lg w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-xl font-bold text-slate-100">Edit Repository</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Repository URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo or https://composer.example.com"
              className="input w-full"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Source Type</label>
              <select
                value={sourceType}
                onChange={(e) => handleSourceTypeChange(e.target.value as 'git' | 'composer')}
                className="input w-full"
              >
                <option value="composer">Composer Repository</option>
                <option value="git">Git Repository</option>
              </select>
            </div>

            <div>
              <label className="label">Credential Type</label>
              <select
                value={credentialType}
                onChange={(e) => {
                  setCredentialType(e.target.value as CredentialType);
                  setCredentials({});
                }}
                className="input w-full"
              >
                {allowedCredentialTypes.map((type) => (
                  <option key={type} value={type}>
                    {CREDENTIAL_FIELD_DEFINITIONS[type]?.label || type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dynamic credential fields */}
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Leave credential fields empty to keep current values.
            </p>
            {credentialFields.map((field) => (
              <div key={field.name}>
                <label className="label">{field.label}</label>
                <input
                  type={field.type}
                  value={credentials[field.name] || ''}
                  onChange={(e) =>
                    setCredentials((prev) => ({ ...prev, [field.name]: e.target.value }))
                  }
                  placeholder="Leave empty to keep current"
                  className="input w-full"
                />
              </div>
            ))}
          </div>

          {sourceType === 'git' && (
            <div>
              <label className="label">Composer.json Path (optional)</label>
              <input
                type="text"
                value={composerJsonPath}
                onChange={(e) => setComposerJsonPath(e.target.value)}
                placeholder="**/composer.json"
                className="input w-full"
              />
              <p className="text-xs text-slate-500 mt-1">
                Glob pattern to find composer.json files. Default: **/composer.json
              </p>
            </div>
          )}

          {sourceType === 'composer' && (
            <div>
              <label className="label">Package Filter (optional)</label>
              <input
                type="text"
                value={packageFilter}
                onChange={(e) => setPackageFilter(e.target.value)}
                placeholder="vendor/package1, vendor/package2"
                className="input w-full"
              />
              <p className="text-xs text-slate-500 mt-1">
                Comma-separated list of packages to filter. Optional - leave empty to allow all packages.
                Packages are loaded on-demand when requested by Composer.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          {updateMutation.error && (
            <p className="text-red-400 text-sm">
              {(updateMutation.error as Error).message}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

/**
 * Public Packagist Mirroring Toggle Section
 */
function PackagistMirroringSection() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  const updateMutation = useMutation({
    mutationFn: updatePackagistMirroring,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const isEnabled = settings?.packagist_mirroring_enabled ?? true;

  const handleToggle = () => {
    if (!isAdmin) return;
    updateMutation.mutate(!isEnabled);
  };

  return (
    <div className="card p-6 mt-8">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold text-slate-100 mb-2">
            Public Packagist Mirroring
          </h3>
          <p className="text-slate-400 text-sm mb-4">
            When enabled, packages not found in your private repositories will be proxied from{' '}
            <a
              href="https://packagist.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-400 hover:underline"
            >
              packagist.org
            </a>
            . This allows Composer to resolve public dependencies through this proxy.
          </p>
          <div className="bg-slate-800/50 rounded-lg p-4 text-sm">
            <p className="text-slate-300 mb-2">
              <strong>When to disable:</strong>
            </p>
            <ul className="list-disc list-inside text-slate-400 space-y-1">
              <li>You're using Magento Marketplace or another private repository as your primary source</li>
              <li>You want to ensure only private packages are served by this proxy</li>
              <li>You have a separate Packagist mirror configured in your Composer</li>
            </ul>
          </div>
        </div>

        <div className="ml-8 flex flex-col items-center">
          <button
            onClick={handleToggle}
            disabled={isLoading || updateMutation.isPending || !isAdmin}
            className={`relative inline-flex h-7 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 ${isEnabled ? 'bg-primary-600' : 'bg-slate-700'
              }`}
            role="switch"
            aria-checked={isEnabled}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isEnabled ? 'translate-x-7' : 'translate-x-0'
                }`}
            />
          </button>
          <span className="mt-2 text-xs text-slate-500">
            {isLoading ? 'Loading...' : isEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </div>

      {updateMutation.isError && (
        <p className="text-red-400 text-sm mt-4">
          Failed to update setting: {(updateMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}

