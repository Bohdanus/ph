# WSL2 Setup

This guide prepares the photo editor for development inside WSL2. Keeping the
checkout in Linux's filesystem provides reliable Linux tooling and avoids the
slower file access that comes from running npm and Git against `/mnt/c`.

## Install WSL2

In an elevated PowerShell, install WSL and Ubuntu:

```powershell
wsl --install --distribution Ubuntu-24.04
```

Restart Windows if prompted, launch Ubuntu, and create its Linux user. Confirm
that the distribution uses WSL2 from PowerShell:

```powershell
wsl --list --verbose
```

If Ubuntu shows version `1`, convert it with:

```powershell
wsl --set-version Ubuntu-24.04 2
```

WSL2 needs hardware virtualization enabled in the PC's firmware and the Windows
Virtual Machine Platform feature. If installation reports either is unavailable,
enable it and follow Microsoft's WSL installation troubleshooting steps.

## Clone and install

Clone the repository into the Linux filesystem, not under `/mnt/c`:

```bash
mkdir -p ~/src
git clone https://github.com/drguz69/lightshopy.com.git ~/src/ph
cd ~/src/ph
```

The project requires Node.js 24 or newer and npm 10 or newer. Install Node with
nvm, using the project's `.nvmrc`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install
nvm use
```

Run the setup script from the repository root:

```bash
bash scripts/wsl-setup.sh
```

It installs locked npm dependencies, installs Chrome and its Linux dependencies
using the same Playwright command as CI, then runs the authoritative TypeScript
check. Playwright may prompt for `sudo` while installing system packages. Run the
script as your regular Ubuntu user, not as `root`.

To perform those steps manually instead:

```bash
npm ci
npx playwright install --with-deps chrome
npm run tsc
```

## Run the project

From the repository root:

```bash
npm run dev
```

Open `http://localhost:5173` in a browser on Windows or inside WSL. WSL's
localhost forwarding normally makes the development server available to Windows.
If it is not reachable, start Vite with `npm run dev -- --host 0.0.0.0` and use
the WSL IP address from Windows. Find that address inside WSL with
`hostname -I | awk '{print $1}'`.

Run the headless checks with:

```bash
npm run test
npm run test:e2e:unit
npm run test:e2e
```

The E2E wrapper starts its own development server. Linux visual-regression
baselines are already committed, and WSL uses those Linux baselines. Do not
update them locally; baseline updates go through the documented mirror workflow
in [`E2E-MIRROR.md`](E2E-MIRROR.md).

## Notes

- Keep the WSL checkout, `node_modules`, and Git operations inside the Linux
  filesystem. A Windows checkout under `/mnt/c` is a separate working copy; do
  not share its `node_modules` with WSL.
- If GitHub access needs authentication, configure an SSH key or credential
  manager for WSL rather than copying private keys into the Linux filesystem.
