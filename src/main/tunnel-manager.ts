import net from 'net';
import { Client } from 'ssh2';
import { EventEmitter } from 'events';
import { getLogger } from './logger';

export interface TunnelConfig {
  id: string;
  sessionId: string; // which SSH session to tunnel through
  type: 'local' | 'remote' | 'dynamic';
  // Local forward: localPort → remoteHost:remotePort through SSH
  // Remote forward: remotePort on SSH server → localHost:localPort
  // Dynamic: localPort as SOCKS5 proxy
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

interface ActiveTunnel {
  config: TunnelConfig;
  server: net.Server;
  connections: number;
}

export class TunnelManager extends EventEmitter {
  private tunnels: Map<string, ActiveTunnel> = new Map();
  private sshClients: Map<string, Client> = new Map();

  /** Register an SSH client for tunnel use */
  registerClient(sessionId: string, client: Client): void {
    this.sshClients.set(sessionId, client);
  }

  unregisterClient(sessionId: string): void {
    this.sshClients.delete(sessionId);
    // Close all tunnels using this session
    for (const [id, tunnel] of this.tunnels) {
      if (tunnel.config.sessionId === sessionId) {
        this.closeTunnel(id);
      }
    }
  }

  async openTunnel(config: TunnelConfig): Promise<{ success: boolean; error?: string }> {
    const log = getLogger();
    const client = this.sshClients.get(config.sessionId);
    if (!client) return { success: false, error: 'SSH session not found' };

    if (config.type === 'dynamic') {
      return this.openSocksProxy(config, client);
    }

    if (config.type === 'local') {
      return this.openLocalForward(config, client);
    }

    if (config.type === 'remote') {
      return this.openRemoteForward(config, client);
    }

    return { success: false, error: `Unknown tunnel type: ${config.type}` };
  }

  private openLocalForward(config: TunnelConfig, client: Client): Promise<{ success: boolean; error?: string }> {
    const log = getLogger();
    return new Promise((resolve) => {
      const server = net.createServer((socket) => {
        const tunnel = this.tunnels.get(config.id);
        if (tunnel) tunnel.connections++;

        client.forwardOut(
          socket.remoteAddress || '127.0.0.1',
          socket.remotePort || 0,
          config.remoteHost,
          config.remotePort,
          (err, stream) => {
            if (err) {
              log.error('Tunnel forwardOut error', { tunnelId: config.id, error: err });
              socket.end();
              return;
            }
            socket.pipe(stream).pipe(socket);
            stream.on('close', () => {
              socket.end();
              const t = this.tunnels.get(config.id);
              if (t) t.connections = Math.max(0, t.connections - 1);
            });
            socket.on('close', () => stream.close());
          }
        );
      });

      server.on('error', (err) => {
        log.error('Tunnel server error', { tunnelId: config.id, error: err });
        resolve({ success: false, error: err.message });
      });

      server.listen(config.localPort, config.localHost, () => {
        this.tunnels.set(config.id, { config, server, connections: 0 });
        log.info('Local tunnel opened', { id: config.id, local: `${config.localHost}:${config.localPort}`, remote: `${config.remoteHost}:${config.remotePort}` });
        this.emit('tunnelOpened', config.id);
        resolve({ success: true });
      });
    });
  }

  private openRemoteForward(config: TunnelConfig, client: Client): Promise<{ success: boolean; error?: string }> {
    const log = getLogger();
    return new Promise((resolve) => {
      client.forwardIn(config.remoteHost, config.remotePort, (err) => {
        if (err) {
          log.error('Remote tunnel forwardIn error', { tunnelId: config.id, error: err });
          resolve({ success: false, error: err.message });
          return;
        }

        // Create a dummy server object for cleanup
        const server = net.createServer();
        this.tunnels.set(config.id, { config, server, connections: 0 });

        client.on('tcp connection', (info, accept, reject) => {
          const stream = accept();
          const socket = net.connect(config.localPort, config.localHost);
          stream.pipe(socket).pipe(stream);
          const tunnel = this.tunnels.get(config.id);
          if (tunnel) tunnel.connections++;
          socket.on('close', () => {
            stream.close();
            const t = this.tunnels.get(config.id);
            if (t) t.connections = Math.max(0, t.connections - 1);
          });
        });

        log.info('Remote tunnel opened', { id: config.id });
        this.emit('tunnelOpened', config.id);
        resolve({ success: true });
      });
    });
  }

  private openSocksProxy(config: TunnelConfig, client: Client): Promise<{ success: boolean; error?: string }> {
    const log = getLogger();
    return new Promise((resolve) => {
      const server = net.createServer((socket) => {
        // Minimal SOCKS5 handshake
        socket.once('data', (greeting) => {
          // Respond: no auth required
          socket.write(Buffer.from([0x05, 0x00]));

          socket.once('data', (request) => {
            const cmd = request[1]; // 1=connect
            if (cmd !== 0x01) { socket.end(); return; }

            const addrType = request[3];
            let host: string;
            let port: number;

            if (addrType === 0x01) {
              // IPv4
              host = `${request[4]}.${request[5]}.${request[6]}.${request[7]}`;
              port = request.readUInt16BE(8);
            } else if (addrType === 0x03) {
              // Domain
              const len = request[4];
              host = request.subarray(5, 5 + len).toString();
              port = request.readUInt16BE(5 + len);
            } else if (addrType === 0x04) {
              // IPv6
              host = Array.from({ length: 8 }, (_, i) =>
                request.readUInt16BE(4 + i * 2).toString(16)
              ).join(':');
              port = request.readUInt16BE(20);
            } else {
              socket.end();
              return;
            }

            client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
              if (err) {
                // Send failure response
                const reply = Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                socket.write(reply);
                socket.end();
                return;
              }

              // Send success response
              const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
              socket.write(reply);

              socket.pipe(stream).pipe(socket);
              stream.on('close', () => socket.end());
              socket.on('close', () => stream.close());
            });
          });
        });
      });

      server.on('error', (err) => {
        log.error('SOCKS proxy error', { tunnelId: config.id, error: err });
        resolve({ success: false, error: err.message });
      });

      server.listen(config.localPort, config.localHost, () => {
        this.tunnels.set(config.id, { config, server, connections: 0 });
        log.info('SOCKS proxy opened', { id: config.id, listen: `${config.localHost}:${config.localPort}` });
        this.emit('tunnelOpened', config.id);
        resolve({ success: true });
      });
    });
  }

  closeTunnel(tunnelId: string): boolean {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) return false;
    try { tunnel.server.close(); } catch {}
    this.tunnels.delete(tunnelId);
    getLogger().info('Tunnel closed', { id: tunnelId });
    this.emit('tunnelClosed', tunnelId);
    return true;
  }

  closeAll(): void {
    for (const [id] of this.tunnels) {
      this.closeTunnel(id);
    }
  }

  listTunnels(): (TunnelConfig & { connections: number })[] {
    return Array.from(this.tunnels.values()).map((t) => ({
      ...t.config,
      connections: t.connections,
    }));
  }
}
