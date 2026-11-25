import type { AssetRecord } from '../model/types';

type AssetResolver = (assetId: string) => Promise<AssetRecord | null>;

/**
 * High-speed ImageBitmap / HTMLImageElement decode cache with LRU eviction
 * so high-resolution images render at 120fps without blocking the main thread.
 */
export class ImageCache {
  private bitmaps = new Map<string, ImageBitmap | HTMLImageElement>();
  private loading = new Set<string>();
  private dataUrls = new Map<string, string>();
  private maxEntries: number;
  private resolver: AssetResolver;
  private onDecode: () => void;

  constructor(resolver: AssetResolver, onDecode: () => void, maxEntries = 96) {
    this.resolver = resolver;
    this.onDecode = onDecode;
    this.maxEntries = maxEntries;
  }

  registerDataUrl(assetId: string, dataUrl: string): void {
    this.dataUrls.set(assetId, dataUrl);
    void this.decodeFromDataUrl(assetId, dataUrl);
  }

  getDataUrl(assetId: string): string | undefined {
    return this.dataUrls.get(assetId);
  }

  getDrawable(assetId: string): ImageBitmap | HTMLImageElement | null {
    const existing = this.bitmaps.get(assetId);
    if (existing) {
      // Refresh LRU order
      this.bitmaps.delete(assetId);
      this.bitmaps.set(assetId, existing);
      return existing;
    }

    if (!this.loading.has(assetId)) {
      this.loading.add(assetId);
      void this.loadAsset(assetId);
    }
    return null;
  }

  private async loadAsset(assetId: string): Promise<void> {
    try {
      let dataUrl = this.dataUrls.get(assetId);
      if (!dataUrl) {
        const record = await this.resolver(assetId);
        if (!record) return;
        dataUrl = record.dataUrl;
        this.dataUrls.set(assetId, dataUrl);
      }
      await this.decodeFromDataUrl(assetId, dataUrl);
    } finally {
      this.loading.delete(assetId);
    }
  }

  private async decodeFromDataUrl(assetId: string, dataUrl: string): Promise<void> {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        this.put(assetId, bitmap);
      } else {
        const img = await this.loadHtmlImage(dataUrl);
        this.put(assetId, img);
      }
      this.onDecode();
    } catch {
      try {
        const img = await this.loadHtmlImage(dataUrl);
        this.put(assetId, img);
        this.onDecode();
      } catch {
        // Ignore corrupted asset decode failure
      }
    }
  }

  private loadHtmlImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = src;
    });
  }

  private put(assetId: string, drawable: ImageBitmap | HTMLImageElement): void {
    if (this.bitmaps.size >= this.maxEntries) {
      const oldestKey = this.bitmaps.keys().next().value;
      if (oldestKey !== undefined) {
        const old = this.bitmaps.get(oldestKey);
        if (old && 'close' in old && typeof old.close === 'function') {
          old.close();
        }
        this.bitmaps.delete(oldestKey);
      }
    }
    this.bitmaps.set(assetId, drawable);
  }
}
