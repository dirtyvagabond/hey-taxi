import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from '@hey-taxi/sim/protocol';

/** Build identifier baked in at release time ("dev" otherwise). */
export const BUILD_ID: string = import.meta.env.VITE_BUILD_ID ?? 'dev';

export type ConnectionState = 'connecting' | 'open' | 'replaced';

/**
 * WebSocket link to the game server (same host, path /ws). Reconnects automatically, except
 * after another tab took over the game (then only when asked).
 */
const CONNECT_TIMEOUT_MS = 5000;

export class Connection {
  state: ConnectionState = 'connecting';
  private ws: WebSocket | null = null;
  private retryMs = 250;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onState: (state: ConnectionState) => void,
  ) {}

  connect(): void {
    this.clearConnectTimer();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.setState('connecting');
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      this.clearConnectTimer();
      this.retryMs = 250;
      let accountId: string | undefined;
      try {
        accountId = localStorage.getItem('hey-taxi.accountId') ?? undefined;
      } catch {
        // storage unavailable
      }
      this.send({ t: 'hello', protocol: PROTOCOL_VERSION, build: BUILD_ID, ...(accountId ? { accountId } : {}) });
    };
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch (err) {
        console.error('Malformed server message:', err);
        return;
      }
      if (msg.t === 'welcome') {
        // A different build of the game is running on the server: load it.
        if (msg.protocol !== PROTOCOL_VERSION || (msg.build !== BUILD_ID && BUILD_ID !== 'dev')) {
          location.reload();
          return;
        }
        this.setState('open');
      }
      if (msg.t === 'replaced') this.setState('replaced');
      try {
        this.onMessage(msg);
      } catch (err) {
        console.error(`Error handling server message "${msg.t}":`, err);
      }
    };
    ws.onerror = () => {
      // onclose will handle cleanup and reconnect backoff.
    };
    ws.onclose = () => {
      this.clearConnectTimer();
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.state === 'replaced') return;
      this.setState('connecting');
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(2000, this.retryMs * 2);
    };
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  /** Take the game back after another tab took it over. */
  reclaim(): void {
    if (this.state === 'replaced') this.connect();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onState(state);
  }
}
