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

export interface VeloFrameDesktopAPI {
  getAppInfo: () => Promise<DesktopAppInfo>;
  checkForUpdates: () => Promise<DesktopUpdateStatus>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  onUpdateStatus: (callback: (status: DesktopUpdateStatus) => void) => () => void;
}

declare global {
  interface Window {
    veloframeDesktop?: VeloFrameDesktopAPI;
  }
}

export function getDesktopAPI(): VeloFrameDesktopAPI | null {
  return typeof window !== 'undefined' && window.veloframeDesktop ? window.veloframeDesktop : null;
}
