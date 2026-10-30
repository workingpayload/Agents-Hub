# Agent Hub

A local hub for your coding agents. **GitHub Copilot CLI, Claude Code, OpenAI Codex CLI and Gemini CLI** run side by
side and **delegate work to each other**. You control them from the desktop app or from **any phone, tablet or laptop on
your network**: send prompts, answer permission requests, start and stop agents, and review their changes.

```
 Phone / tablet / laptop (PWA) ──HTTPS + WSS (paired token)──┐
                                                            ▼
 Desktop app (Electron tray) ──► Hub daemon (Node) ── ACP ──► copilot · claude · codex · gemini
                                   │  permission broker   ▲          │
                                   │  orchestrator        └── MCP ───┘  (agents delegate via hub tools)
                                   └─ SQLite event log, web push, git worktrees
```

## Features

- **One place for every agent.** Each agent is driven over the [Agent Client Protocol](https://agentclientprotocol.com)
  (ACP), so you get a rich chat with streaming output, plans, tool calls, diffs, modes and model selection.
  A **terminal mode** mirrors the agent's real interactive CLI in the browser (xterm.js) for anything ACP can't do.
- **Remote control on your LAN.** Pair a device by scanning a QR code or typing a 6-digit PIN. Paired devices get full
  control: prompt, approve or deny, start, stop, hand off and review diffs. The UI is an installable, mobile-first PWA.
- **Central permission broker.** Every tool permission and delegation request from every session goes into one queue.
  It's pushed to all your devices, and the first answer wins. Per-agent and per-session auto-approve levels
  (`none` / `read` / `edits` / `all`), an optional timeout, and an audit log of who approved what, from which device.
- **Agent ↔ agent orchestration.** The hub injects its own MCP server (`agent-hub`) into every structured session.
  Agents can call `list_agents`, `delegate_task`, `wait_for_task`, `get_task`, `send_message`, `list_tasks` and
  `cancel_task`.
  - Delegations need your approval by default; set this per session (`ask` / `auto` / `deny`).
  - Guardrails: maximum depth, maximum concurrent sessions, task time limit and loop detection.
  - A **Stop all** kill switch stops everything.
- **Manual hand-off.** Send any agent's output to another agent, either a new session or one that's already running.
- **Workspaces.** Agents share a project folder by default. Optionally, each gets an **isolated git worktree and branch**
  that you can commit, merge back or remove from the UI.
- **Notifications.** Web Push to paired devices and native notifications in the desktop app. Triggers: approval needed,
  agent finished, delegated task done, agent crashed.
- **Durable history.** Every session is an append-only event log in SQLite, so devices reconnect and replay seamlessly.
- **Liquid-glass UI.** Translucent, blurred glass panels over a slow ambient light layer, with iridescent rims and a
  sliding glass indicator in the navigation. Built to stay usable:
  - fonts: DM Sans for text, Space Grotesk for headings, Fira Code for code, all bundled with the app
  - WCAG 2.1 AA contrast, checked automatically with axe in the browser tests
  - visible keyboard focus, and focus stays inside open dialogs
  - touch targets at least 44 px on phones
  - `prefers-reduced-motion` turns animations off
  - a solid background fallback for browsers without backdrop blur

## Quick start

Requirements: Node.js ≥ 22.13 (24 recommended), git, and the agent CLIs you want to use, installed and **logged in**.

```powershell
npm install
npm run build          # web UI + hub + desktop shell
npm run desktop        # desktop app (tray icon + window); starts the hub for you
# or run headless:
npm run serve          # prints a login link for this computer and the LAN addresses
node packages/hub/dist/cli.js serve --pair   # also prints a pairing QR code + PIN in the terminal
```

Then, on another device on the same network:

1. In the desktop app, open **Settings → Devices → Pair a new device** (or run `serve --pair`).
2. Scan the QR code with your phone, or open `https://<host-ip>:7443/pair` and type the PIN.
3. Optional but recommended: open `/setup` on the device and install the hub certificate. You need it for push
   notifications and "Add to Home Screen" / "Install app" (see [docs/security.md](docs/security.md)).

Windows asks to allow Node/Agent Hub through the firewall the first time the LAN listener starts, but it only creates
the rule for the network type you're on at that moment (Public or Private). If a phone later shows **"page not
reachable"**, open **Settings → Security** (or the pairing panel). The hub checks Windows Firewall for your current
network, and in the desktop app you can fix it with **Allow through Windows Firewall** (also in the tray menu). To add
the rule manually (admin PowerShell):

```powershell
New-NetFirewallRule -DisplayName "Agent Hub (LAN)" -Direction Inbound -Protocol TCP -LocalPort 7443 -Action Allow -Profile Private -RemoteAddress LocalSubnet
```

Also check that the phone is on the same Wi-Fi (not mobile data, a guest network or a VPN), and that your home Wi-Fi
is set to **Private** in Windows.

### CLI options

```
agent-hub serve [--port 7443] [--local-port 7780] [--host 0.0.0.0] [--no-lan]
                [--data-dir DIR] [--web-dir DIR] [--pair] [--test-agent] [--log-level info]
agent-hub token            # print this computer's login token
```

Environment overrides: `AGENT_HUB_DATA_DIR`, `AGENT_HUB_PORT`, `AGENT_HUB_LOCAL_PORT`, `AGENT_HUB_LOG_LEVEL`,
`AGENT_HUB_TEST_AGENT=1`. Data lives in `%APPDATA%\AgentHub` (Windows) or `~/.agent-hub`. The CLI and the desktop
app share it, and the desktop app attaches to an already-running hub.

## Agents

| Agent | Structured (chat) mode | Terminal mode |
|---|---|---|
| GitHub Copilot CLI | native ACP: `copilot --acp` | `copilot` |
| Claude Code | [`@agentclientprotocol/claude-agent-acp`](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp) (bundled) | `claude` |
| OpenAI Codex CLI | [`@agentclientprotocol/codex-acp`](https://www.npmjs.com/package/@agentclientprotocol/codex-acp) (bundled) | `codex` |
| Gemini CLI | native ACP: `gemini --acp` | `gemini` |

Agents use their own credentials (`~/.copilot`, `~/.claude`, `~/.codex`, `~/.gemini`). If a session reports an
authentication error, log in once with the CLI. You can do that remotely too: start the agent in **Terminal** mode and
run its login command (`/login`, `copilot login`, `codex login`, …). Per-agent launch commands, arguments and
environment variables (for example `GEMINI_API_KEY`) can be overridden in **Settings → Agents**.
See [docs/agents.md](docs/agents.md).

## How delegation works

Ask an agent something like *"Use the agent-hub tools to have claude review src/auth.ts, then fix what it finds"*.
The agent calls `delegate_task`. You get an approval request on every device. Once you allow it, the hub starts a
child session for the other agent in the same folder, or in its own worktree if `isolation: "worktree"` is set. The
child's final reply goes back to the first agent as the tool result. The **Delegations** page shows the live tree, and
you can open and steer any sub-session.

## Development

```powershell
npm run dev            # hub from source (tsx watch) on 127.0.0.1:7780 + LAN :7443
npm run dev:web        # Vite dev server on :5173, proxying /api and /ws to the hub
npm test               # unit + integration tests (vitest; uses the scripted Echo agent)
npm run test:e2e       # Playwright UI tests (desktop + phone viewports; uses installed Edge/Chrome)
npm run typecheck
npm run dist:win       # Windows installer → packages/desktop/release/
```

Start the hub with `--test-agent` to get **Echo Agent (test)**, a scripted ACP agent. It responds to `/perm`, `/edit`,
`/plan`, `/slow`, `/fail` and `/delegate <agent> <prompt>`, which is handy for trying the UI without spending credits.

```
packages/
  shared/   domain types, API schemas (zod), timeline reducer
  hub/      daemon: Fastify HTTP/WS, ACP + PTY adapters, permission broker, orchestrator, MCP server, SQLite
  web/      React + Vite + Tailwind PWA (served by the hub)
  desktop/  Electron shell: tray, hub lifecycle, native notifications, installer
e2e/        Playwright tests
docs/       agents, security & pairing
```
"# Agents-Hub" 
