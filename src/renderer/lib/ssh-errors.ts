/**
 * Maps raw SSH/network errors to short, user-facing English messages.
 */
export function formatSshError(raw: string): string {
  const s = raw.trim();
  if (!s) return 'Could not establish a connection.';

  const lower = s.toLowerCase();

  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return 'Host unreachable: connection refused (port closed or SSH not running).';
  }
  if (lower.includes('etimedout') || lower.includes('timed out') || lower.includes('timeout')) {
    if (lower.includes('handshake')) {
      return 'SSH handshake timed out: host not responding or filtering the port.';
    }
    return 'Timed out: host not responding (check network, firewall, and address).';
  }
  if (
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo') ||
    lower.includes('name or service not known')
  ) {
    return 'Could not resolve hostname: check DNS or /etc/hosts.';
  }
  if (lower.includes('ehostunreach') || lower.includes('no route to host')) {
    return 'Network: no route to host.';
  }
  if (lower.includes('enetunreach') || lower.includes('network is unreachable')) {
    return 'Network unreachable.';
  }
  if (lower.includes('authentication') && lower.includes('failed')) {
    return 'Authentication failed: wrong password, key, or username.';
  }
  if (lower.includes('all configured authentication methods failed')) {
    return 'SSH rejected login: check username, password, or key.';
  }
  if (lower.includes('keepalive') || lower.includes('connection lost')) {
    return s.includes('—') ? s : 'Connection lost (keepalive / network).';
  }
  if (lower.includes('jump') && lower.includes('not found')) {
    return s;
  }

  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}
