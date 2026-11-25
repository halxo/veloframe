import type { ImageCache } from '../engine/imageCache';
import {
  fillSlideBackground,
  renderSceneNode,
  renderSlideToCanvas,
} from '../engine/renderer';
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  cloneNode,
  type SceneNode,
  type Slide,
  type TransitionType,
} from '../model/types';
import type { EditorStore } from '../state/store';

interface LaserPoint {
  x: number;
  y: number;
  time: number;
}

interface ActiveTransition {
  fromSlide: Slide;
  toSlide: Slide;
  type: TransitionType;
  direction: 1 | -1;
  startTime: number;
  durationMs: number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Hardware-accelerated fullscreen Presenter Mode featuring:
 * - GPU-composited transitions (fade, slide, and object-ID-matched morph)
 * - Glowing laser pointer with smooth fading trail (L)
 * - Speaker notes & presentation timer drawer (N)
 * - Instant slide-jump grid overlay (G)
 */
export class PresenterMode {
  private store: EditorStore;
  private imageCache: ImageCache;

  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fromBuffer: HTMLCanvasElement;
  private toBuffer: HTMLCanvasElement;

  private hudBar: HTMLElement;
  private slideCounterEl: HTMLElement;
  private timerEl: HTMLElement;
  private laserBtn: HTMLButtonElement;
  private notesPanel: HTMLElement;
  private notesTextEl: HTMLElement;
  private gridOverlay: HTMLElement;

  private active = false;
  private slideIndex = 0;
  private laserEnabled = false;
  private notesVisible = false;
  private gridVisible = false;
  private laserTrail: LaserPoint[] = [];
  private laserCursor: { x: number; y: number } | null = null;
  private transition: ActiveTransition | null = null;
  private startClockMs = 0;
  private rafId = 0;

  constructor(store: EditorStore, imageCache: ImageCache) {
    this.store = store;
    this.imageCache = imageCache;

    this.root = document.createElement('div');
    this.root.className = 'presenter-root';
    this.root.style.display = 'none';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'presenter-canvas';
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Presenter Canvas 2D unavailable');
    this.ctx = ctx;

    this.fromBuffer = document.createElement('canvas');
    this.fromBuffer.width = SLIDE_WIDTH;
    this.fromBuffer.height = SLIDE_HEIGHT;

    this.toBuffer = document.createElement('canvas');
    this.toBuffer.width = SLIDE_WIDTH;
    this.toBuffer.height = SLIDE_HEIGHT;

    this.hudBar = document.createElement('div');
    this.hudBar.className = 'presenter-hud';

    const prevBtn = this.makeHudBtn('←', 'Previous Slide', () => this.step(-1));
    const nextBtn = this.makeHudBtn('→', 'Next Slide', () => this.step(1));
    this.slideCounterEl = document.createElement('span');
    this.slideCounterEl.className = 'presenter-counter';

    this.timerEl = document.createElement('span');
    this.timerEl.className = 'presenter-timer';
    this.timerEl.textContent = '00:00';

    this.laserBtn = this.makeHudBtn('Laser (L)', 'Toggle Laser Pointer', () => this.toggleLaser());
    const notesBtn = this.makeHudBtn('Notes (N)', 'Toggle Speaker Notes', () => this.toggleNotes());
    const gridBtn = this.makeHudBtn('Grid (G)', 'Slide Jump Grid', () => this.toggleGrid());
    const exitBtn = this.makeHudBtn('Exit (Esc)', 'Exit Presenter', () => this.exit());

    this.hudBar.append(
      prevBtn,
      this.slideCounterEl,
      nextBtn,
      this.timerEl,
      this.laserBtn,
      notesBtn,
      gridBtn,
      exitBtn,
    );

    this.notesPanel = document.createElement('div');
    this.notesPanel.className = 'presenter-notes';
    this.notesPanel.style.display = 'none';
    const notesHead = document.createElement('div');
    notesHead.className = 'presenter-notes-head';
    notesHead.textContent = 'SPEAKER NOTES';
    this.notesTextEl = document.createElement('div');
    this.notesTextEl.className = 'presenter-notes-body';
    this.notesPanel.append(notesHead, this.notesTextEl);

    this.gridOverlay = document.createElement('div');
    this.gridOverlay.className = 'presenter-grid-overlay';
    this.gridOverlay.style.display = 'none';

    this.root.append(this.canvas, this.hudBar, this.notesPanel, this.gridOverlay);
    document.body.appendChild(this.root);

    this.bindEvents();
  }

