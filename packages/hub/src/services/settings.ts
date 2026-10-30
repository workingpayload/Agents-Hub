import os from 'node:os';
import type { AgentSettings, HubSettings, SettingsPatch } from '@agent-hub/shared';
import type { Db } from '../db.js';

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  enabled: true,
  defaultMode: 'structured',
  autoApprove: 'none',
};

export function defaultSettings(): HubSettings {
  return {
    defaultCwd: os.homedir(),
    orchestration: {
      maxDepth: 2,
      maxConcurrentSessions: 8,
      taskTimeoutSec: 1800,
      defaultDelegationPolicy: 'ask',
      loopDetection: true,
    },
    permissions: { timeoutSec: 0 },
    notifications: { permission: true, turnEnd: true, task: true, error: true },
    agents: {},
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

export class SettingsStore {
  private cache: HubSettings;
  private listeners = new Set<(s: HubSettings) => void>();

  constructor(private db: Db) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'hub'").get() as { value: string } | undefined;
    this.cache = deepMerge(defaultSettings(), row ? JSON.parse(row.value) : {});
  }

  get(): HubSettings {
    return this.cache;
  }

  agent(agentId: string): AgentSettings {
    return { ...DEFAULT_AGENT_SETTINGS, ...(this.cache.agents[agentId] ?? {}) };
  }

  patch(patch: SettingsPatch): HubSettings {
    this.cache = deepMerge(this.cache, patch);
    // Environment maps are replaced wholesale so variables can be removed.
    for (const [id, agentPatch] of Object.entries(patch.agents ?? {})) {
      if (agentPatch.env) this.cache.agents[id] = { ...this.cache.agents[id], env: { ...agentPatch.env } };
    }
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('hub', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(this.cache));
    for (const l of this.listeners) l(this.cache);
    return this.cache;
  }

  onChange(listener: (s: HubSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
