import { useState } from 'react';
import { X, Trash2, Key, Eye, EyeOff, FileKey } from 'lucide-react';
import type { Credential } from '../lib/types';

interface Props {
  credential?: Partial<Credential>;
  onSave: (cred: Partial<Credential>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function CredentialEditor({ credential, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(credential?.name || '');
  const [username, setUsername] = useState(credential?.username || '');
  const [authType, setAuthType] = useState<'password' | 'key' | 'key+password'>(
    credential?.authType || 'password'
  );
  const [password, setPassword] = useState(credential?.password || '');
  const [privateKey, setPrivateKey] = useState(credential?.privateKey || '');
  const [passphrase, setPassphrase] = useState(credential?.passphrase || '');
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyFileName, setKeyFileName] = useState('');

  async function handleSave() {
    if (!name.trim() || !username.trim()) return;
    setSaving(true);
    await onSave({
      ...(credential?.id ? { id: credential.id } : {}),
      name: name.trim(),
      username: username.trim(),
      authType,
      ...(authType === 'password' || authType === 'key+password' ? { password } : {}),
      ...(authType === 'key' || authType === 'key+password' ? { privateKey, passphrase } : {}),
    });
    setSaving(false);
  }

  async function handleBrowseKey() {
    const result = await window.anssh.dialog.openFile({
      filters: [
        { name: 'SSH Keys', extensions: ['pem', 'key', 'ppk', 'pub', '*'] },
      ],
    });
    if (result) {
      setPrivateKey(result.content);
      setKeyFileName(result.path.split('/').pop() || result.path.split('\\').pop() || 'key');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface border border-border rounded-xl shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-text">
              {credential?.id ? 'Edit credential' : 'New credential'}
            </h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg text-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-primary"
                placeholder="admin@prod"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-primary"
                placeholder="root"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Authentication</label>
            <div className="flex gap-2">
              {(['password', 'key', 'key+password'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setAuthType(type)}
                  className={`flex-1 h-8 rounded-lg text-xs font-medium transition-colors ${
                    authType === type
                      ? 'bg-primary text-white'
                      : 'bg-bg border border-border text-text-muted hover:text-text'
                  }`}
                >
                  {type === 'password' ? 'Password' : type === 'key' ? 'Key' : 'Key + password'}
                </button>
              ))}
            </div>
          </div>

          {/* Password field */}
          {(authType === 'password' || authType === 'key+password') && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-9 px-3 pr-9 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}

          {/* Key fields */}
          {(authType === 'key' || authType === 'key+password') && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Private key</label>
                <div className="flex gap-2">
                  <div className="flex-1 h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text-muted flex items-center overflow-hidden">
                    <span className="truncate">
                      {keyFileName || (privateKey ? 'Key loaded' : 'Not selected')}
                    </span>
                  </div>
                  <button
                    onClick={handleBrowseKey}
                    className="h-9 px-3 bg-bg border border-border rounded-lg text-xs text-text hover:bg-[var(--color-surface-2)] flex items-center gap-1"
                  >
                    <FileKey className="w-3.5 h-3.5" /> Browse
                  </button>
                </div>
                {privateKey && (
                  <textarea
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    className="w-full mt-2 h-20 px-3 py-2 bg-bg border border-border rounded-lg text-xs text-text font-mono resize-none focus:outline-none focus:border-primary"
                    placeholder="-----BEGIN RSA PRIVATE KEY-----"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Key passphrase (optional)
                </label>
                <div className="relative">
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    className="w-full h-9 px-3 pr-9 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary"
                    placeholder="Passphrase"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted"
                  >
                    {showPassphrase ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          {onDelete ? (
            <button
              onClick={onDelete}
              className="flex items-center gap-1 text-xs text-error hover:text-[var(--color-error-hover)]"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-8 px-3 rounded-lg text-xs text-text-muted hover:bg-bg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !username.trim()}
              className="h-8 px-4 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
