# AnSSH

[![CI](https://github.com/rodinm/anssh/actions/workflows/ci.yml/badge.svg)](https://github.com/rodinm/anssh/actions/workflows/ci.yml)

Desktop **SSH / SFTP client** (Electron) for operators who work with **Ansible** and large host lists: encrypted credential vault, jump hosts, SSH tunnels, broadcast to many sessions, and tooling that stays close to your git-based inventory.

## Downloads

Pre-built installers for macOS (Intel + Apple Silicon) and Windows (x64) are on [**GitHub Releases**](https://github.com/rodinm/anssh/releases).

| Platform | Artifacts (typical) |
|----------|---------------------|
| macOS | `.dmg` (x64, arm64), `.zip` |
| Windows | NSIS `Setup` `.exe`, portable `.exe` |

macOS and Windows builds are **not code-signed** in the default workflow; Gatekeeper / SmartScreen may show warnings. For distribution outside your team, set up signing and notarization (macOS) and a code signing cert (Windows).

## Features

- **SSH terminal** (xterm.js) with search, local command history, font zoom, reconnect.
- **SFTP** dual-pane (local ↔ remote), queue, drag-and-drop.
- **Host list** with groups, tags, bulk delete, context menu (SSH / SFTP / edit).
- **Credentials vault** (AES-256-GCM) for passwords and keys.
- **Jump host (ProxyJump)** and **per-host SSH tunnel presets** (local / remote / SOCKS).
- **Snippets** (quick commands) with global / group / host scope.
- **Broadcast**: send one command to multiple terminal sessions.
- **Import / export** of host profiles (JSON, no secrets in export).
- **Themes**: dark / light (TUI-friendly ANSI colors in light mode).

## Ansible & inventory (git)

Open **Ansible+** in the sidebar (or the folder-git icon in the tab bar when tabs are open).

### Git sync & diff

- Point the app at a **local clone** of your inventory repository (path to the repo root).
- Configure **branch**, path to the **inventory file inside the repo**, and optional **interval** for automatic `git fetch` / `git pull` (merge is not automatic; you review first).
- **Git pull** updates the clone; **Preview diff** compares the parsed inventory to hosts already in AnSSH:
  - **Added** — new inventory aliases.
  - **Removed** — hosts that were tied to an inventory alias and disappeared from the file.
  - **Updated** — address, group, or tags-from-vars changes.
- **Apply** merges into the app:
  - Optionally **create missing groups** (named like Ansible groups).
  - Optionally **delete** hosts that are no longer in inventory (only those tracked by an **inventory alias**).

### Groups ↔ Ansible

- Each group can have an **Ansible inventory group name** (set when creating a group, or implied when groups are created on apply).
- Sync maps inventory groups to app groups using `ansibleGroupName` or a matching **group name**.

### Tags from `host_vars` / `group_vars`

- Configure **relative paths** to `host_vars` and `group_vars` under the repo root.
- The app reads YAML and merges the Ansible `tags:` list into **Tags from host_vars / group_vars** on each host (shown in the host editor when present).

### Run playbooks

- **Playbooks** tab: working directory, playbook path, inventory path (relative to repo or absolute), **limit** (`-l`), **dry-run** (`--check`), then **Run ansible-playbook** (requires `ansible-playbook` on your `PATH`).
- **Saved commands**: store reusable extra-arg lines for frequent playbooks.

### Browse repository

- **Browse repo** tab: load a **directory tree** (shallow depth) and **search** plain-text files (`.yml`, `.yaml`, `.ini`, etc.) for a string — quick “where is this task?” without leaving the app.

## Connection profiles

- **Profiles** tab: named presets with a default **jump host** (and room for tunnel presets in data model).
- Assign a **connection profile** on a host; if the host has no explicit jump, the profile’s jump is used. **Host jump overrides** the profile when set.
- **Tunnel presets** from the profile are merged **before** host-specific tunnel presets when opening a session.

## Health check

- **Health** tab: select hosts and run a **TCP connect** to port 22 (no SSH login), reporting **success** and **latency** — quick preflight before playbooks.

## One-off Ansible file import

- **Inventory** in the sidebar imports a single inventory file from disk (INI/YAML) without git — useful for ad-hoc files.

## Development

```bash
npm install
npm run dev          # Vite + tsc watch
npm run build        # Icons + main + renderer
npm start            # Run Electron on dist
npm run pack:mac     # macOS installers → release/
npm run pack:win     # Windows installers → release/
```

Requires **git** on `PATH` for inventory pull. Requires **ansible-playbook** on `PATH` for playbook runs.

## Security notes

- Vault password encrypts stored credentials; there is no recovery.
- Exported profiles omit credential IDs; re-link credentials after import on a new machine.

## License

MIT — see [LICENSE](./LICENSE).
