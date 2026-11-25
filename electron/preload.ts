import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopUpdateStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  version?: string;
  currentVersion: string;
  percent?: number;
  bytesPerSecond?: number;
  releaseUrl?: string;
  message?: string;
}

export interface DesktopAppInfo {
  version: string;
  isPackaged: boolean;
  platform: string;
  githubRepo: string;
  releasesUrl: string;
  updateStatus: DesktopUpdateStatus;
}

contextBridge.exposeInMainWorld('veloframeDesktop', {
  getAppInfo: (): Promise<DesktopAppInfo> => ipcRenderer.invoke('veloframe:get-app-info'),
  checkForUpdates: (): Promise<DesktopUpdateStatus> =>
    ipcRenderer.invoke('veloframe:check-updates'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('veloframe:download-update'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('veloframe:install-update'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('veloframe:open-external', url),
  onUpdateStatus: (callback: (status: DesktopUpdateStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: DesktopUpdateStatus) => {
      callback(payload);
    };
    ipcRenderer.on('veloframe:update-status', handler);
    return () => ipcRenderer.removeListener('veloframe:update-status', handler);
  },
});
