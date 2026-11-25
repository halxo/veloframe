import {
  bboxesIntersect,
  computeNodeBBox,
  degToRad,
  expandBBox,
  getSelectionBBox,
} from '../model/geometry';
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type BBox,
  type EllipseNode,
  type ImageNode,
  type LineNode,
  type RectNode,
  type SceneNode,
  type Slide,
  type SlideBackground,
  type SnapGuide,
  type TextNode,
} from '../model/types';
import type { ImageCache } from './imageCache';
import { RTree } from './rtree';
import type { Viewport } from './viewport';

export interface RenderOverlayState {
  selectedIds: Set<string>;
  editingNodeId: string | null;
  marqueeRect: BBox | null;
  snapGuides: SnapGuide[];
  hoveredNodeId: string | null;
}

export interface FrameMetrics {
  fps: number;
  lastFrameMs: number;
  dirtyRectCount: number;
  culledNodeCount: number;
  totalNodeCount: number;
}

export function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5));
  ctx.beginPath();
  if (radius <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function fillSlideBackground(
  ctx: CanvasRenderingContext2D,
  bg: SlideBackground,
  width = SLIDE_WIDTH,
  height = SLIDE_HEIGHT,
): void {
  if (bg.type === 'gradient' && bg.gradientEnd) {
    const rad = degToRad(bg.gradientAngle ?? 135);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const len = Math.hypot(width, height) * 0.5;
    const dx = Math.cos(rad) * len;
    const dy = Math.sin(rad) * len;
    const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    grad.addColorStop(0, bg.color);
    grad.addColorStop(1, bg.gradientEnd);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = bg.color;
  }
  ctx.fillRect(0, 0, width, height);
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  const safeMaxW = Math.max(20, maxWidth);

  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p];
    if (para.length === 0) {
      lines.push('');
      continue;
    }
    const words = para.split(' ');
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const candidate = `${currentLine} ${words[i]}`;
      if (ctx.measureText(candidate).width <= safeMaxW) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = words[i];
      }
    }
    lines.push(currentLine);
  }
  return lines;
}

function drawTextWithTracking(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
  align: 'left' | 'center' | 'right',
): void {
  if (letterSpacing === 0) {
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    return;
  }

  // Compute total width including tracking
  let totalW = 0;
  for (let i = 0; i < text.length; i++) {
    totalW += ctx.measureText(text[i]).width + (i < text.length - 1 ? letterSpacing : 0);
  }

  let cursorX = x;
  if (align === 'center') cursorX = x - totalW * 0.5;
  else if (align === 'right') cursorX = x - totalW;

  ctx.textAlign = 'left';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, cursorX, y);
    cursorX += ctx.measureText(ch).width + letterSpacing;
  }
}

