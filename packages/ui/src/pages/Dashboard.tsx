import { useQuery } from '@tanstack/react-query';
import { Package, ClipboardList, Download } from 'lucide-react';
import { getStats } from '../lib/api';
import { SponsorshipBanner } from '../components/SponsorshipBanner';

export function Dashboard() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const cards = [
    {
      title: 'Active Repositories',
      value: stats?.active_repos ?? 0,
      icon: Package,
      color: 'from-primary-500 to-primary-700',
    },
    {
      title: 'Cached Packages',
      value: stats?.cached_packages ?? 0,
      icon: ClipboardList,
      color: 'from-accent-500 to-accent-700',
    },
    {
      title: 'Total Downloads',
      value: stats?.total_downloads ?? 0,
      icon: Download,
      color: 'from-emerald-500 to-emerald-700',
    },
  ];

  if (error) {
    return (
      <div className="card p-6">
        <p className="text-red-400">Error loading stats: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-100 mb-2" data-testid="dashboard-heading">Dashboard</h2>
        <p className="text-slate-400">Overview of your Composer proxy</p>
      </div>

      {/* Sponsorship Banner */}
      <SponsorshipBanner />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6" data-testid="stats-cards">
        {cards.map((card) => (
          <div key={card.title} className="card p-6" data-testid={`stat-card-${card.title.toLowerCase().replace(/\s+/g, '-')}`}>
            <div className="flex items-center justify-between mb-4">
              <div
                className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center shadow-lg`}
              >
                <card.icon className="w-6 h-6 text-white" />
              </div>
              {isLoading && (
                <div className="w-6 h-6 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" aria-label="Loading" />
              )}
            </div>
            <p className="text-slate-400 text-sm mb-1">{card.title}</p>
            <p className="font-display text-3xl font-bold text-slate-100">
              {isLoading ? '...' : card.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Quick Start */}
      <div className="card p-6" data-testid="quick-start-section">
        <h3 className="font-display text-lg font-semibold text-slate-100 mb-4">Quick Start</h3>
        <div className="space-y-4 text-slate-300">
          <div className="flex items-start gap-3">
            <span className="text-primary-400 font-bold">1.</span>
            <p>
              Add a <strong>repository source</strong> in the Repositories tab
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-primary-400 font-bold">2.</span>
            <p>
              Generate an <strong>access token</strong> in the Access Tokens tab
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-primary-400 font-bold">3.</span>
            <div className="flex-1">
              <p className="mb-3">
                Configure your project to use this proxy:
              </p>

              {/* CLI Command Option */}
              <div className="mb-4" data-testid="composer-cli-config">
                <p className="text-sm text-slate-400 mb-2">Using Composer CLI:</p>
                <pre className="bg-slate-950 rounded-lg p-4 overflow-x-auto text-sm text-slate-300">
                  <code data-testid="composer-cli-command">composer config repositories.proxy composer {window.location.origin}</code>
                </pre>
              </div>

              {/* JSON Option */}
              <div data-testid="composer-json-config">
                <p className="text-sm text-slate-400 mb-2">Or manually edit composer.json:</p>
                <pre className="bg-slate-950 rounded-lg p-4 overflow-x-auto text-sm text-slate-300">
                  <code data-testid="composer-json-code">{`{
  "repositories": [
    {
      "type": "composer",
      "url": "${window.location.origin}"
    }
  ]
}`}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

