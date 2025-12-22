import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Link, useLocation } from 'react-router';
import { Package, BarChart3, Key, ClipboardList, Info, Heart, LogOut, User as UserIcon } from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { Repositories } from './pages/Repositories';
import { Tokens } from './pages/Tokens';
import { Packages } from './pages/Packages';
import { PackageDetail } from './pages/PackageDetail';
import Login from './pages/Login';
import Invite from './pages/Invite';
import Setup from './pages/Setup';
import { Users } from './pages/Users';
import { Profile } from './pages/Profile';
import { AuthProvider, useAuth } from './context/AuthContext';
import { checkAuthRequired } from './lib/api';

function AppContent() {
  const { isAuthenticated, logout } = useAuth();
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    checkAuthRequired().then(({ authRequired, setupRequired }) => {
      setAuthRequired(authRequired);
      setSetupRequired(setupRequired);
      setCheckingAuth(false);
    });
  }, []);

  // Show loading state while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  const location = useLocation();

  // Fresh Install Flow
  if (setupRequired) {
    return <Setup onSuccess={() => window.location.reload()} />;
  }

  // Invite Flow
  if (location.pathname.startsWith('/invite/')) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<Invite />} />
      </Routes>
    )
  }

  // Show login page if auth is required and not authenticated
  if (authRequired && !isAuthenticated) {
    return <Login onSuccess={() => window.location.reload()} />;
  }

  const navItems = [
    { path: '/', label: 'Dashboard', icon: BarChart3 },
    { path: '/repositories', label: 'Repositories', icon: Package },
    { path: '/tokens', label: 'Access Tokens', icon: Key },
    { path: '/packages', label: 'Packages', icon: ClipboardList },
    { path: '/users', label: 'Users', icon: UserIcon },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-slate-900/90 backdrop-blur-sm border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-accent-600 rounded-lg flex items-center justify-center">
                <Package className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-display font-bold text-lg text-slate-100">
                  PACKAGE.broker
                </h1>
                <p className="text-xs text-slate-500">Serverless Edition</p>
              </div>
            </Link>
            <div className="flex items-center gap-4">
              <nav className="flex items-center gap-1" role="navigation" aria-label="Main navigation">
                {navItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    data-testid={`nav-${item.path === '/' ? 'dashboard' : item.path.slice(1)}`}
                    className={({ isActive }) =>
                      `px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex items-center gap-2 ${isActive
                        ? 'bg-slate-800 text-primary-400 shadow-lg'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`
                    }
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
                <a
                  href="https://package.broker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-lg font-medium text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all duration-200 flex items-center gap-2"
                  data-testid="nav-about"
                >
                  <Info className="w-5 h-5 flex-shrink-0" />
                  <span>About</span>
                </a>
              </nav>
              {isAuthenticated && (
                <div className="flex items-center gap-2 pl-2 border-l border-slate-700 ml-2">
                  <NavLink
                    to="/profile"
                    className={({ isActive }) =>
                      `px-3 py-2 text-sm rounded-lg transition flex items-center gap-1 ${isActive ? 'text-white bg-slate-800' : 'text-slate-400 hover:text-slate-200'
                      }`
                    }
                    title="Profile Settings"
                  >
                    <UserIcon className="w-4 h-4" />
                  </NavLink>
                  <button
                    onClick={logout}
                    className="px-3 py-2 text-sm text-slate-400 hover:text-red-400 transition flex items-center gap-1"
                    title="Sign out"
                    aria-label="Sign out"
                    data-testid="logout-button"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/repositories" element={<Repositories />} />
          <Route path="/tokens" element={<Tokens />} />
          <Route path="/packages" element={<Packages />} />
          <Route path="/packages/:vendor/:package" element={<PackageDetail />} />
          <Route path="/users" element={<Users />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-16 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-center md:text-left">
              <p className="text-slate-300 font-medium mb-1">
                PACKAGE.broker
              </p>
              <p className="text-slate-500 text-sm">
                A lightweight, self-hosted Composer proxy running on Cloudflare's edge network
              </p>
            </div>
            <div className="flex flex-col items-center md:items-end gap-2">
              <div className="flex items-center gap-4 text-sm">
                <a
                  href="https://github.com/package-broker/server"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  GitHub
                </a>
                <a
                  href="https://github.com/sponsors/lbajsarowicz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pink-400 hover:text-pink-300 transition flex items-center gap-1"
                >
                  <Heart className="w-4 h-4 fill-current" />
                  Sponsor
                </a>
              </div>
              <p className="text-slate-500 text-xs">
                © {new Date().getFullYear()} Łukasz Bajsarowicz • Licensed under AGPL-3.0
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

