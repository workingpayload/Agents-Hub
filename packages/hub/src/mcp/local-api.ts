import type { Actor } from '@agent-hub/shared';
import type { Orchestrator } from '../services/orchestrator.js';
import type { HubToolApi } from './tools.js';

/** Tool API bound to one calling session, backed directly by the orchestrator. */
export function createLocalToolApi(sessionId: string, orchestrator: Orchestrator, actor: Actor): HubToolApi {
  return {
    listAgents: async () =>
      orchestrator.delegatableAgents().map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        activeSessions: a.activeSessions,
      })),
    delegate: async (body) => {
      const task = await orchestrator.delegate(sessionId, body);
      return orchestrator.wait(task.id, body.waitSeconds ?? 0, sessionId);
    },
    getTask: (taskId) => orchestrator.wait(taskId, 0, sessionId),
    waitForTask: (taskId, seconds) => orchestrator.wait(taskId, seconds, sessionId),
    sendMessage: async (taskId, text, waitSeconds) => {
      await orchestrator.message(sessionId, taskId, text, actor);
      return orchestrator.wait(taskId, waitSeconds, sessionId);
    },
    listTasks: async () => orchestrator.list({ parentSessionId: sessionId }),
    cancelTask: (taskId) => orchestrator.cancel(taskId, actor, sessionId),
  };
}
