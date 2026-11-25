import { SLIDE_HEIGHT, SLIDE_WIDTH, type Point } from '../model/types';

export class Viewport {
  panX = 0;
  panY = 0;
  zoom = 0.5;
  minZoom = 0.1;
  maxZoom = 6;
  width = 1280;
  height = 720;

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  fitToSlide(slideWidth = SLIDE_WIDTH, slideHeight = SLIDE_HEIGHT, padding = 64): void {
    const availW = Math.max(100, this.width - padding * 2);
    const availH = Math.max(100, this.height - padding * 2);
    const scale = Math.min(availW / slideWidth, availH / slideHeight);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, scale));
    this.panX = (this.width - slideWidth * this.zoom) * 0.5;
    this.panY = (this.height - slideHeight * this.zoom) * 0.5;
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    if (nextZoom === this.zoom) return;
    const worldBefore = this.screenToWorld(screenX, screenY);
    this.zoom = nextZoom;
    this.panX = screenX - worldBefore.x * this.zoom;
    this.panY = screenY - worldBefore.y * this.zoom;
  }

  setZoomCentered(targetZoom: number): void {
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const clamped = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));
    this.zoomAt(cx, cy, clamped / this.zoom);
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  screenToWorld(screenX: number, screenY: number): Point {
    return {
      x: (screenX - this.panX) / this.zoom,
      y: (screenY - this.panY) / this.zoom,
    };
  }

  worldToScreen(worldX: number, worldY: number): Point {
    return {
      x: worldX * this.zoom + this.panX,
      y: worldY * this.zoom + this.panY,
    };
  }
}
