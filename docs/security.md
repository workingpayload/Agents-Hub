# Security & pairing

Agent Hub lets other devices drive agents that can run commands on your computer. Treat a paired device like a
keyboard attached to it.

## Listeners

| Listener | Address | Used by | Auth |
|---|---|---|---|
| HTTPS (LAN) | `0.0.0.0:7443` (`--port`, `--host`, `--no-lan`) | paired phones, tablets, laptops | device bearer token |
| HTTP (loopback) | `127.0.0.1:7780` (`--local-port`) | desktop app, local browser, agents' MCP calls | device token; MCP uses per-session tokens |

- The loopback listener only answers requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]`, which blocks DNS
  rebinding. WebSocket connections are origin-checked.
- The MCP endpoints (`/mcp`, `/api/mcp/*`) exist **only** on the loopback listener. Each structured session gets a
  random MCP token that dies with the session, and it can only see and act on its own tasks.
- Nothing is exposed to the internet. Web Push messages go out through the browser vendor's push service.
- Windows Firewall: the recommended rule (**Allow through Windows Firewall** in the desktop app, or the command in the
  README) opens TCP 7443 only on **Private** networks and only to the **local subnet**.
  `GET /api/network/diagnostics` reports whether the active network allows inbound connections.

## Pairing

1. Choose **Pair a new device** on an already-trusted device (the desktop app, or `agent-hub serve --pair`).
2. The hub creates a one-time ticket, valid for 5 minutes:
   - a 192-bit random code, embedded in a QR link (`https://<ip>:7443/pair#code=…`)
   - a 6-digit PIN
3. The new device swaps the code or PIN for a 256-bit **device token**. Only its SHA-256 hash is stored.
4. Limits:
   - 5 failed attempts per IP in 10 minutes → HTTP 429
   - 10 failed attempts on one ticket → the ticket is invalidated
   - a ticket can be used once
5. Rename or revoke devices under **Settings → Devices**. Revoking a device disconnects its sockets immediately and
   deletes its push subscriptions.

This computer gets a local token stored in `<data dir>/local-token` (inside your user profile, which other users of the
machine can't read). The desktop app reads it to sign in. `agent-hub serve` prints a `…/login#token=…` link that uses it.

## Certificates

On first start the hub creates a **private certificate authority** (RSA-2048, 10 years) and a server certificate
signed by it. The server certificate is valid for 397 days and lists `localhost`, the host name, `<host>.local`,
`agenthub.local`, `127.0.0.1`, `::1` and every LAN IPv4 address. It is regenerated automatically when your IP
addresses change or it nears expiry. Files live in `<data dir>/tls/`.

Browsers only allow service workers, push notifications and app installation on a **trusted** HTTPS origin. Install
the CA once on each device:

- Open `https://<host-ip>:7443/setup` on the device. Accept the warning the first time.
- Download the certificate and follow the steps for iOS, Android, Windows or macOS.
- Check that the SHA-256 fingerprint matches the one in **Settings → Security** on the host.

Without the CA, devices can still pair and use the UI after accepting the certificate warning. They just won't get
push notifications.

## Agent permissions

- Every `session/request_permission` from an agent becomes a pending request that's broadcast to all devices. The
  first answer wins; later answers get `409 Already resolved`.
- Auto-approve levels:

  | Level | Approves automatically |
  |---|---|
  | `none` | nothing |
  | `read` | read, search, think, fetch |
  | `edits` | `read` plus edit, delete, move |
  | `all` | everything |

  Delegations are never auto-approved by these levels; they follow the session's delegation policy.
- Optional approval timeout (Settings → General). An expired request is answered with the agent's "reject" option.
- Every decision, pairing, setting change, merge and stop is recorded in the audit log (Settings → Security).
- **Stop all** cancels every pending approval and delegated task, and stops every agent process.

## Orchestration guardrails

| Setting | Default |
|---|---|
| Delegation policy for new sessions | `ask` |
| Maximum delegation depth | 2 |
| Maximum concurrent sessions | 8 |
| Task time limit | 30 minutes |
| Loop detection | on (rejects re-delegating an ancestor's prompt to the same agent) |

Stopping a parent session also stops the sub-agents it started.
