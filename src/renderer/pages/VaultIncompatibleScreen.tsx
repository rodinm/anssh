import { AlertTriangle, FolderOpen, RefreshCw, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface Props {
  detail: string;
  userDataPath: string;
  onRetry: () => void;
}

export function VaultIncompatibleScreen({ detail, userDataPath, onRetry }: Props) {
  const { theme, toggleTheme } = useTheme();

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
      <div className="w-full max-w-md mx-auto px-6">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center mb-4 border border-border">
            <AlertTriangle className="w-8 h-8 text-warning" />
          </div>
          <h1 className="text-xl font-semibold text-text text-center">Vault file not supported</h1>
          <p className="text-text-muted text-sm mt-2 text-center leading-relaxed">
            {detail}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-3 mb-4">
          <p className="text-xs text-text-muted mb-1">User data folder</p>
          <p className="text-xs font-mono text-text break-all select-all">{userDataPath}</p>
        </div>

        <p className="text-sm text-text-muted mb-4 leading-relaxed">
          Back up <span className="font-mono text-text">vault.json</span> if you might need it, then remove or rename it
          (and <span className="font-mono text-text">vault.json.bak</span> if present). Click{' '}
          <strong className="text-text">Try again</strong> — you will be prompted to create a new vault. Saved hosts and
          groups stay in other JSON files; only stored credentials are in the vault.
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void window.anssh.app.openUserData()}
            className="w-full h-10 flex items-center justify-center gap-2 border border-border bg-surface hover:bg-[var(--color-surface-2)] text-text rounded-lg text-sm font-medium transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            Open data folder
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="w-full h-10 flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