  private makeHudBtn(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'presenter-hud-btn';
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.gridVisible) this.toggleGrid();
        else this.exit();
      } else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'Enter') {
        if (!this.gridVisible) {
          e.preventDefault();
          this.step(1);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
        if (!this.gridVisible) {
          e.preventDefault();
          this.step(-1);
        }
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.toggleLaser();
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.toggleNotes();
      } else if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        this.toggleGrid();
      }
    });

    this.canvas.addEventListener('click', () => {
      if (!this.active || this.gridVisible || this.laserEnabled) return;
      this.step(1);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.active || !this.laserEnabled) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.laserCursor = { x, y };
      this.laserTrail.push({ x, y, time: performance.now() });
      if (this.laserTrail.length > 48) this.laserTrail.shift();
    });

    this.canvas.addEventListener('pointerleave', () => {
      this.laserCursor = null;
    });

    document.addEventListener('fullscreenchange', () => {
      if (this.active && !document.fullscreenElement) {
        this.syncCanvasSize();
      }
    });

    window.addEventListener('resize', () => {
      if (this.active) this.syncCanvasSize();
    });
  }

  public start(fromIndex?: number): void {
    this.active = true;
    this.slideIndex = fromIndex ?? this.store.getActiveSlideIndex();
    this.transition = null;
    this.laserEnabled = false;
    this.notesVisible = false;
    this.gridVisible = false;
    this.laserTrail.length = 0;
    this.startClockMs = performance.now();

    this.root.style.display = 'block';
    this.notesPanel.style.display = 'none';
    this.gridOverlay.style.display = 'none';
    this.laserBtn.classList.remove('active');
    this.canvas.style.cursor = 'pointer';

    this.syncCanvasSize();
    this.updateSlideChrome();

    if (this.root.requestFullscreen) {
      this.root.requestFullscreen().catch(() => {
        // Fullscreen may be blocked in embedded previews; overlay still works seamlessly
      });
    }

    this.loop();
  }

  public exit(): void {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.rafId);
    this.root.style.display = 'none';
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    const currentSlide = this.store.presentation.slides[this.slideIndex];
    if (currentSlide) {
      this.store.setActiveSlide(currentSlide.id);
    }
  }

  private toggleLaser(): void {
    this.laserEnabled = !this.laserEnabled;
    this.laserBtn.classList.toggle('active', this.laserEnabled);
    this.canvas.style.cursor = this.laserEnabled ? 'none' : 'pointer';
    if (!this.laserEnabled) {
      this.laserTrail.length = 0;
      this.laserCursor = null;
    }
  }

  private toggleNotes(): void {
    this.notesVisible = !this.notesVisible;
    this.notesPanel.style.display = this.notesVisible ? 'block' : 'none';
  }

  private toggleGrid(): void {
    this.gridVisible = !this.gridVisible;
    if (!this.gridVisible) {
      this.gridOverlay.style.display = 'none';
      return;
    }

    this.gridOverlay.style.display = 'grid';
    const slides = this.store.presentation.slides;
    const frag = document.createDocumentFragment();

    slides.forEach((slide, idx) => {
      const card = document.createElement('button');
      card.className = 'presenter-grid-card' + (idx === this.slideIndex ? ' active' : '');

      const thumb = document.createElement('canvas');
      thumb.width = 320;
      thumb.height = 180;
      const tCtx = thumb.getContext('2d');
      if (tCtx) renderSlideToCanvas(tCtx, slide, this.imageCache, 320, 180);

      const label = document.createElement('span');
      label.className = 'presenter-grid-num';
      label.textContent = `Slide ${idx + 1}`;

      card.append(thumb, label);
      card.addEventListener('click', () => {
        this.jumpTo(idx);
        this.toggleGrid();
      });
      frag.appendChild(card);
    });

    this.gridOverlay.replaceChildren(frag);
  }

  private step(delta: 1 | -1): void {
    const slides = this.store.presentation.slides;
    const nextIdx = Math.max(0, Math.min(slides.length - 1, this.slideIndex + delta));
    if (nextIdx === this.slideIndex) return;
    this.jumpTo(nextIdx, delta);
  }

  private jumpTo(nextIdx: number, direction?: 1 | -1): void {
    const slides = this.store.presentation.slides;
    const fromSlide = slides[this.slideIndex];
    const toSlide = slides[nextIdx];
    const dir: 1 | -1 = direction ?? (nextIdx >= this.slideIndex ? 1 : -1);
    this.slideIndex = nextIdx;

    if (fromSlide && toSlide && toSlide.transition !== 'none') {
      const fCtx = this.fromBuffer.getContext('2d');
      const tCtx = this.toBuffer.getContext('2d');
      if (fCtx) renderSlideToCanvas(fCtx, fromSlide, this.imageCache, SLIDE_WIDTH, SLIDE_HEIGHT);
      if (tCtx) renderSlideToCanvas(tCtx, toSlide, this.imageCache, SLIDE_WIDTH, SLIDE_HEIGHT);
      this.transition = {
        fromSlide,
        toSlide,
        type: toSlide.transition,
        direction: dir,
        startTime: performance.now(),
        durationMs: toSlide.transitionDurationMs || 450,
      };
    } else {
      this.transition = null;
    }

    this.updateSlideChrome();
  }

  private updateSlideChrome(): void {
    const slides = this.store.presentation.slides;
    const cur = slides[this.slideIndex];
    this.slideCounterEl.textContent = `${this.slideIndex + 1} / ${slides.length}`;
    this.notesTextEl.textContent = cur?.notes?.trim() || 'No speaker notes for this slide.';
  }

  private syncCanvasSize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  private loop = (): void => {
    if (!this.active) return;
    const now = performance.now();

    // Update presenter timer
    const elapsedSec = Math.floor((now - this.startClockMs) / 1000);
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    this.timerEl.textContent = `${mins}:${secs}`;

    this.renderFrame(now);
    this.rafId = requestAnimationFrame(this.loop);
  };

  private renderFrame(now: number): void {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const dpr = this.canvas.width / Math.max(1, cssW);
    const ctx = this.ctx;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#090A0D';
    ctx.fillRect(0, 0, cssW, cssH);

    // Letterboxed 16:9 viewport rect
    const scale = Math.min(cssW / SLIDE_WIDTH, cssH / SLIDE_HEIGHT);
    const drawW = SLIDE_WIDTH * scale;
    const drawH = SLIDE_HEIGHT * scale;
    const drawX = (cssW - drawW) * 0.5;
    const drawY = (cssH - drawH) * 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, drawY, drawW, drawH);
    ctx.clip();

    const slides = this.store.presentation.slides;
    const activeSlide = slides[this.slideIndex];

    if (this.transition) {
      const rawT = Math.min(1, (now - this.transition.startTime) / this.transition.durationMs);
      const t = easeOutCubic(rawT);

      if (this.transition.type === 'fade') {
        ctx.drawImage(this.fromBuffer, drawX, drawY, drawW, drawH);
        ctx.globalAlpha = t;
        ctx.drawImage(this.toBuffer, drawX, drawY, drawW, drawH);
        ctx.globalAlpha = 1;
      } else if (this.transition.type === 'slide') {
        const shift = this.transition.direction * drawW * t;
        ctx.drawImage(this.fromBuffer, drawX - shift, drawY, drawW, drawH);
        ctx.drawImage(
          this.toBuffer,
          drawX + this.transition.direction * drawW - shift,
          drawY,
          drawW,
          drawH,
        );
      } else if (this.transition.type === 'morph') {
        this.renderMorphTransition(ctx, drawX, drawY, scale, this.transition.fromSlide, this.transition.toSlide, t);
      }

      if (rawT >= 1) {
        this.transition = null;
      }
    } else if (activeSlide) {
      ctx.save();
      ctx.translate(drawX, drawY);
      ctx.scale(scale, scale);
      fillSlideBackground(ctx, activeSlide.background, SLIDE_WIDTH, SLIDE_HEIGHT);
      for (let i = 0; i < activeSlide.nodes.length; i++) {
        renderSceneNode(ctx, activeSlide.nodes[i], this.imageCache, false);
      }
      ctx.restore();
    }

    ctx.restore();

    // Render glowing laser pointer trail
    if (this.laserEnabled) {
      const cutoff = now - 340;
      while (this.laserTrail.length > 0 && this.laserTrail[0].time < cutoff) {
        this.laserTrail.shift();
      }
      if (this.laserTrail.length > 1) {
        ctx.save();
        ctx.lineCap = 'round';
        for (let i = 1; i < this.laserTrail.length; i++) {
          const p0 = this.laserTrail[i - 1];
          const p1 = this.laserTrail[i];
          const alpha = Math.max(0, (p1.time - cutoff) / 340);
          ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.75})`;
          ctx.lineWidth = 2 + alpha * 6;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (this.laserCursor) {
        ctx.save();
        ctx.shadowColor = '#EF4444';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#FF3B30';
        ctx.beginPath();
        ctx.arc(this.laserCursor.x, this.laserCursor.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(this.laserCursor.x, this.laserCursor.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  private renderMorphTransition(
    ctx: CanvasRenderingContext2D,
    drawX: number,
    drawY: number,
    scale: number,
    fromSlide: Slide,
    toSlide: Slide,
    t: number,
  ): void {
    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.scale(scale, scale);

    // Crossfade background
    fillSlideBackground(ctx, fromSlide.background, SLIDE_WIDTH, SLIDE_HEIGHT);
    ctx.save();
    ctx.globalAlpha = t;
    fillSlideBackground(ctx, toSlide.background, SLIDE_WIDTH, SLIDE_HEIGHT);
    ctx.restore();

    const fromMap = new Map(fromSlide.nodes.map((n) => [n.id, n]));
    const toMap = new Map(toSlide.nodes.map((n) => [n.id, n]));

    // Fade out exiting nodes
    for (const node of fromSlide.nodes) {
      if (!toMap.has(node.id)) {
        const fading = cloneNode(node);
        fading.opacity = node.opacity * (1 - t);
        renderSceneNode(ctx, fading, this.imageCache, false);
      }
    }

    // Morph matched nodes & fade in entering nodes
    for (const target of toSlide.nodes) {
      const source = fromMap.get(target.id);
      if (source && source.type === target.type) {
        const morphed: SceneNode = cloneNode(target);
        morphed.x = lerp(source.x, target.x, t);
        morphed.y = lerp(source.y, target.y, t);
        morphed.width = lerp(source.width, target.width, t);
        morphed.height = lerp(source.height, target.height, t);
        morphed.rotation = lerp(source.rotation, target.rotation, t);
        morphed.opacity = lerp(source.opacity, target.opacity, t);
        if (morphed.type === 'text' && source.type === 'text' && target.type === 'text') {
          morphed.fontSize = lerp(source.fontSize, target.fontSize, t);
        }
        renderSceneNode(ctx, morphed, this.imageCache, false);
      } else {
        const entering = cloneNode(target);
        entering.opacity = target.opacity * t;
        renderSceneNode(ctx, entering, this.imageCache, false);
      }
    }

    ctx.restore();
  }
}