export function renderSceneNode(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  imageCache: ImageCache,
  skipTextBody = false,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, node.opacity));

  const cx = node.x + node.width * 0.5;
  const cy = node.y + node.height * 0.5;
  ctx.translate(cx, cy);
  if (node.rotation !== 0) {
    ctx.rotate(degToRad(node.rotation));
  }
  ctx.translate(-node.width * 0.5, -node.height * 0.5);

  if (node.shadow.enabled) {
    ctx.shadowColor = node.shadow.color;
    ctx.shadowBlur = node.shadow.blur;
    ctx.shadowOffsetX = node.shadow.offsetX;
    ctx.shadowOffsetY = node.shadow.offsetY;
  }

  if (node.type === 'rect') {
    const r = node as RectNode;
    drawRoundedRectPath(ctx, 0, 0, r.width, r.height, r.cornerRadius);
    if (r.fill && r.fill !== 'transparent') {
      ctx.fillStyle = r.fill;
      ctx.fill();
    }
    if (r.strokeWidth > 0 && r.stroke && r.stroke !== 'transparent') {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = r.stroke;
      ctx.lineWidth = r.strokeWidth;
      ctx.stroke();
    }
  } else if (node.type === 'ellipse') {
    const e = node as EllipseNode;
    ctx.beginPath();
    ctx.ellipse(
      e.width * 0.5,
      e.height * 0.5,
      Math.max(0.5, e.width * 0.5),
      Math.max(0.5, e.height * 0.5),
      0,
      0,
      Math.PI * 2,
    );
    if (e.fill && e.fill !== 'transparent') {
      ctx.fillStyle = e.fill;
      ctx.fill();
    }
    if (e.strokeWidth > 0 && e.stroke && e.stroke !== 'transparent') {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = e.stroke;
      ctx.lineWidth = e.strokeWidth;
      ctx.stroke();
    }
  } else if (node.type === 'line' || node.type === 'arrow') {
    const ln = node as LineNode;
    ctx.strokeStyle = ln.stroke;
    ctx.fillStyle = ln.stroke;
    ctx.lineWidth = Math.max(1, ln.strokeWidth);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ln.dashed) {
      ctx.setLineDash([ln.strokeWidth * 3, ln.strokeWidth * 2]);
    }
    ctx.beginPath();
    ctx.moveTo(ln.x1, ln.y1);
    ctx.lineTo(ln.x2, ln.y2);
    ctx.stroke();
    ctx.setLineDash([]);

    const headLen = Math.max(16, ln.strokeWidth * 3.6);
    const angle = Math.atan2(ln.y2 - ln.y1, ln.x2 - ln.x1);
    if (ln.arrowEnd) {
      drawArrowHead(ctx, ln.x2, ln.y2, angle, headLen);
    }
    if (ln.arrowStart) {
      drawArrowHead(ctx, ln.x1, ln.y1, angle + Math.PI, headLen);
    }
  } else if (node.type === 'text') {
    const t = node as TextNode;
    if ((t.fill && t.fill !== 'transparent') || (t.strokeWidth > 0 && t.stroke !== 'transparent')) {
      drawRoundedRectPath(ctx, 0, 0, t.width, t.height, t.cornerRadius);
      if (t.fill && t.fill !== 'transparent') {
        ctx.fillStyle = t.fill;
        ctx.fill();
      }
      if (t.strokeWidth > 0 && t.stroke !== 'transparent') {
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = t.stroke;
        ctx.lineWidth = t.strokeWidth;
        ctx.stroke();
      }
    }

    if (!skipTextBody) {
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = t.color;
      ctx.font = `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
      ctx.textBaseline = 'top';

      const pad = t.padding;
      const innerW = Math.max(16, t.width - pad * 2);
      const innerH = Math.max(16, t.height - pad * 2);
      const lines = wrapTextLines(ctx, t.text, innerW);
      const linePx = t.fontSize * t.lineHeight;
      const totalTextH = lines.length * linePx;

      let startY = pad;
      if (t.verticalAlign === 'middle') {
        startY = pad + (innerH - totalTextH) * 0.5;
      } else if (t.verticalAlign === 'bottom') {
        startY = pad + innerH - totalTextH;
      }

      let anchorX = pad;
      if (t.textAlign === 'center') anchorX = t.width * 0.5;
      else if (t.textAlign === 'right') anchorX = t.width - pad;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, t.width, t.height);
      ctx.clip();

      for (let i = 0; i < lines.length; i++) {
        drawTextWithTracking(
          ctx,
          lines[i],
          anchorX,
          startY + i * linePx,
          t.letterSpacing,
          t.textAlign,
        );
      }
      ctx.restore();
    }
  } else if (node.type === 'image') {
    const imgNode = node as ImageNode;
    drawRoundedRectPath(ctx, 0, 0, imgNode.width, imgNode.height, imgNode.cornerRadius);
    ctx.save();
    ctx.clip();

    const drawable = imageCache.getDrawable(imgNode.assetId);
    if (drawable) {
      const sw = drawable.width || imgNode.naturalWidth || 1;
      const sh = drawable.height || imgNode.naturalHeight || 1;
      if (imgNode.objectFit === 'fill') {
        ctx.drawImage(drawable, 0, 0, imgNode.width, imgNode.height);
      } else if (imgNode.objectFit === 'contain') {
        const scale = Math.min(imgNode.width / sw, imgNode.height / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        ctx.drawImage(drawable, (imgNode.width - dw) * 0.5, (imgNode.height - dh) * 0.5, dw, dh);
      } else {
        // cover
        const scale = Math.max(imgNode.width / sw, imgNode.height / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        ctx.drawImage(drawable, (imgNode.width - dw) * 0.5, (imgNode.height - dh) * 0.5, dw, dh);
      }
    } else {
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(0, 0, imgNode.width, imgNode.height);
      ctx.fillStyle = '#64748B';
      ctx.font = '600 24px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Decoding Image…', imgNode.width * 0.5, imgNode.height * 0.5);
    }
    ctx.restore();

    if (imgNode.strokeWidth > 0 && imgNode.stroke && imgNode.stroke !== 'transparent') {
      ctx.shadowColor = 'transparent';
      drawRoundedRectPath(ctx, 0, 0, imgNode.width, imgNode.height, imgNode.cornerRadius);
      ctx.strokeStyle = imgNode.stroke;
      ctx.lineWidth = imgNode.strokeWidth;
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  headLen: number,
): void {
  const spread = Math.PI / 6.5;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - headLen * Math.cos(angle - spread),
    tipY - headLen * Math.sin(angle - spread),
  );
  ctx.lineTo(
    tipX - headLen * Math.cos(angle + spread),
    tipY - headLen * Math.sin(angle + spread),
  );
  ctx.closePath();
  ctx.fill();
}

export function renderSlideToCanvas(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  imageCache: ImageCache,
  width = SLIDE_WIDTH,
  height = SLIDE_HEIGHT,
): void {
  ctx.save();
  ctx.scale(width / SLIDE_WIDTH, height / SLIDE_HEIGHT);
  fillSlideBackground(ctx, slide.background, SLIDE_WIDTH, SLIDE_HEIGHT);
  for (let i = 0; i < slide.nodes.length; i++) {
    renderSceneNode(ctx, slide.nodes[i], imageCache, false);
  }
  ctx.restore();
}

/**
 * Hardware-accelerated HTML5 Canvas 2D Scene Graph Renderer featuring:
 * - Offscreen slide backing store with dirty-rectangle partial repainting
 * - R-Tree spatial index for O(log N) dirty-region intersection & culling
 * - Crisp HiDPI viewport compositing + selection/snap overlay pass
 */
export class SceneRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private backingCanvas: HTMLCanvasElement;
  private backingCtx: CanvasRenderingContext2D;
  private imageCache: ImageCache;
  private rtree: RTree<SceneNode>;
  private dirtyRects: BBox[] = [];
  private fullBackingDirty = true;
  private lastSlideId: string | null = null;
  private lastEditingId: string | null = null;

  private frameTimes: number[] = [];
  private lastFrameTimestamp = performance.now();
  public metrics: FrameMetrics = {
    fps: 60,
    lastFrameMs: 0,
    dirtyRectCount: 0,
    culledNodeCount: 0,
    totalNodeCount: 0,
  };

  constructor(canvas: HTMLCanvasElement, imageCache: ImageCache, rtree: RTree<SceneNode>) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.backingCanvas = document.createElement('canvas');
    this.backingCanvas.width = SLIDE_WIDTH;
    this.backingCanvas.height = SLIDE_HEIGHT;
    const bCtx = this.backingCanvas.getContext('2d', { alpha: false });
    if (!bCtx) throw new Error('Offscreen Canvas 2D context unavailable');
    this.backingCtx = bCtx;

    this.imageCache = imageCache;
    this.rtree = rtree;
  }

  invalidateFull(): void {
    this.fullBackingDirty = true;
    this.dirtyRects.length = 0;
  }

  invalidateRect(bbox: BBox): void {
    if (this.fullBackingDirty) return;
    this.dirtyRects.push(expandBBox(bbox, 8));
    if (this.dirtyRects.length > 24) {
      this.fullBackingDirty = true;
      this.dirtyRects.length = 0;
    }
  }

  syncSize(cssWidth: number, cssHeight: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(1, Math.round(cssWidth * dpr));
    const targetH = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.canvas.style.width = `${cssWidth}px`;
      this.canvas.style.height = `${cssHeight}px`;
    }
  }

  render(slide: Slide, viewport: Viewport, overlay: RenderOverlayState): void {
    const startMs = performance.now();

    if (slide.id !== this.lastSlideId || overlay.editingNodeId !== this.lastEditingId) {
      this.lastSlideId = slide.id;
      this.lastEditingId = overlay.editingNodeId;
      this.fullBackingDirty = true;
      this.dirtyRects.length = 0;
    }

    // 1. Update offscreen slide backing store via full repaint or dirty-rectangle clipping
    let dirtyCount = 0;
    let paintedNodes = 0;
    const totalNodes = slide.nodes.length;

    if (this.fullBackingDirty) {
      dirtyCount = 1;
      fillSlideBackground(this.backingCtx, slide.background, SLIDE_WIDTH, SLIDE_HEIGHT);
      for (let i = 0; i < slide.nodes.length; i++) {
        const node = slide.nodes[i];
        renderSceneNode(
          this.backingCtx,
          node,
          this.imageCache,
          overlay.editingNodeId === node.id,
        );
        paintedNodes++;
      }
      this.fullBackingDirty = false;
      this.dirtyRects.length = 0;
    } else if (this.dirtyRects.length > 0) {
      dirtyCount = this.dirtyRects.length;
      const zOrder = new Map<string, number>();
      for (let i = 0; i < slide.nodes.length; i++) {
        zOrder.set(slide.nodes[i].id, i);
      }

      for (let r = 0; r < this.dirtyRects.length; r++) {
        const raw = this.dirtyRects[r];
        const rx = Math.max(0, Math.floor(raw.minX));
        const ry = Math.max(0, Math.floor(raw.minY));
        const rMaxX = Math.min(SLIDE_WIDTH, Math.ceil(raw.maxX));
        const rMaxY = Math.min(SLIDE_HEIGHT, Math.ceil(raw.maxY));
        const rw = rMaxX - rx;
        const rh = rMaxY - ry;
        if (rw <= 0 || rh <= 0) continue;

        const clipBox: BBox = { minX: rx, minY: ry, maxX: rMaxX, maxY: rMaxY };
        const candidates = this.rtree.queryRect(clipBox);
        candidates.sort((a, b) => (zOrder.get(a.id) ?? 0) - (zOrder.get(b.id) ?? 0));

        this.backingCtx.save();
        this.backingCtx.beginPath();
        this.backingCtx.rect(rx, ry, rw, rh);
        this.backingCtx.clip();

        fillSlideBackground(this.backingCtx, slide.background, SLIDE_WIDTH, SLIDE_HEIGHT);
        for (let i = 0; i < candidates.length; i++) {
          const node = candidates[i];
          if (bboxesIntersect(computeNodeBBox(node, true), clipBox)) {
            renderSceneNode(
              this.backingCtx,
              node,
              this.imageCache,
              overlay.editingNodeId === node.id,
            );
            paintedNodes++;
          }
        }
        this.backingCtx.restore();
      }
      this.dirtyRects.length = 0;
    }

    // 2. Composite backing canvas onto the HiDPI viewport stage
    const dpr = this.canvas.width / Math.max(1, viewport.width);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Stage background
    ctx.fillStyle = '#ECEEF2';
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    // Subtle elevation shadow under slide artboard
    const sx = viewport.panX;
    const sy = viewport.panY;
    const sw = SLIDE_WIDTH * viewport.zoom;
    const sh = SLIDE_HEIGHT * viewport.zoom;

    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.14)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();

    // Blit offscreen slide backing store
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.backingCanvas, sx, sy, sw, sh);

    // Crisp hairline border around slide artboard
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - 0.5, sy - 0.5, sw + 1, sh + 1);

    // 3. Draw interactive vector overlays (hover, selection, handles, snap guides, marquee)
    this.renderOverlays(ctx, slide, viewport, overlay);

    ctx.restore();

    // Update telemetry
    const endMs = performance.now();
    const frameDelta = Math.max(1, endMs - this.lastFrameTimestamp);
    this.lastFrameTimestamp = endMs;
    this.frameTimes.push(frameDelta);
    if (this.frameTimes.length > 24) this.frameTimes.shift();
    const avgDelta = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;

    this.metrics = {
      fps: Math.min(144, Math.round(1000 / Math.max(4, avgDelta))),
      lastFrameMs: Number((endMs - startMs).toFixed(2)),
      dirtyRectCount: dirtyCount,
      culledNodeCount: Math.max(0, totalNodes - paintedNodes),
      totalNodeCount: totalNodes,
    };
  }

  private renderOverlays(
    ctx: CanvasRenderingContext2D,
    slide: Slide,
    viewport: Viewport,
    overlay: RenderOverlayState,
  ): void {
    // Hover highlight
    if (overlay.hoveredNodeId && !overlay.selectedIds.has(overlay.hoveredNodeId)) {
      const hovered = slide.nodes.find((n) => n.id === overlay.hoveredNodeId);
      if (hovered) {
        this.drawNodeOutline(ctx, hovered, viewport, 'rgba(0, 87, 255, 0.45)', 1.5);
      }
    }

    // Selected nodes
    const selectedNodes = slide.nodes.filter((n) => overlay.selectedIds.has(n.id));
    if (selectedNodes.length === 1) {
      const node = selectedNodes[0];
      if (node.id !== overlay.editingNodeId) {
        this.drawSingleSelectionHandles(ctx, node, viewport);
      }
    } else if (selectedNodes.length > 1) {
      for (let i = 0; i < selectedNodes.length; i++) {
        this.drawNodeOutline(ctx, selectedNodes[i], viewport, 'rgba(0, 87, 255, 0.55)', 1);
      }
      const groupBox = getSelectionBBox(selectedNodes);
      if (groupBox) {
        const p1 = viewport.worldToScreen(groupBox.minX, groupBox.minY);
        const p2 = viewport.worldToScreen(groupBox.maxX, groupBox.maxY);
        ctx.strokeStyle = '#0057FF';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        this.drawBoxHandles(ctx, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, false);
      }
    }

    // Magnetic snap guides
    for (let i = 0; i < overlay.snapGuides.length; i++) {
      const g = overlay.snapGuides[i];
      ctx.save();
      ctx.strokeStyle = g.kind === 'spacing' ? '#E11D48' : '#0057FF';
      ctx.lineWidth = 1;
      if (g.kind === 'center') {
        ctx.setLineDash([5, 4]);
      }

      if (g.orientation === 'vertical') {
        const p1 = viewport.worldToScreen(g.position, g.start);
        const p2 = viewport.worldToScreen(g.position, g.end);
        ctx.beginPath();
        ctx.moveTo(Math.round(p1.x) + 0.5, p1.y);
        ctx.lineTo(Math.round(p2.x) + 0.5, p2.y);
        ctx.stroke();
        if (g.label) {
          this.drawSnapBadge(ctx, p1.x + 18, (p1.y + p2.y) * 0.5, g.label);
        }
      } else {
        const p1 = viewport.worldToScreen(g.start, g.position);
        const p2 = viewport.worldToScreen(g.end, g.position);
        ctx.beginPath();
        ctx.moveTo(p1.x, Math.round(p1.y) + 0.5);
        ctx.lineTo(p2.x, Math.round(p2.y) + 0.5);
        ctx.stroke();
        if (g.label) {
          this.drawSnapBadge(ctx, (p1.x + p2.x) * 0.5, p1.y - 14, g.label);
        }
      }
      ctx.restore();
    }

    // Marquee selection box
    if (overlay.marqueeRect) {
      const p1 = viewport.worldToScreen(overlay.marqueeRect.minX, overlay.marqueeRect.minY);
      const p2 = viewport.worldToScreen(overlay.marqueeRect.maxX, overlay.marqueeRect.maxY);
      ctx.save();
      ctx.fillStyle = 'rgba(0, 87, 255, 0.08)';
      ctx.strokeStyle = '#0057FF';
      ctx.lineWidth = 1;
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.restore();
    }
  }

  private drawNodeOutline(
    ctx: CanvasRenderingContext2D,
    node: SceneNode,
    viewport: Viewport,
    color: string,
    lineWidth: number,
  ): void {
    const center = viewport.worldToScreen(node.x + node.width * 0.5, node.y + node.height * 0.5);
    const w = node.width * viewport.zoom;
    const h = node.height * viewport.zoom;
    ctx.save();
    ctx.translate(center.x, center.y);
    if (node.rotation !== 0) ctx.rotate(degToRad(node.rotation));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
    ctx.restore();
  }

  private drawSingleSelectionHandles(
    ctx: CanvasRenderingContext2D,
    node: SceneNode,
    viewport: Viewport,
  ): void {
    const center = viewport.worldToScreen(node.x + node.width * 0.5, node.y + node.height * 0.5);
    const w = node.width * viewport.zoom;
    const h = node.height * viewport.zoom;

    ctx.save();
    ctx.translate(center.x, center.y);
    if (node.rotation !== 0) ctx.rotate(degToRad(node.rotation));

    ctx.strokeStyle = '#0057FF';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
    this.drawBoxHandles(ctx, -w * 0.5, -h * 0.5, w, h, true);

    ctx.restore();
  }

  private drawBoxHandles(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    withRotation: boolean,
  ): void {
    const size = 8;
    const half = size * 0.5;
    const pts = [
      [x, y],
      [x + w * 0.5, y],
      [x + w, y],
      [x + w, y + h * 0.5],
      [x + w, y + h],
      [x + w * 0.5, y + h],
      [x, y + h],
      [x, y + h * 0.5],
    ];

    if (withRotation) {
      const rotY = y - 28;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.5, y);
      ctx.lineTo(x + w * 0.5, rotY);
      ctx.strokeStyle = '#0057FF';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x + w * 0.5, rotY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#0057FF';
      ctx.lineWidth = 1.75;
      ctx.stroke();
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#0057FF';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < pts.length; i++) {
      ctx.fillRect(pts[i][0] - half, pts[i][1] - half, size, size);
      ctx.strokeRect(pts[i][0] - half, pts[i][1] - half, size, size);
    }
  }

  private drawSnapBadge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 10;
    const h = 18;
    drawRoundedRectPath(ctx, x - w * 0.5, y - h * 0.5, w, h, 4);
    ctx.fillStyle = '#E11D48';
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }
}
