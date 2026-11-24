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

Binding to `0.0.0.0` listens on all WSL interfaces; depending on WSL networking
and firewall settings, the server may be reachable from other devices on your
local network. Use it only on a trusted network, and stop the server when done.

## OpenRouter key for free-model tools

The free-model runner reads `OPENROUTER_API_KEY` from the process environment.
It does not read Kilo's saved OpenRouter credential. Do not assume a Windows
environment variable is available to WSL; set the key in the environment that
launches Node. Prefer a secret manager. Do not pass the key as a command-line
argument, print it, save it in the repository, or add it to `.bashrc` or
`.profile`.

For a one-time check from a WSL task worktree, explicitly load Linux Node for
non-interactive shells, then enter the key without echoing it:

```bash
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
source "$NVM_DIR/nvm.sh"
nvm use
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY
printf '\n'
export OPENROUTER_API_KEY
node scripts/free-model-pool.mjs --openrouter-quota
unset OPENROUTER_API_KEY
```

In Windows PowerShell, the same quota check can use a hidden prompt for the
current process. `SecureString` hides the prompt, but Node still needs the key
as plaintext in its inherited process environment. This avoids console echo and
persistent shell configuration; it does not protect the value from process-memory
inspection. Use a secret manager for stricter handling.

```powershell
$secret = Read-Host 'OpenRouter API key' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:OPENROUTER_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  node scripts/free-model-pool.mjs --openrouter-quota
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Item Env:OPENROUTER_API_KEY -ErrorAction SilentlyContinue
  Remove-Variable secret, ptr -ErrorAction SilentlyContinue
}
```

`--openrouter-quota` calls OpenRouter's `GET /api/v1/key` endpoint and sends no
inference request. A `no_key` result means the variable is unset or empty in the current process.
An HTTP `401` normally means OpenRouter rejected the bearer key. In a documented
2026 infrastructure incident, an authorization lookup outage returned `401
"User not found"`; OpenRouter's report says it deployed a correction to return
`503` for infrastructure authorization lookup failures. If a `401` is unexpected,
check [OpenRouter status](https://status.openrouter.ai/); if it persists while the
service is healthy, confirm the key is enabled before replacing it.
If the endpoint returns HTTP 429, wait before retrying. For HTTP 5xx, check status and try again later.
Neither response by itself proves the key is invalid.
See the [quota endpoint reference](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
and [OpenRouter's incident report](https://openrouter.ai/blog/announcements/openrouter-outages-on-february-17-and-19-2026).

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

- For non-interactive WSL shells, verify that Linux Node is selected before
  running project commands. If the repository uses nvm and `node` is missing
  while `npm` resolves under `/mnt/c/Program Files/nodejs`, initialize nvm in
  that shell and confirm both executables and versions:

  ```bash
  source "$HOME/.nvm/nvm.sh"
  nvm use
  command -v node npm
  node --version
  npm --version
  ```

- Run Git and npm from a WSL-owned worktree under the Linux clone. A Windows
  linked worktree opened through `/mnt/c` may have a `.git` file whose absolute
  `gitdir` is a Windows path; WSL Git interprets that path incorrectly and can
  report “not a git repository.” Keep the Windows and WSL repositories and
  linked worktrees separate, and confirm `git rev-parse --show-toplevel` and
  `git rev-parse --git-dir --git-common-dir` before proceeding.

- If you also use a Windows checkout, keep its Git operations and dependencies
  with Windows. See [Windows Gotchas](WINDOWS-GOTCHAS.md) before using both
  environments against a checkout.

- Keep the WSL checkout, `node_modules`, and Git operations inside the Linux
  filesystem. A Windows checkout under `/mnt/c` is a separate working copy; do
  not share its `node_modules` with WSL.
- If GitHub access needs authentication, configure an SSH key or credential
  manager for WSL rather than copying private keys into the Linux filesystem.
