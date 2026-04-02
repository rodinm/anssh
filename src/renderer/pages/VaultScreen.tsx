import { useState } from 'react';
import { Lock, ShieldCheck, Eye, EyeOff, AlertCircle, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface Props {
  mode: 'create' | 'unlock';
  onCreate: (password: string) => Promise<void>;
  onUnlock: (password: string) => Promise<boolean>;
}

export function VaultScreen({ mode, onCreate, onUnlock }: Props) {
  const { theme, toggleTheme } = useTheme();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (mode === 'create') {
      if (password.length < 8) {
        setError('At least 8 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      setLoading(true);
      try {
        await onCreate(password);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Could not create vault. Check disk permissions or try again.'
        );
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(true);
      try {
        const ok = await onUnlock(password);
        if (!ok) {
          setError('Wrong password or damaged vault file');
        }
      } catch {
        setError('Unlock failed. If the problem persists, check the vault file or logs.');
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="relative flex items-center justify-center h-full bg-bg">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-lg border border-border bg-surface text-text-muted hover:text-text hover:bg-[var(--color-surface-2)]"
        title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
      <div className="w-full max-w-sm mx-auto px-6">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center mb-4 border border-border">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-text">AnSSH</h1>
          <p className="text-text-muted text-sm mt-1">
            {mode === 'create'
              ? 'Create a master password for the vault'
              : 'Enter master password'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Password field */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              Master password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 pl-10 pr-10 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                placeholder="Enter password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm password (create mode) */}
          {mode === 'create' && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                Confirm
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-10 pl-10 pr-3 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  placeholder="Repeat password"
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-error text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full h-10 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Working…' : mode === 'create' ? 'Create vault' : 'Unlock'}
          </button>
        </form>

        {mode === 'create' && (
          <p className="text-xs text-text-faint text-center mt-4 leading-relaxed">
            The master password encrypts all saved credentials (AES-256-GCM).
            There is no recovery — remember your password.
          </p>
        )}
        {mode === 'unlock' && (
          <p className="text-xs text-text-faint text-center mt-4 leading-relaxed">
            After an upgrade, if the password is correct but unlock still fails, your{' '}
            <span className="font-mono">vault.json</span> may be from an old format. Back it up, remove it from the app
            data folder, restart, and create a new vault (hosts and groups are kept separately).
          </p>
        )}
      </div>
    </div>
  );
}
