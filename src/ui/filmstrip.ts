import type { ImageCache } from '../engine/imageCache';
import { renderSlideToCanvas } from '../engine/renderer';
import type { Slide } from '../model/types';
import type { EditorStore } from '../state/store';

const ITEM_HEIGHT = 128;
const THUMB_W = 192;
const THUMB_H = 108;
const OVERSCAN = 4;

/**
 * Virtualized slide thumbnail sidebar that keeps DOM node count O(1)
 * even with 100–500+ slides, backed by an offscreen thumbnail canvas cache
 * and smooth drag-and-drop slide reordering.
 */
export class VirtualizedFilmstrip {
  private container: HTMLElement;
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  private viewportLayer: HTMLElement;
  private store: EditorStore;
  private imageCache: ImageCache;

  private thumbCache = new Map<string, HTMLCanvasElement>();
  private dirtyThumbs = new Set<string>();
  private dragFromIndex: number | null = null;
  private dropIndicator: HTMLElement;
  private rafScheduled = false;

  constructor(container: HTMLElement, store: EditorStore, imageCache: ImageCache) {
    this.container = container;
    this.store = store;
    this.imageCache = imageCache;

    this.scroller = document.createElement('div');
    this.scroller.className = 'filmstrip-scroll';
    this.scroller.tabIndex = 0;

    this.spacer = document.createElement('div');
    this.spacer.className = 'filmstrip-spacer';

    this.viewportLayer = document.createElement('div');
    this.viewportLayer.className = 'filmstrip-viewport';

    this.dropIndicator = document.createElement('div');
    this.dropIndicator.className = 'filmstrip-drop-indicator';
    this.dropIndicator.style.display = 'none';

    this.spacer.appendChild(this.viewportLayer);
    this.spacer.appendChild(this.dropIndicator);
    this.scroller.appendChild(this.spacer);
    this.container.appendChild(this.scroller);

    this.scroller.addEventListener('scroll', () => this.scheduleRender(), { passive: true });
    this.scroller.addEventListener('keydown', (e) => this.handleKeyDown(e));

    const ro = new ResizeObserver(() => this.scheduleRender());
    ro.observe(this.scroller);

    this.render();
  }

  invalidateSlide(slideId?: string): void {
    if (slideId) {
      this.dirtyThumbs.add(slideId);
    } else {
      this.dirtyThumbs.clear();
      this.thumbCache.clear();
    }
    this.scheduleRender();
  }

  scrollToActiveSlide(): void {
    const idx = this.store.getActiveSlideIndex();
    const top = idx * ITEM_HEIGHT;
    const bottom = top + ITEM_HEIGHT;
    const viewTop = this.scroller.scrollTop;
    const viewBottom = viewTop + this.scroller.clientHeight;
    if (top < viewTop) {
      this.scroller.scrollTop = Math.max(0, top - 12);
    } else if (bottom > viewBottom) {
      this.scroller.scrollTop = bottom - this.scroller.clientHeight + 12;
    }
  }

  scheduleRender(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      this.render();
    });
  }

  private getOrRenderThumbnail(slide: Slide): HTMLCanvasElement {
    let canvas = this.thumbCache.get(slide.id);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = THUMB_W * 2;
      canvas.height = THUMB_H * 2;
      this.thumbCache.set(slide.id, canvas);
      this.dirtyThumbs.add(slide.id);
    }

    if (this.dirtyThumbs.has(slide.id)) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        renderSlideToCanvas(ctx, slide, this.imageCache, canvas.width, canvas.height);
      }
      this.dirtyThumbs.delete(slide.id);
    }

    return canvas;
  }

  render(): void {
    const slides = this.store.presentation.slides;
    const totalHeight = slides.length * ITEM_HEIGHT + 24;
    this.spacer.style.height = `${totalHeight}px`;

    const scrollTop = this.scroller.scrollTop;
    const viewHeight = Math.max(200, this.scroller.clientHeight);
    const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
    const endIdx = Math.min(slides.length - 1, Math.ceil((scrollTop + viewHeight) / ITEM_HEIGHT) + OVERSCAN);

    const frag = document.createDocumentFragment();
    for (let i = startIdx; i <= endIdx; i++) {
      const slide = slides[i];
      const item = document.createElement('div');
      item.className = 'filmstrip-item' + (slide.id === this.store.activeSlideId ? ' active' : '');
      item.style.transform = `translateY(${i * ITEM_HEIGHT + 8}px)`;
      item.draggable = true;
      item.dataset.index = String(i);
      item.dataset.slideId = slide.id;

      const num = document.createElement('span');
      num.className = 'filmstrip-index';
      num.textContent = String(i + 1);

      const frame = document.createElement('div');
      frame.className = 'filmstrip-thumb-frame';

      const displayCanvas = document.createElement('canvas');
      displayCanvas.width = THUMB_W * 2;
      displayCanvas.height = THUMB_H * 2;
      displayCanvas.className = 'filmstrip-canvas';
      const cached = this.getOrRenderThumbnail(slide);
      const dCtx = displayCanvas.getContext('2d');
      if (dCtx) dCtx.drawImage(cached, 0, 0);

      frame.appendChild(displayCanvas);

      // Quick actions on hover
      const actions = document.createElement('div');
      actions.className = 'filmstrip-actions';

      const dupBtn = document.createElement('button');
      dupBtn.className = 'filmstrip-mini-btn';
      dupBtn.title = 'Duplicate Slide';
      dupBtn.textContent = '+';
      dupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.store.duplicateSlide(slide.id);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'filmstrip-mini-btn danger';
      delBtn.title = 'Delete Slide';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.store.deleteSlide(slide.id);
      });

      actions.appendChild(dupBtn);
      if (slides.length > 1) actions.appendChild(delBtn);
      frame.appendChild(actions);

      item.appendChild(num);
      item.appendChild(frame);

      item.addEventListener('click', () => {
        this.store.setActiveSlide(slide.id);
      });

      item.addEventListener('dragstart', (e) => {
        this.dragFromIndex = i;
        item.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(i));
        }
      });

      item.addEventListener('dragend', () => {
        this.dragFromIndex = null;
        item.classList.remove('dragging');
        this.dropIndicator.style.display = 'none';
      });

      item.addEventListener('dragover', (e) => {
        if (this.dragFromIndex === null) return;
        e.preventDefault();
        const rect = item.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height * 0.5;
        const indicatorIdx = after ? i + 1 : i;
        this.dropIndicator.style.display = 'block';
        this.dropIndicator.style.transform = `translateY(${indicatorIdx * ITEM_HEIGHT + 5}px)`;
      });

      item.addEventListener('drop', (e) => {
        if (this.dragFromIndex === null) return;
        e.preventDefault();
        const rect = item.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height * 0.5;
        let targetIdx = after ? i + 1 : i;
        if (this.dragFromIndex < targetIdx) targetIdx -= 1;
        this.store.reorderSlide(this.dragFromIndex, targetIdx);
        this.dragFromIndex = null;
        this.dropIndicator.style.display = 'none';
      });

      frag.appendChild(item);
    }

    this.viewportLayer.replaceChildren(frag);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const slides = this.store.presentation.slides;
    const idx = this.store.getActiveSlideIndex();
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault();
      const next = Math.min(slides.length - 1, idx + 1);
      this.store.setActiveSlide(slides[next].id);
      this.scrollToActiveSlide();
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      const prev = Math.max(0, idx - 1);
      this.store.setActiveSlide(slides[prev].id);
      this.scrollToActiveSlide();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && slides.length > 1) {
      e.preventDefault();
      this.store.deleteSlide();
    }
  }
}
