import { useState, useEffect } from 'react';
import { Heart, X } from 'lucide-react';

const STORAGE_KEY = 'composer_proxy_sponsor_banner_dismissed';

export function SponsorshipBanner() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      setDismissed(stored === 'true');
    }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true');
    }
  };

  if (dismissed) {
    return null;
  }

  return (
    <div className="relative bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-pink-500/10 border border-pink-500/20 rounded-lg p-4 mb-6">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 text-slate-400 hover:text-slate-200 transition"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="pr-8">
        <div className="flex items-start gap-3">
          <Heart className="w-6 h-6 text-pink-400 fill-pink-400" />
          <div className="flex-1">
            <p className="text-slate-200 font-medium mb-1">
              Enjoying this project? Consider sponsoring!
            </p>
            <p className="text-slate-400 text-sm mb-3">
              Built during evenings and weekends. Your support helps keep it going and funds new
              features, better docs, and faster bug fixes.
            </p>
            <a
              href="https://github.com/sponsors/lbajsarowicz"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white text-sm font-semibold rounded-lg shadow-lg shadow-pink-500/25 transition"
            >
              <Heart className="w-4 h-4 fill-current" />
              <span>Sponsor on GitHub</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}




