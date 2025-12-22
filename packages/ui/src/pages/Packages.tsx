import { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { Package as PackageIcon, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import semver from 'semver';
import { getPackages, type Package, getRepositories, getSettings, addPackagesFromMirror, type Repository } from '../lib/api';

const STORAGE_KEY = 'composer_proxy_admin_token';

function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(STORAGE_KEY);
  }
  return null;
}

function DownloadButton({ distUrl }: { distUrl: string }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDownloading(true);
    setError(null);

    try {
      // Include Bearer token for authenticated download
      const token = getAuthToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(distUrl, { headers });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = distUrl.split('/').pop() || 'package.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={handleDownload}
          className="text-red-400 hover:text-red-300 text-sm"
          data-testid="download-button"
        >
          Retry
        </button>
        <span className="text-xs text-red-500">{error}</span>
      </div>
    );
  }

  return (
    <button
      onClick={handleDownload}
      disabled={isDownloading}
      className="text-primary-400 hover:text-primary-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      data-testid="download-button"
    >
      {isDownloading ? 'Downloading...' : 'Download'}
    </button>
  );
}

export function Packages() {
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Only fetch if search is at least 3 chars
  const shouldFetch = search.length >= 3;

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ['packages', search],
    queryFn: () => getPackages(search || undefined),
    enabled: shouldFetch,
  });

  // Group packages by name
  const groupedPackages = packages.reduce(
    (acc, pkg) => {
      if (!acc[pkg.name]) {
        acc[pkg.name] = [];
      }
      acc[pkg.name].push(pkg);
      return acc;
    },
    {} as Record<string, Package[]>
  );

  return (
    <div className="space-y-8" data-testid="packages-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-100 mb-2" data-testid="packages-heading">Packages</h2>
          <p className="text-slate-400">Browse cached packages</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-72">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search packages (min 3 chars)..."
              className="input w-full"
              data-testid="package-search-input"
              aria-label="Search packages"
            />
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary"
            data-testid="add-packages-button"
          >
            Add Package
          </button>
        </div>
      </div>

      {showAddModal && <AddPackagesModal onClose={() => setShowAddModal(false)} />}

      {/* Packages List */}
      <div className="space-y-4" data-testid="packages-list">
        {!shouldFetch ? (
          <div className="card p-8 text-center text-slate-400" data-testid="packages-instruction">
            Type at least 3 letters to see matching packages.
          </div>
        ) : isLoading ? (
          <div className="card p-8 text-center" data-testid="packages-loading">
            <div className="w-8 h-8 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin mx-auto" aria-label="Loading packages" />
          </div>
        ) : Object.keys(groupedPackages).length === 0 ? (
          <div className="card p-8 text-center text-slate-400" data-testid="packages-empty" role="status" aria-live="polite">
            No packages found matching your search.
          </div>
        ) : (
          Object.entries(groupedPackages).map(([name, versions]) => (
            <PackageCard key={name} name={name} versions={versions} />
          ))
        )}
      </div>
    </div>
  );
}

