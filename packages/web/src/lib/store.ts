import { create } from 'zustand';
import type {
  AgentInfo,
  NotifyPayload,
  PermissionRequest,
  ServerInfo,
  ServerMessage,
  SessionEvent,
  SessionInfo,
  TaskInfo,
} from '@agent-hub/shared/client';

const TOKEN_KEY = 'agentHub.token';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'unauthorized';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  url?: string;
  tone: 'info' | 'success' | 'warn' | 'error';
}

interface HubState {
  token: string | null;
  connection: ConnectionState;
  server: ServerInfo | null;
  agents: AgentInfo[];
  sessions: Record<string, SessionInfo>;
  permissions: Record<string, PermissionRequest>;
  tasks: Record<string, TaskInfo>;
  events: Record<string, SessionEvent[]>;
  replayed: Record<string, boolean>;
  toasts: Toast[];
  setToken(token: string | null): void;
  setUnauthorized(): void;
  setConnection(state: ConnectionState): void;
  apply(msg: ServerMessage): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
  onNotify?: (n: NotifyPayload) => void;
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let toastId = 0;

export const useHub = create<HubState>((set, get) => ({
  token: readToken(),
  connection: 'idle',
  server: null,
  agents: [],
  sessions: {},
  permissions: {},
  tasks: {},
  events: {},
  replayed: {},
  toasts: [],

  setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // storage unavailable (private mode)
    }
    set({
      token,
      connection: token ? 'idle' : 'unauthorized',
      server: null,
      sessions: {},
      permissions: {},
      tasks: {},
      events: {},
      replayed: {},
    });
  },

  setUnauthorized() {
    get().setToken(null);
  },

  setConnection(connection) {
    set({ connection });
  },

  apply(msg) {
    switch (msg.type) {
      case 'hello':
        set({ server: msg.server, connection: 'open' });
        break;
      case 'agents':
        set({ agents: msg.agents });
        break;
      case 'session':
        set((s) => ({ sessions: { ...s.sessions, [msg.session.id]: msg.session } }));
        break;
      case 'session_removed':
        set((s) => {
          const sessions = { ...s.sessions };
          delete sessions[msg.sessionId];
          const events = { ...s.events };
          delete events[msg.sessionId];
          return { sessions, events };
        });
        break;
      case 'permission':
        set((s) => {
          const permissions = { ...s.permissions };
          if (msg.permission.status === 'pending') permissions[msg.permission.id] = msg.permission;
          else delete permissions[msg.permission.id];
          return { permissions };
        });
        break;
      case 'task':
        set((s) => ({ tasks: { ...s.tasks, [msg.task.id]: msg.task } }));
        break;
      case 'event':
        set((s) => {
          const list = s.events[msg.event.sessionId] ?? [];
          const last = list[list.length - 1];
          if (last && last.seq >= msg.event.seq) return {};
          return { events: { ...s.events, [msg.event.sessionId]: [...list, msg.event] } };
        });
        break;
      case 'replay_done':
        set((s) => ({ replayed: { ...s.replayed, [msg.sessionId]: true } }));
        break;
      case 'notify':
        get().onNotify?.(msg.notification);
        break;
      default:
        break;
    }
  },

  toast(t) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.tone === 'error' ? 8000 : 5000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export function lastSeq(sessionId: string): number {
  const list = useHub.getState().events[sessionId];
  return list?.length ? list[list.length - 1].seq : 0;
}

export function toastError(err: unknown, title = 'Something went wrong'): void {
  useHub.getState().toast({ tone: 'error', title, body: (err as Error)?.message ?? String(err) });
}
