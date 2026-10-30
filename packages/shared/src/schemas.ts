import { z } from 'zod';

// Request body schemas for the hub REST API. Validated on the server, reused as types on clients.

export const sessionModeSchema = z.enum(['structured', 'terminal']);
export const autoApproveSchema = z.enum(['none', 'read', 'edits', 'all']);
export const delegationPolicySchema = z.enum(['ask', 'auto', 'deny']);
export const isolationSchema = z.enum(['shared', 'worktree']);

export const createSessionSchema = z.object({
  agentId: z.string().min(1),
  mode: sessionModeSchema.optional(),
  cwd: z.string().min(1).optional(),
  title: z.string().max(200).optional(),
  prompt: z.string().max(200_000).optional(),
  isolation: isolationSchema.optional(),
  autoApprove: autoApproveSchema.optional(),
  delegationPolicy: delegationPolicySchema.optional(),
});
export type CreateSessionBody = z.infer<typeof createSessionSchema>;

export const promptSchema = z.object({
  text: z.string().min(1).max(200_000),
});
export type PromptBody = z.infer<typeof promptSchema>;

export const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  delegationPolicy: delegationPolicySchema.optional(),
  autoApprove: autoApproveSchema.optional(),
  modeId: z.string().min(1).optional(),
  archived: z.boolean().optional(),
});
export type UpdateSessionBody = z.infer<typeof updateSessionSchema>;

export const handoffSchema = z
  .object({
    targetSessionId: z.string().optional(),
    agentId: z.string().optional(),
    text: z.string().min(1).max(200_000),
    note: z.string().max(10_000).optional(),
  })
  .refine((v) => Boolean(v.targetSessionId) !== Boolean(v.agentId), {
    message: 'Provide exactly one of targetSessionId or agentId',
  });
export type HandoffBody = z.infer<typeof handoffSchema>;

export const permissionResponseSchema = z
  .object({
    optionId: z.string().min(1).optional(),
    cancel: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.optionId) !== Boolean(v.cancel), {
    message: 'Provide exactly one of optionId or cancel',
  });
export type PermissionResponseBody = z.infer<typeof permissionResponseSchema>;

export const pairCompleteSchema = z
  .object({
    code: z.string().min(8).max(128).optional(),
    pin: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    deviceName: z.string().trim().min(1).max(80),
  })
  .refine((v) => Boolean(v.code) || Boolean(v.pin), { message: 'Provide a pairing code or PIN' });
export type PairCompleteBody = z.infer<typeof pairCompleteSchema>;

export const updateDeviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const sessionConfigSchema = z
  .object({
    modeId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    configId: z.string().min(1).optional(),
    value: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.modeId) || Boolean(v.modelId) || (Boolean(v.configId) && Boolean(v.value)), {
    message: 'Provide modeId, modelId, or configId + value',
  });
export type SessionConfigBody = z.infer<typeof sessionConfigSchema>;

export const worktreeCommitSchema = z.object({
  message: z.string().trim().min(1).max(2000).optional(),
});

export const pushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
});
export type PushSubscribeBody = z.infer<typeof pushSubscribeSchema>;

const agentSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultMode: sessionModeSchema.optional(),
  autoApprove: autoApproveSchema.optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  terminalCommand: z.string().optional(),
  terminalArgs: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export const settingsPatchSchema = z.object({
  defaultCwd: z.string().min(1).optional(),
  orchestration: z
    .object({
      maxDepth: z.number().int().min(0).max(10).optional(),
      maxConcurrentSessions: z.number().int().min(1).max(64).optional(),
      taskTimeoutSec: z.number().int().min(30).max(86_400).optional(),
      defaultDelegationPolicy: delegationPolicySchema.optional(),
      loopDetection: z.boolean().optional(),
    })
    .optional(),
  permissions: z.object({ timeoutSec: z.number().int().min(0).max(86_400).optional() }).optional(),
  notifications: z
    .object({
      permission: z.boolean().optional(),
      turnEnd: z.boolean().optional(),
      task: z.boolean().optional(),
      error: z.boolean().optional(),
    })
    .optional(),
  agents: z.record(agentSettingsPatchSchema).optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

// Orchestration API used by the hub MCP bridge (authenticated with a per-session token).
export const delegateTaskSchema = z.object({
  agentId: z.string().min(1),
  prompt: z.string().min(1).max(200_000),
  cwd: z.string().optional(),
  isolation: isolationSchema.optional(),
  waitSeconds: z.number().int().min(0).max(1800).optional(),
});
export type DelegateTaskBody = z.infer<typeof delegateTaskSchema>;

export const taskMessageSchema = z.object({
  text: z.string().min(1).max(200_000),
  waitSeconds: z.number().int().min(0).max(1800).optional(),
});
export type TaskMessageBody = z.infer<typeof taskMessageSchema>;
