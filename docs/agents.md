# Agents

Agent Hub talks to agents in one of two ways:

- **Structured mode (ACP).** The hub is an [Agent Client Protocol](https://agentclientprotocol.com) client and spawns
  the agent as a JSON-RPC process over stdio.
  - Streaming text, thoughts, tool calls, diffs, plans, modes, models and config options are all mapped to hub events.
  - Permission requests (`session/request_permission`) go to the hub's permission broker.
  - Every structured session gets the hub's MCP server, `agent-hub`, for delegation. It's served over HTTP when the
    agent supports MCP-over-HTTP, otherwise through a stdio bridge (`mcp-bridge.js`).
  - After a restart, sessions resume with `session/load` when the agent supports it.
- **Terminal mode (PTY).** The agent's interactive CLI runs in a pseudo-terminal (`@lydell/node-pty`) and is mirrored to
  every viewer with xterm.js. Anything the CLI can do works here, including logging in. Permissions are answered by
  typing; the UI has quick keys for `y`/`n`, arrows, Enter, Esc and Ctrl+C.
  - The terminal has one size, shared by all viewers. The device you're using sets it: opening the terminal, tapping
    or focusing into it, typing, or pressing **Fit to this screen**.
  - Every other viewer renders that exact grid, shrinking its font to fit (or scrolling if even the smallest font is
    too wide), so output is never garbled.
  - The hub keeps a headless terminal emulator, so devices that join later get an accurate snapshot of the current
    screen.

## Launch mapping (verified with the CLI versions below)

| Agent | Detected CLI | Structured launch | Notes |
|---|---|---|---|
| GitHub Copilot CLI | 1.0.105 | `copilot --acp` | Native ACP. Exposes models, modes and config options; `loadSession`, HTTP MCP. |
| Claude Code | 2.1.283 | `node …/claude-agent-acp/dist/index.js` | Official ACP adapter built on the Claude Agent SDK (bundled). Modes: Manual, Accept edits, Plan, Auto, Bypass. |
| OpenAI Codex CLI | 0.153+ | `node …/codex-acp/dist/index.js` | Official ACP adapter (bundled Codex engine). Models and modes. |
| Gemini CLI | 0.42.0 | `gemini --acp` | Native ACP. Google-account logins can be rejected by Google ("client no longer supported"); set `GEMINI_API_KEY` in Settings → Agents → environment. |

Use `node packages/hub/scripts/acp-probe.mjs <command> [args…]` to check whether an agent completes the ACP handshake
(`initialize` + `session/new`) without sending a prompt.

## Authentication

Agents use the credentials stored by their own CLIs. If a session fails with an authentication error:

| Agent | Fix |
|---|---|
| Copilot | `copilot login` |
| Claude | run `claude`, then `/login` (expired OAuth sessions show as "OAuth session expired") |
| Codex | `codex login` (a ChatGPT workspace may need to allow Codex) |
| Gemini | API key via `GEMINI_API_KEY`, or `gemini` → `/auth` |

You can do this from any paired device: start the agent in **Terminal** mode and run the login flow there.

## Overrides

Settings → Agents lets you, per agent:

- enable or disable it
- choose the default mode (structured or terminal)
- set the default auto-approve level
- override the structured launch command and arguments, plus environment variables

Example: point Claude at a different ACP adapter, or add `--model` flags.

## Echo test agent

Start the hub with `--test-agent` (or `AGENT_HUB_TEST_AGENT=1`) to register **Echo Agent (test)**. It's a scripted
ACP agent used by the automated tests:

| Prompt contains | Behaviour |
|---|---|
| `/perm` | runs a fake `echo hello` tool that asks for permission |
| `/edit` | reports a file edit with a diff |
| `/plan` | publishes a plan |
| `/slow` | works for about 4 seconds (useful for testing queueing and cancel) |
| `/fail` | fails the turn |
| `/delegate <agent> <prompt>` | calls the hub MCP `delegate_task` tool and replies with the result |
