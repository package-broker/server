import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { Package as PackageIcon, X, Upload, Package2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import semver from 'semver';
import { getPackages, type Package, getRepositories, getSettings, addPackagesFromMirror, uploadPackage, deletePackageVersion, type Repository } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';

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

const ITEMS_PER_PAGE = 20;

export function Packages() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);

  // Debounce search input by 500ms
  const debouncedSearch = useDebounce(search, 500);

  // Reset to page 1 when search changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['packages', debouncedSearch, page],
    queryFn: () => getPackages({ 
      search: debouncedSearch || undefined, 
      page, 
      limit: ITEMS_PER_PAGE 
    }),
  });

  const packages = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: ITEMS_PER_PAGE, total: 0, totalPages: 0 };

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

  const handlePreviousPage = () => {
    if (page > 1) {
      setPage(page - 1);
    }
  };

  const handleNextPage = () => {
    if (page < pagination.totalPages) {
      setPage(page + 1);
    }
  };

  return (
    <div className="space-y-8" data-testid="packages-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-100 mb-2" data-testid="packages-heading">Packages</h2>
          <p className="text-slate-400">Browse cached packages</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-72 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search packages..."
              className="input w-full"
              data-testid="package-search-input"
              aria-label="Search packages"
            />
            {/* Show loading indicator when search is being debounced */}
            {search !== debouncedSearch && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
              </div>
            )}
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

      {showAddModal && <AddPackagesModal onClose={() => setShowAddModal(false)} onSuccess={(packageName) => setSearch(packageName)} />}

      {/* Packages List */}
      <div className="space-y-4" data-testid="packages-list">
        {isLoading ? (
          <div className="card p-8 text-center" data-testid="packages-loading">
            <div className="w-8 h-8 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin mx-auto" aria-label="Loading packages" />
          </div>
        ) : Object.keys(groupedPackages).length === 0 ? (
          <div className="card p-8 text-center text-slate-400" data-testid="packages-empty" role="status" aria-live="polite">
            No packages found matching your search.
          </div>
        ) : (
          <>
            {Object.entries(groupedPackages).map(([name, versions]) => (
              <PackageCard key={name} name={name} versions={versions} />
            ))}

            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <div className="text-sm text-slate-400">
                  Showing {((page - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(page * ITEMS_PER_PAGE, pagination.total)} of {pagination.total} packages
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePreviousPage}
                    disabled={page === 1 || isFetching}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous page"
                    data-testid="pagination-prev"
                  >
                    <ChevronLeft className="w-5 h-5 text-slate-300" />
                  </button>
                  <span className="px-4 py-2 text-sm text-slate-300">
                    Page {page} of {pagination.totalPages}
                  </span>
                  <button
                    onClick={handleNextPage}
                    disabled={page === pagination.totalPages || isFetching}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="Next page"
                    data-testid="pagination-next"
                  >
                    <ChevronRight className="w-5 h-5 text-slate-300" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PackageCard({ name, versions }: { name: string; versions: Package[] }) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: ({ packageName, version }: { packageName: string; version: string }) =>
      deletePackageVersion(packageName, version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
      setDeleteConfirm(null);
    },
  });

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
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500/20 to-accent-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
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
                className="font-medium text-slate-100 hover:text-primary-400 transition-colors truncate"
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
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-medium text-slate-200">{version.version}</span>
                  {version.released_at && (
                    <span className="text-sm text-slate-500" aria-label={`Released ${new Date(version.released_at * 1000).toLocaleDateString()}`}>
                      {new Date(version.released_at * 1000).toLocaleDateString()}
                    </span>
                  )}
                  {version.is_manual_upload === 1 && (
                    <span className="px-2 py-0.5 text-xs bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded">
                      📤 Manual
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <DownloadButton distUrl={version.dist_url} />
                  {deleteConfirm === version.version ? (
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate({ packageName: name, version: version.version });
                        }}
                        disabled={deleteMutation.isPending}
                        className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50"
                        title="Confirm delete"
                      >
                        {deleteMutation.isPending ? '...' : 'Delete'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(null);
                        }}
                        className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded"
                        title="Cancel"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(version.version);
                      }}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                      title="Delete this version"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {deleteMutation.isError && (
              <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : 'Failed to delete'}
              </div>
            )}
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

function AddPackagesModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (packageName: string) => void }) {
  const [mode, setMode] = useState<'fetch' | 'upload'>('fetch');
  const [packageNames, setPackageNames] = useState('');
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
      
      if (data.summary.failed === 0 && data.summary.succeeded > 0) {
        const firstSuccess = data.results.find(r => r.success);
        if (firstSuccess) {
          onSuccess(firstSuccess.package);
        }
        onClose();
      }
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPackage(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
      setSelectedFile(null);
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'fetch') {
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
    } else {
      // Upload mode
      if (!selectedFile) {
        return;
      }

      uploadMutation.mutate(selectedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.zip')) {
        setSelectedFile(file);
      } else {
        alert('Please upload a ZIP file');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="card max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-xl font-bold text-slate-100">Add Package</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-700">
          <button
            onClick={() => setMode('fetch')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              mode === 'fetch'
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Package2 className="w-4 h-4" />
              Fetch from Repository
            </div>
          </button>
          <button
            onClick={() => setMode('upload')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              mode === 'upload'
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload Package
            </div>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'fetch' ? (
            <>
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

              {addMutation.data && addMutation.data.summary.failed > 0 && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
                  <p className="text-red-400 text-sm font-medium mb-2">
                    {addMutation.data.summary.failed} of {addMutation.data.summary.total} package(s) failed
                  </p>
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
            </>
          ) : (
            <>
              {/* Upload mode */}
              <div>
                <label className="label">Package Archive (ZIP)</label>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    isDragging
                      ? 'border-primary-500 bg-primary-500/10'
                      : 'border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
                  {selectedFile ? (
                    <div>
                      <p className="text-slate-200 font-medium mb-1">{selectedFile.name}</p>
                      <p className="text-slate-400 text-sm mb-4">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <button
                        type="button"
                        onClick={() => setSelectedFile(null)}
                        className="text-primary-400 hover:text-primary-300 text-sm"
                      >
                        Choose different file
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-slate-200 mb-2">
                        Drag and drop a ZIP file here, or click to browse
                      </p>
                      <input
                        type="file"
                        accept=".zip"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-upload"
                      />
                      <label
                        htmlFor="file-upload"
                        className="inline-block px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg cursor-pointer text-sm"
                      >
                        Browse Files
                      </label>
                      <p className="text-slate-500 text-xs mt-2">
                        Maximum file size: 100MB
                      </p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  The ZIP archive must contain a valid composer.json file in the root or first-level directory.
                </p>
              </div>

              {uploadMutation.error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3">
                  <p className="text-red-400 text-sm whitespace-pre-wrap">
                    {(uploadMutation.error as Error).message}
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={
                mode === 'fetch'
                  ? addMutation.isPending || availableRepositories.length === 0
                  : uploadMutation.isPending || !selectedFile
              }
            >
              {mode === 'fetch'
                ? addMutation.isPending ? 'Adding...' : 'Add'
                : uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

