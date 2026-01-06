import { useState, useMemo, useEffect } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import semver from 'semver';
import { getPackage, getPackageReadme, getPackageChangelog, getPackageStats, deletePackageVersion, type Package } from '../lib/api';

const STORAGE_KEY = 'composer_proxy_admin_token';

function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(STORAGE_KEY);
  }
  return null;
}

function DownloadButton({ distUrl, version }: { distUrl: string; version: string }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDownloading(true);
    setError(null);

    try {
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
      className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isDownloading ? 'Downloading...' : `Download ${version}`}
    </button>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 hover:text-slate-100 transition-colors flex items-center gap-2"
      title={copied ? 'Copied!' : `Copy ${label || 'command'}`}
    >
      {copied ? (
        <>
          <span>✓</span>
          <span>Copied!</span>
        </>
      ) : (
        <>
          <span>📋</span>
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

export function PackageDetail() {
  const { vendor, package: packageName } = useParams<{ vendor: string; package: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // Combine vendor and package name
  const fullPackageName = vendor && packageName ? `${vendor}/${packageName}` : null;
  
  // Read version from hash fragment (format: #version--0.0.0)
  const getVersionFromHash = () => {
    const hash = location.hash;
    if (hash.startsWith('#version--')) {
      return hash.replace('#version--', '');
    }
    return null;
  };
  
  const [selectedVersion, setSelectedVersion] = useState<string | null>(getVersionFromHash());
  const [readmeExpanded, setReadmeExpanded] = useState(false);
  const [changelogExpanded, setChangelogExpanded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null); // version to confirm delete
  
  // Update selectedVersion when hash changes
  useEffect(() => {
    const hashVersion = getVersionFromHash();
    if (hashVersion !== selectedVersion) {
      setSelectedVersion(hashVersion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash]);

  // Function to update hash when version changes
  const handleVersionChange = (version: string) => {
    setSelectedVersion(version);
    window.location.hash = `version--${version}`;
  };

  const { data: packageData, isLoading } = useQuery({
    queryKey: ['package', fullPackageName],
    queryFn: () => getPackage(fullPackageName!),
    enabled: !!fullPackageName,
  });

  // Sort versions by semantic version (highest first)
  const sortedVersions = useMemo(() => {
    if (!packageData?.versions) return [];
    return [...packageData.versions].sort((a, b) => {
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
  }, [packageData]);

  const currentVersion = useMemo(() => {
    if (!sortedVersions.length) return null;
    if (selectedVersion) {
      return sortedVersions.find(v => v.version === selectedVersion) || sortedVersions[0];
    }
    return sortedVersions[0];
  }, [sortedVersions, selectedVersion]);

  const { data: readme, isLoading: readmeLoading } = useQuery({
    queryKey: ['readme', fullPackageName, currentVersion?.version],
    queryFn: () => getPackageReadme(fullPackageName!, currentVersion!.version),
    enabled: !!fullPackageName && !!currentVersion,
  });

  // Only fetch CHANGELOG for the latest version (first in sorted list)
  const isLatestVersion = useMemo(() => {
    if (!sortedVersions.length || !currentVersion) return false;
    return currentVersion.version === sortedVersions[0].version;
  }, [sortedVersions, currentVersion]);

  const { data: changelog, isLoading: changelogLoading } = useQuery({
    queryKey: ['changelog', fullPackageName, currentVersion?.version],
    queryFn: () => getPackageChangelog(fullPackageName!, currentVersion!.version),
    enabled: !!fullPackageName && !!currentVersion && isLatestVersion,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats', fullPackageName, currentVersion?.version],
    queryFn: () => getPackageStats(fullPackageName!, currentVersion!.version),
    enabled: !!fullPackageName && !!currentVersion,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: ({ name, version }: { name: string; version: string }) => 
      deletePackageVersion(name, version),
    onSuccess: (_, { version }) => {
      // Invalidate package query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['package', fullPackageName] });
      queryClient.invalidateQueries({ queryKey: ['packages'] });
      setDeleteConfirm(null);
      
      // If we deleted the current version, switch to another or navigate away
      if (currentVersion?.version === version) {
        const remaining = sortedVersions.filter(v => v.version !== version);
        if (remaining.length > 0) {
          handleVersionChange(remaining[0].version);
        } else {
          // No versions left, go back to packages list
          navigate('/packages');
        }
      }
    },
  });

  // Parse license
  const parseLicense = (license: string | null): string[] => {
    if (!license) return [];
    try {
      const parsed = JSON.parse(license);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [license];
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!fullPackageName) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-400">Invalid package name</p>
        <Link to="/packages" className="text-primary-400 hover:text-primary-300 mt-4 inline-block">
          ← Back to packages
        </Link>
      </div>
    );
  }

  if (!packageData || !currentVersion) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-400">Package not found: {fullPackageName}</p>
        <Link to="/packages" className="text-primary-400 hover:text-primary-300 mt-4 inline-block">
          ← Back to packages
        </Link>
      </div>
    );
  }

  const licenses = parseLicense(currentVersion.license);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="font-display text-3xl font-bold text-slate-100">
                {packageData.name}
              </h1>
              <select
                value={selectedVersion || currentVersion.version}
                onChange={(e) => handleVersionChange(e.target.value)}
                className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              >
                {sortedVersions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}{v.is_manual_upload ? ' (manual)' : ''}
                  </option>
                ))}
              </select>
              {currentVersion.is_manual_upload === 1 && (
                <span className="px-2.5 py-1 text-xs font-medium bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-full">
                  📤 Manual Upload
                </span>
              )}
            </div>
            {currentVersion.description && (
              <p className="text-slate-300 text-lg">{currentVersion.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* README Column */}
        <div className="lg:col-span-2">
          <div className="card p-6">
            <h2 className="text-xl font-bold text-slate-100 mb-4">README.md</h2>
            {readmeLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
              </div>
            ) : readme ? (
              <>
                <div className={`prose prose-invert max-w-none ${!readmeExpanded ? 'max-h-[300px] overflow-hidden relative' : ''}`}>
                  {!readmeExpanded && (
                    <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none" />
                  )}
                  <div className="markdown-content">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node, ...props }) => (
                          <a {...props} className="text-primary-400 hover:text-primary-300" target="_blank" rel="noopener noreferrer" />
                        ),
                        code: ({ node, className, children, ...props }: any) => {
                          const isInline = !className;
                          return isInline ? (
                            <code className="px-1.5 py-0.5 bg-slate-800 rounded text-sm text-primary-300" {...props}>
                              {children}
                            </code>
                          ) : (
                            <code className="block p-4 bg-slate-900 rounded-lg overflow-x-auto text-sm" {...props}>
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {readme}
                    </ReactMarkdown>
                  </div>
                </div>
                {!readmeExpanded && (
                  <button
                    onClick={() => setReadmeExpanded(true)}
                    className="mt-4 text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors"
                  >
                    Expand full README →
                  </button>
                )}
                {readmeExpanded && (
                  <button
                    onClick={() => setReadmeExpanded(false)}
                    className="mt-4 text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors"
                  >
                    Collapse README ↑
                  </button>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-slate-500">
                <p className="mb-2">📄 No README available for this version</p>
                <p className="text-sm text-slate-600">
                  No README file exists in this package version
                </p>
              </div>
            )}
          </div>

          {/* CHANGELOG Section - Only for latest version */}
          {isLatestVersion && (
            <div className="card p-6 mt-6">
              <h2 className="text-xl font-bold text-slate-100 mb-4">CHANGELOG</h2>
              {changelogLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
                </div>
              ) : changelog ? (
                <>
                  <div className={`prose prose-invert max-w-none ${!changelogExpanded ? 'max-h-[300px] overflow-hidden relative' : ''}`}>
                    {!changelogExpanded && (
                      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none" />
                    )}
                    <div className="markdown-content">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node, ...props }) => (
                            <a {...props} className="text-primary-400 hover:text-primary-300" target="_blank" rel="noopener noreferrer" />
                          ),
                          code: ({ node, className, children, ...props }: any) => {
                            const isInline = !className;
                            return isInline ? (
                              <code className="px-1.5 py-0.5 bg-slate-800 rounded text-sm text-primary-300" {...props}>
                                {children}
                              </code>
                            ) : (
                              <code className="block p-4 bg-slate-900 rounded-lg overflow-x-auto text-sm" {...props}>
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {changelog}
                      </ReactMarkdown>
                    </div>
                  </div>
                  {!changelogExpanded && (
                    <button
                      onClick={() => setChangelogExpanded(true)}
                      className="mt-4 text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors"
                    >
                      Expand full CHANGELOG →
                    </button>
                  )}
                  {changelogExpanded && (
                    <button
                      onClick={() => setChangelogExpanded(false)}
                      className="mt-4 text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors"
                    >
                      Collapse CHANGELOG ↑
                    </button>
                  )}
                </>
              ) : (
                <div className="text-center py-12 text-slate-500">
                  <p className="mb-2">📝 No CHANGELOG available</p>
                  <p className="text-sm text-slate-600">
                    No CHANGELOG file exists in this package version
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Get Package */}
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">Get Package</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Install via Composer</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-primary-300 font-mono break-all">
                    composer require {packageData.name}:{currentVersion.version}
                  </code>
                  <CopyButton text={`composer require ${packageData.name}:${currentVersion.version}`} />
                </div>
              </div>
              <div className="pt-2 border-t border-slate-700">
                <DownloadButton distUrl={currentVersion.dist_url} version={currentVersion.version} />
              </div>
            </div>
          </div>

          {/* About Package */}
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">About Package</h3>
            <div className="space-y-4">
              {currentVersion.package_type && (
                <div>
                  <span className="text-sm text-slate-400 block mb-1">Type</span>
                  <span className="px-3 py-1 text-sm bg-slate-700 text-slate-200 rounded-lg inline-block">
                    {currentVersion.package_type}
                  </span>
                </div>
              )}
              {licenses.length > 0 && (
                <div>
                  <span className="text-sm text-slate-400 block mb-1">License</span>
                  <span className="px-3 py-1 text-sm bg-slate-700 text-slate-200 rounded-lg inline-block">
                    {licenses.join(', ')}
                  </span>
                </div>
              )}
              {currentVersion.homepage && (
                <div>
                  <span className="text-sm text-slate-400 block mb-1">Homepage</span>
                  <a
                    href={currentVersion.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-primary-400 hover:text-primary-300 transition-colors text-sm min-w-0"
                  >
                    <span className="flex-shrink-0">🌐</span>
                    <span className="truncate block min-w-0">{currentVersion.homepage}</span>
                    <span className="text-slate-500 flex-shrink-0">→</span>
                  </a>
                </div>
              )}
              <div className="pt-2 border-t border-slate-700 space-y-2">
                <span className="text-sm text-slate-400 block mb-1">Statistics</span>
                {statsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <div className="w-4 h-4 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
                    <span>Loading stats...</span>
                  </div>
                ) : stats ? (
                  <>
                    <div className="text-sm">
                      <span className="text-slate-400">Downloads: </span>
                      <span className="text-slate-200 font-medium">{stats.downloads.toLocaleString()}</span>
                    </div>
                    {stats.lastDownloadedAt ? (
                      <div className="text-sm">
                        <span className="text-slate-400">Last downloaded: </span>
                        <span className="text-slate-200">
                          {new Date(stats.lastDownloadedAt * 1000).toLocaleDateString()}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">
                        Never downloaded
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-slate-500">
                    No download statistics available
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Versions */}
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">
              Versions ({sortedVersions.length})
            </h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {sortedVersions.map((v) => (
                <div
                  key={v.version}
                  className={`px-3 py-2 rounded-lg transition-colors ${
                    (selectedVersion || currentVersion.version) === v.version
                      ? 'bg-primary-500/20'
                      : 'bg-slate-800/50 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleVersionChange(v.version)}
                      className={`flex-1 text-left font-medium ${
                        (selectedVersion || currentVersion.version) === v.version
                          ? 'text-primary-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {v.version}
                    </button>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {v.is_manual_upload === 1 && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-blue-600/20 text-blue-400 rounded" title="Manually uploaded">
                          📤
                        </span>
                      )}
                      {v.released_at && (
                        <span className="text-xs text-slate-500">
                          {new Date(v.released_at * 1000).toLocaleDateString()}
                        </span>
                      )}
                      {/* Delete button */}
                      {deleteConfirm === v.version ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => deleteMutation.mutate({ name: fullPackageName!, version: v.version })}
                            disabled={deleteMutation.isPending}
                            className="px-2 py-0.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50"
                            title="Confirm delete"
                          >
                            {deleteMutation.isPending ? '...' : '✓'}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-2 py-0.5 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded"
                            title="Cancel"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(v.version);
                          }}
                          className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                          title="Delete this version"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {deleteMutation.isError && (
              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : 'Failed to delete'}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}


