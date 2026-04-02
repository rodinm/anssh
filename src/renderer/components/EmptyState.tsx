import { Terminal } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center mb-4 border border-border">
        <Terminal className="w-8 h-8 text-text-faint" />
      </div>
      <h2 className="text-lg font-medium text-text mb-2">No active sessions</h2>
      <p className="text-sm text-text-muted max-w-xs leading-relaxed">
        Pick a host in the sidebar and connect via SSH terminal or SFTP
      </p>
    </div>
  );
}
