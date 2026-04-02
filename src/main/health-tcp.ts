import net from 'net';

export interface TcpProbeResult {
  host: string;
  port: number;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export function probeTcp(hostname: string, port: number, timeoutMs = 5000): Promise<TcpProbeResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    function finish(r: TcpProbeResult) {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        /* */
      }
      resolve(r);
    }

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      const ms = Date.now() - start;
      finish({ host: hostname, port, ok: true, latencyMs: ms });
    });
    socket.once('timeout', () => {
      finish({ host: hostname, port, ok: false, error: 'timeout' });
    });
    socket.once('error', (err) => {
      finish({ host: hostname, port, ok: false, error: err.message });
    });

    socket.connect(port, hostname);
  });
}

export async function probeMany(
  targets: { host: string; port: number }[],
  timeoutMs?: number
): Promise<TcpProbeResult[]> {
  return Promise.all(targets.map((t) => probeTcp(t.host, t.port, timeoutMs)));
}
