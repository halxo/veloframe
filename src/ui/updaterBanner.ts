import { getDesktopAPI, type DesktopUpdateStatus } from '../desktop/bridge';

/**
 * In-app Auto-Updater UI banner wired to Electron's electron-updater (GitHub Releases).
 * Displays live download progress and a one-click "Restart & Install" action.
 */
export class UpdaterBanner {
  private container: HTMLElement;
  private textEl: HTMLElement;
  private progressBar: HTMLElement;
  private progressFill: HTMLElement;
  private actionBtn: HTMLButtonElement;
  private dismissBtn: HTMLButtonElement;
  private showToast: (msg: string) => void;
  private currentVersion = '1.0.0';

  constructor(showToast: (msg: string) => void) {
    this.showToast = showToast;

    this.container = document.createElement('div');
    this.container.className = 'vf-updater-banner';
    this.container.style.display = 'none';

    const info = document.createElement('div');
    info.className = 'vf-updater-info';

    this.textEl = document.createElement('div');
    this.textEl.className = 'vf-updater-text';

    this.progressBar = document.createElement('div');
    this.progressBar.className = 'vf-updater-progress';
    this.progressBar.style.display = 'none';
    this.progressFill = document.createElement('div');
    this.progressFill.className = 'vf-updater-progress-fill';
    this.progressBar.appendChild(this.progressFill);

    info.append(this.textEl, this.progressBar);

    const actions = document.createElement('div');
    actions.className = 'vf-updater-actions';

    this.actionBtn = document.createElement('button');
    this.actionBtn.className = 'vf-updater-btn primary';
    this.actionBtn.style.display = 'none';

    this.dismissBtn = document.createElement('button');
    this.dismissBtn.className = 'vf-updater-btn';
    this.dismissBtn.textContent = 'Dismiss';
    this.dismissBtn.addEventListener('click', () => {
      this.container.style.display = 'none';
    });

    actions.append(this.actionBtn, this.dismissBtn);
    this.container.append(info, actions);
    document.body.appendChild(this.container);

    const desktop = getDesktopAPI();
    if (desktop) {
      void desktop.getAppInfo().then((appInfo) => {
        this.currentVersion = appInfo.version;
        if (appInfo.updateStatus.state !== 'idle') {
          this.applyStatus(appInfo.updateStatus, false);
        }
      });
      desktop.onUpdateStatus((status) => this.applyStatus(status, true));
    }
  }

  public getVersion(): string {
    return this.currentVersion;
  }

  public async checkForUpdates(): Promise<void> {
    const desktop = getDesktopAPI();
    if (!desktop) {
      this.showToast('Desktop auto-updater runs inside the VeloFrame Windows .exe app');
      return;
    }
    this.showToast('Checking GitHub Releases for updates…');
    const status = await desktop.checkForUpdates();
    this.applyStatus(status, true);
  }

  private applyStatus(status: DesktopUpdateStatus, interactive: boolean): void {
    const desktop = getDesktopAPI();
    this.currentVersion = status.currentVersion;

    if (status.state === 'checking') {
      this.container.style.display = 'flex';
      this.textEl.textContent = status.message ?? 'Checking GitHub for updates…';
      this.progressBar.style.display = 'none';
      this.actionBtn.style.display = 'none';
      return;
    }

    if (status.state === 'available' || status.state === 'downloading') {
      this.container.style.display = 'flex';
      const pct = status.percent ?? 0;
      this.textEl.textContent =
        status.message ?? `Downloading VeloFrame v${status.version ?? ''} (${pct}%)…`;
      this.progressBar.style.display = 'block';
      this.progressFill.style.width = `${Math.max(4, pct)}%`;
      this.actionBtn.style.display = 'none';
      return;
    }

    if (status.state === 'downloaded') {
      this.container.style.display = 'flex';
      this.textEl.textContent = `VeloFrame v${status.version ?? ''} downloaded from GitHub and ready to install.`;
      this.progressBar.style.display = 'none';
      this.actionBtn.style.display = 'inline-flex';
      this.actionBtn.textContent = 'Restart & Install';
      this.actionBtn.onclick = () => {
        void desktop?.installUpdate();
      };
      return;
    }

    if (status.state === 'not-available') {
      this.container.style.display = 'none';
      if (interactive) {
        this.showToast(status.message ?? `VeloFrame v${status.currentVersion} is up to date`);
      }
      return;
    }

    if (status.state === 'error' && interactive) {
      this.container.style.display = 'flex';
      this.textEl.textContent = `Update check failed: ${status.message ?? 'Network error'}`;
      this.progressBar.style.display = 'none';
      this.actionBtn.style.display = 'inline-flex';
      this.actionBtn.textContent = 'Open GitHub Releases';
      this.actionBtn.onclick = () => {
        if (status.releaseUrl) void desktop?.openExternal(status.releaseUrl);
      };
    }
  }
}
