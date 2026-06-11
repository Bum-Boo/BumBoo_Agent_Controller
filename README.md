# BumBoo Agent Controller

A local Electron controller for running and supervising Hermes Agent profiles on Windows + WSL.

The controller is intentionally **local-first**. It does not bundle Hermes, tokens, profiles, memories, or chat data. Each user registers their own WSL/Hermes paths in the app settings.

## Features

- View Hermes profile and gateway status
- Start/stop individual profile gateways
- Change model/reasoning settings with automatic config backups
- Mark and clear "restart needed" state after runtime config changes
- Restore previous profile config backups
- View recent per-profile log summaries
- View a combined all-profile gateway log stream from Settings
- Optional gateway crash detection and bounded auto-restart
- WSL memory limit helper for Windows hosts

## Requirements

- Windows 10/11
- WSL2
- Node.js + npm
- Hermes Agent installed inside WSL
- At least one Hermes profile configured
- `tmux` inside WSL is recommended for persistent gateway starts

## Install and run from source

```bash
git clone https://github.com/Bum-Boo/BumBoo_Agent_Controller.git
cd BumBoo_Agent_Controller
npm install
npm run build
npm start
```

For development:

```bash
npm run dev
npm run electron
```

## First-run setup

Open **Settings → Hermes 연결 설정** and register your local environment:

- **WSL 배포판**: the name from `wsl.exe -l -q` (for example `Ubuntu` or `Ubuntu-22.04`)
- **Hermes 명령**: usually `hermes`; use an absolute path only if Hermes is not on PATH
- **Hermes Home**: the directory containing `profiles/`, config, state, and logs (for example `/home/alice/.hermes`)
- **Lab Root**: the working directory where Hermes commands should run (for example `/home/alice/hermes-lab`)
- **Dashboard URL**: usually `http://127.0.0.1:9119`

Use **자동 탐지** to find candidates, then **연결 테스트**. Save only after the checks pass.

The saved controller config is stored in Electron user data for your Windows account, not in this repository.

## Privacy and safety

Do not commit these files or directories:

- `.env`
- `.hermes/`
- `profiles/`
- `memories/`
- gateway logs and pid/state files
- session databases
- personal `controller.config.json`

The included `.gitignore` excludes these by default.

## Portable configuration

Source code does not require a hardcoded username or local path. At runtime the controller loads settings in this order:

1. Local app config saved from the Settings panel
2. Environment variables such as `HERMES_HOME`, `HERMES_LAB_ROOT`, `HERMES_CONTROLLER_DISTRO`
3. Safe defaults (`Ubuntu`, `hermes`, `http://127.0.0.1:9119`)

See `controller.config.example.json` for the shape of the config.

## Build verification

```bash
npm run build
```

## License

MIT