function PackageCard({ name, versions }: { name: string; versions: Package[] }) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Sort versions by semantic version (highest first)
  const sortedVersions = useMemo(() => {
    return [...versions].sort((a, b) => {
      // Check if versions are pure integers (e.g., "9", "84")
      const aIsPureInt = /^\d+$/.test(a.version);
      const bIsPureInt = /^\d+$/.test(b.version);

      // If both are pure integers, compare numerically (highest first)
      if (aIsPureInt && bIsPureInt) {
        const aNum = parseInt(a.version, 10);
        const bNum = parseInt(b.version, 10);
        return bNum - aNum; // Descending order
      }

      // If one is pure integer and the other is semver, prefer semver
      if (aIsPureInt && !bIsPureInt) {
        const bValid = semver.valid(b.version);
        if (bValid) return 1; // Semver comes first
      }
      if (!aIsPureInt && bIsPureInt) {
        const aValid = semver.valid(a.version);
        if (aValid) return -1; // Semver comes first
      }

      // Both are semver - use semver comparison
      const aValid = semver.valid(a.version);
      const bValid = semver.valid(b.version);

      if (aValid && bValid) {
        return semver.rcompare(a.version, b.version);
      }

      // One is valid semver - prefer it
      if (aValid && !bValid) {
        return -1;
      }
      if (!aValid && bValid) {
        return 1;
      }

      // Try to extract leading numbers for comparison
      const aMatch = a.version.match(/^(\d+)/);
      const bMatch = b.version.match(/^(\d+)/);

      if (aMatch && bMatch) {
        const aLeading = parseInt(aMatch[1], 10);
        const bLeading = parseInt(bMatch[1], 10);
        if (aLeading !== bLeading) {
          return bLeading - aLeading; // Descending order
        }
      }

      // Fallback to string comparison (descending) with numeric awareness
      return b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [versions]);

  const latestVersion = sortedVersions[0];
  const displayedVersions = showAll ? sortedVersions : sortedVersions.slice(0, 5);
  const hasMoreVersions = sortedVersions.length > 5;

  // Parse license (can be JSON string or null)
  const parseLicense = (license: string | null): string[] => {
    if (!license) return [];
    try {
      const parsed = JSON.parse(license);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [license];
    }
  };

  const licenses = parseLicense(latestVersion.license);

  return (
    <div className="card" data-testid="package-card" data-package-name={name}>
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/30"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
        aria-label={`${name} package, ${versions.length} versions`}
        data-testid="package-header"
      >
        <div className="flex items-center gap-4 flex-1">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500/20 to-accent-500/20 rounded-lg flex items-center justify-center">
            <PackageIcon className="w-5 h-5 text-primary-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link
                to={(() => {
                  const [vendor, ...packageParts] = name.split('/');
                  const packageName = packageParts.join('/');
                  return `/packages/${vendor}/${packageName}`;
                })()}
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-slate-100 hover:text-primary-400 transition-colors"
              >
                {name}
              </Link>
              {latestVersion.package_type && (
                <span className="px-2 py-0.5 text-xs bg-slate-700 text-slate-300 rounded">
                  {latestVersion.package_type}
                </span>
              )}
              {licenses.length > 0 && (
                <span className="px-2 py-0.5 text-xs bg-slate-700 text-slate-300 rounded">
                  {licenses[0]}
                </span>
              )}
            </div>
            {latestVersion.description && (
              <p className="text-sm text-slate-400 truncate mb-1">
                {latestVersion.description}
              </p>
            )}
            <p className="text-sm text-slate-500">
              {versions.length} version{versions.length !== 1 ? 's' : ''} • Latest:{' '}
              <span className="text-primary-400">{latestVersion.version}</span>
            </p>
          </div>
        </div>
        <span className="text-slate-400" aria-hidden="true" data-testid="package-expand-toggle">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 p-4" role="region" aria-label={`Versions for ${name}`}>
          <h4 className="text-sm font-medium text-slate-400 mb-3">Versions</h4>
          <div className="space-y-2" role="list">
            {displayedVersions.map((version) => (
              <div
                key={version.id}
                className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg"
                data-testid="version-row"
                data-version={version.version}
                role="listitem"
              >
                <div>
                  <span className="font-medium text-slate-200">{version.version}</span>
                  {version.released_at && (
                    <span className="text-sm text-slate-500 ml-2" aria-label={`Released ${new Date(version.released_at * 1000).toLocaleDateString()}`}>
                      Released {new Date(version.released_at * 1000).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <DownloadButton distUrl={version.dist_url} />
              </div>
            ))}
          </div>
          {hasMoreVersions && !showAll && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowAll(true);
              }}
              className="mt-3 text-sm text-primary-400 hover:text-primary-300"
              data-testid="show-all-versions-button"
              aria-label="Show all versions"
            >
              Show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AddPackagesModal({ onClose }: { onClose: () => void }) {
  const [packageNames, setPackageNames] = useState('');
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string>('');
  const queryClient = useQueryClient();

  // Get repositories and settings
  const { data: repositories = [] } = useQuery({
    queryKey: ['repositories'],
    queryFn: getRepositories,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  // Filter to only composer repositories, and add Packagist if enabled
  const availableRepositories = useMemo(() => {
    const composerRepos = repositories.filter(
      (repo) => repo.vcs_type === 'composer' && repo.status === 'active'
    );

    const repos: Array<Repository & { displayName: string }> = composerRepos
      .filter(repo => {
        // Exclude manual Packagist repo if mirroring is enabled to avoid duplicates
        if (settings?.packagist_mirroring_enabled && repo.url === 'https://repo.packagist.org') {
          return false;
        }
        return true;
      })
      .map((repo) => ({
        ...repo,
        displayName: repo.url,
      }));

    // Add Packagist if mirroring is enabled
    if (settings?.packagist_mirroring_enabled) {
      repos.unshift({
        id: 'packagist',
        url: 'https://repo.packagist.org',
        vcs_type: 'composer',
        credential_type: 'none',
        composer_json_path: null,
        package_filter: null,
        status: 'active',
        error_message: null,
        last_synced_at: null,
        created_at: 0,
        displayName: 'Packagist.org',
      });
    }

    return repos;
  }, [repositories, settings]);

  // Set default repository to first available (usually Packagist if enabled)
  useMemo(() => {
    if (availableRepositories.length > 0 && !selectedRepositoryId) {
      setSelectedRepositoryId(availableRepositories[0].id);
    }
  }, [availableRepositories, selectedRepositoryId]);

  const addMutation = useMutation({
    mutationFn: (data: { repositoryId: string; packageNames: string[] }) =>
      addPackagesFromMirror(data.repositoryId, data.packageNames),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Parse package names (comma, space, or newline separated)
    const names = packageNames
      .split(/[,\s\n]+/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    if (names.length === 0) {
      return;
    }

    if (!selectedRepositoryId) {
      return;
    }

    addMutation.mutate({
      repositoryId: selectedRepositoryId,
      packageNames: names,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="card max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-xl font-bold text-slate-100">Add Mirrored Package(s)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Package name(s), separated by comma, spaces or newlines</label>
            <textarea
              value={packageNames}
              onChange={(e) => setPackageNames(e.target.value)}
              placeholder="vendor/package1&#10;vendor/package2&#10;vendor/package3"
              className="input w-full min-h-[120px] resize-y font-mono text-sm"
              required
            />
          </div>

          <div>
            <label className="label">Mirrored Repository</label>
            <select
              value={selectedRepositoryId}
              onChange={(e) => setSelectedRepositoryId(e.target.value)}
              className="input w-full"
              required
            >
              {availableRepositories.length === 0 ? (
                <option value="">No repositories available</option>
              ) : (
                availableRepositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.displayName}
                  </option>
                ))
              )}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              You can set up mirrored third party repositories on the settings page.
            </p>
          </div>

          {addMutation.error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3">
              <p className="text-red-400 text-sm">
                {(addMutation.error as Error).message}
              </p>
            </div>
          )}

          {addMutation.data && (
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-slate-200 text-sm mb-2">{addMutation.data.message}</p>
              <div className="space-y-1 text-xs">
                {addMutation.data.results.map((result, idx) => (
                  <div key={idx} className={result.success ? 'text-green-400' : 'text-red-400'}>
                    {result.package}: {result.success
                      ? `✓ ${result.versions} version(s) stored`
                      : `✗ ${result.error}`}
                  </div>
                ))}
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
              disabled={addMutation.isPending || availableRepositories.length === 0}
            >
              {addMutation.isPending ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

