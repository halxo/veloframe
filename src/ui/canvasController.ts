import type { ImageCache } from '../engine/imageCache';
import type { RenderOverlayState } from '../engine/renderer';
import { computeSmartSnap } from '../engine/snapping';
import type { Viewport } from '../engine/viewport';
import {
  computeNodeBBox,
  getSelectionBBox,
  hitTestNode,
  mergeBBoxes,
  radToDeg,
  rotatePoint,
} from '../model/geometry';
import { getThemeById } from '../model/themes';
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  cloneNode,
  createDefaultShadow,
  uid,
  type AssetRecord,
  type BBox,
  type ImageNode,
  type LineNode,
  type Point,
  type SceneNode,
  type SnapGuide,
  type TextNode,
} from '../model/types';
import type { EditorStore } from '../state/store';
import type { VeloFrameDB } from '../storage/db';

type HandleKind = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

interface DragSession {
  mode: 'pan' | 'move' | 'resize' | 'rotate' | 'marquee' | 'create';
  startScreen: Point;
  startWorld: Point;
  panOriginX: number;
  panOriginY: number;
  handle?: HandleKind;
  initialNodes: Map<string, SceneNode>;
  initialGroupBox: BBox | null;
  createdNodeId?: string;
  moved: boolean;
}

export class CanvasController {
  private stageEl: HTMLElement;
  private canvas: HTMLCanvasElement;
  private store: EditorStore;
  private viewport: Viewport;
  private db: VeloFrameDB;
  private imageCache: ImageCache;
  private requestFrame: () => void;

  public overlay: RenderOverlayState = {
    selectedIds: new Set(),
    editingNodeId: null,
    marqueeRect: null,
    snapGuides: [],
    hoveredNodeId: null,
  };

  private session: DragSession | null = null;
  private spacePressed = false;
  private inlineEditor: HTMLTextAreaElement | null = null;
  private inlineOriginalNode: TextNode | null = null;

  constructor(
    stageEl: HTMLElement,
    canvas: HTMLCanvasElement,
    store: EditorStore,
    viewport: Viewport,
    db: VeloFrameDB,
    imageCache: ImageCache,
    requestFrame: () => void,
  ) {
    this.stageEl = stageEl;
    this.canvas = canvas;
    this.store = store;
    this.viewport = viewport;
    this.db = db;
    this.imageCache = imageCache;
    this.requestFrame = requestFrame;

    this.bindEvents();
  }

  syncSelectionFromStore(): void {
    this.overlay.selectedIds = new Set(this.store.selectedIds);
    this.overlay.editingNodeId = this.store.editingNodeId;
  }

  private getScreenPoint(e: PointerEvent | WheelEvent | DragEvent | MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Drag-and-drop images directly onto the canvas stage
    this.stageEl.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        this.stageEl.classList.add('drop-active');
      }
    });
    this.stageEl.addEventListener('dragleave', () => {
      this.stageEl.classList.remove('drop-active');
    });
    this.stageEl.addEventListener('drop', (e) => {
      this.stageEl.classList.remove('drop-active');
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const pt = this.viewport.screenToWorld(
        this.getScreenPoint(e).x,
        this.getScreenPoint(e).y,
      );
      void this.importImageFiles(e.dataTransfer.files, pt);
    });

    // Clipboard image paste
    window.addEventListener('paste', (e) => {
      if (this.isTypingInInput(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        void this.importImageFiles(files, { x: SLIDE_WIDTH * 0.5, y: SLIDE_HEIGHT * 0.5 });
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.isTypingInInput(e.target)) {
        this.spacePressed = true;
        this.canvas.style.cursor = 'grab';
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spacePressed = false;
        this.canvas.style.cursor = 'default';
      }
    });
  }

  private isTypingInInput(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
  }

  private hitTestHandle(screenPt: Point): HandleKind | null {
    const selected = this.store.getSelectedNodes();
    if (selected.length === 0) return null;

    const hitDist = 11;

    if (selected.length === 1) {
      const node = selected[0];
      const center = this.viewport.worldToScreen(
        node.x + node.width * 0.5,
        node.y + node.height * 0.5,
      );
      const localScreen = rotatePoint(screenPt.x, screenPt.y, center.x, center.y, -node.rotation);
      const hw = node.width * this.viewport.zoom * 0.5;
      const hh = node.height * this.viewport.zoom * 0.5;
      const left = center.x - hw;
      const right = center.x + hw;
      const top = center.y - hh;
      const bottom = center.y + hh;

      if (Math.hypot(localScreen.x - center.x, localScreen.y - (top - 28)) <= hitDist + 2) {
        return 'rotate';
      }

      const handles: Array<[HandleKind, number, number]> = [
        ['nw', left, top],
        ['n', center.x, top],
        ['ne', right, top],
        ['e', right, center.y],
        ['se', right, bottom],
        ['s', center.x, bottom],
        ['sw', left, bottom],
        ['w', left, center.y],
      ];
      for (const [kind, hx, hy] of handles) {
        if (Math.hypot(localScreen.x - hx, localScreen.y - hy) <= hitDist) {
          return kind;
        }
      }
      return null;
    }

    const box = getSelectionBBox(selected);
    if (!box) return null;
    const p1 = this.viewport.worldToScreen(box.minX, box.minY);
    const p2 = this.viewport.worldToScreen(box.maxX, box.maxY);
    const cx = (p1.x + p2.x) * 0.5;
    const cy = (p1.y + p2.y) * 0.5;
    const handles: Array<[HandleKind, number, number]> = [
      ['nw', p1.x, p1.y],
      ['n', cx, p1.y],
      ['ne', p2.x, p1.y],
      ['e', p2.x, cy],
      ['se', p2.x, p2.y],
      ['s', cx, p2.y],
      ['sw', p1.x, p2.y],
      ['w', p1.x, cy],
    ];
    for (const [kind, hx, hy] of handles) {
      if (Math.hypot(screenPt.x - hx, screenPt.y - hy) <= hitDist) {
        return kind;
      }
    }
    return null;
  }

  private hitTestTopNode(worldPt: Point): SceneNode | null {
    const slide = this.store.getActiveSlide();
    const pad = Math.max(8, 10 / this.viewport.zoom);
    const candidates = this.store.rtree.queryPoint(worldPt.x, worldPt.y, pad);
    if (candidates.length === 0) return null;

    const candIds = new Set(candidates.map((c) => c.id));
    for (let i = slide.nodes.length - 1; i >= 0; i--) {
      const node = slide.nodes[i];
      if (!candIds.has(node.id)) continue;
      if (hitTestNode(node, worldPt.x, worldPt.y, pad)) {
        return node;
      }
    }
    return null;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 2) return;
    this.commitInlineTextEdit();

    const screenPt = this.getScreenPoint(e);
    const worldPt = this.viewport.screenToWorld(screenPt.x, screenPt.y);

    // Middle click, Spacebar, or Hand tool -> Pan infinite stage
    if (e.button === 1 || this.spacePressed || this.store.activeTool === 'hand') {
      this.session = {
        mode: 'pan',
        startScreen: screenPt,
        startWorld: worldPt,
        panOriginX: this.viewport.panX,
        panOriginY: this.viewport.panY,
        initialNodes: new Map(),
        initialGroupBox: null,
        moved: false,
      };
      this.canvas.style.cursor = 'grabbing';
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Creation tools
    if (this.store.activeTool !== 'select') {
      const created = this.createDraftNode(this.store.activeTool, worldPt);
      if (created) {
        this.store.addNode(created, true);
        const snap = new Map<string, SceneNode>([[created.id, cloneNode(created)]]);
        this.session = {
          mode: 'create',
          startScreen: screenPt,
          startWorld: worldPt,
          panOriginX: this.viewport.panX,
          panOriginY: this.viewport.panY,
          initialNodes: snap,
          initialGroupBox: null,
          createdNodeId: created.id,
          moved: false,
        };
        this.canvas.setPointerCapture(e.pointerId);
      }
      return;
    }

    // 1. Check resize / rotation handles on current selection
    const handle = this.hitTestHandle(screenPt);
    if (handle) {
      const selected = this.store.getSelectedNodes();
      const initialNodes = new Map(selected.map((n) => [n.id, cloneNode(n)]));
      this.session = {
        mode: handle === 'rotate' ? 'rotate' : 'resize',
        handle,
        startScreen: screenPt,
        startWorld: worldPt,
        panOriginX: this.viewport.panX,
        panOriginY: this.viewport.panY,
        initialNodes,
        initialGroupBox: getSelectionBBox(selected),
        moved: false,
      };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    // 2. Hit test scene nodes via R-Tree
    const hit = this.hitTestTopNode(worldPt);
    if (hit) {
      if (e.shiftKey) {
        const next = new Set(this.store.selectedIds);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        this.store.selectNodes(Array.from(next), true);
      } else if (!this.store.selectedIds.has(hit.id)) {
        this.store.selectNodes([hit.id], true);
      }

      const selected = this.store.getSelectedNodes().filter((n) => !n.locked);
      const initialNodes = new Map(selected.map((n) => [n.id, cloneNode(n)]));
      this.session = {
        mode: 'move',
        startScreen: screenPt,
        startWorld: worldPt,
        panOriginX: this.viewport.panX,
        panOriginY: this.viewport.panY,
        initialNodes,
        initialGroupBox: getSelectionBBox(selected),
        moved: false,
      };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    // 3. Empty stage click -> start marquee selection
    if (!e.shiftKey) {
      this.store.clearSelection();
    }
    this.session = {
      mode: 'marquee',
      startScreen: screenPt,
      startWorld: worldPt,
      panOriginX: this.viewport.panX,
      panOriginY: this.viewport.panY,
      initialNodes: new Map(),
      initialGroupBox: null,
      moved: false,
    };
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    const screenPt = this.getScreenPoint(e);
    const worldPt = this.viewport.screenToWorld(screenPt.x, screenPt.y);

    if (!this.session) {
      this.updateHoverCursor(screenPt, worldPt);
      return;
    }

    const s = this.session;

    if (s.mode === 'pan') {
      this.viewport.panX = s.panOriginX + (screenPt.x - s.startScreen.x);
      this.viewport.panY = s.panOriginY + (screenPt.y - s.startScreen.y);
      this.requestFrame();
      return;
    }

    if (s.mode === 'marquee') {
      s.moved = true;
      const rect: BBox = {
        minX: Math.min(s.startWorld.x, worldPt.x),
        minY: Math.min(s.startWorld.y, worldPt.y),
        maxX: Math.max(s.startWorld.x, worldPt.x),
        maxY: Math.max(s.startWorld.y, worldPt.y),
      };
      this.overlay.marqueeRect = rect;
      const hits = this.store.rtree.queryRect(rect);
      this.store.selectNodes(hits.map((h) => h.id), true);
      this.requestFrame();
      return;
    }

    if (s.mode === 'create' && s.createdNodeId) {
      s.moved = true;
      const orig = s.initialNodes.get(s.createdNodeId);
      if (!orig) return;
      const dx = worldPt.x - s.startWorld.x;
      const dy = worldPt.y - s.startWorld.y;

      const updates = new Map<string, Partial<SceneNode>>();
      if (orig.type === 'line' || orig.type === 'arrow') {
        const minX = Math.min(s.startWorld.x, worldPt.x);
        const minY = Math.min(s.startWorld.y, worldPt.y);
        const w = Math.max(12, Math.abs(dx));
        const h = Math.max(12, Math.abs(dy));
        updates.set(orig.id, {
          x: minX,
          y: minY,
          width: w,
          height: h,
          x1: s.startWorld.x - minX,
          y1: s.startWorld.y - minY,
          x2: worldPt.x - minX,
          y2: worldPt.y - minY,
        } as Partial<LineNode>);
      } else {
        let w = Math.abs(dx);
        let h = Math.abs(dy);
        if (e.shiftKey) {
          const side = Math.max(w, h);
          w = side;
          h = side;
        }
        const x = dx >= 0 ? s.startWorld.x : s.startWorld.x - w;
        const y = dy >= 0 ? s.startWorld.y : s.startWorld.y - h;
        updates.set(orig.id, {
          x,
          y,
          width: Math.max(24, w),
          height: Math.max(24, h),
        });
      }
      this.store.applyLiveNodeUpdates(updates);
      this.requestFrame();
      return;
    }

    if (s.mode === 'move') {
      let dx = worldPt.x - s.startWorld.x;
      let dy = worldPt.y - s.startWorld.y;
      if (Math.hypot(dx, dy) > 2) s.moved = true;

      let guides: SnapGuide[] = [];
      if (!e.altKey && s.initialGroupBox) {
        const movedBox: BBox = {
          minX: s.initialGroupBox.minX + dx,
          minY: s.initialGroupBox.minY + dy,
          maxX: s.initialGroupBox.maxX + dx,
          maxY: s.initialGroupBox.maxY + dy,
        };
        const slide = this.store.getActiveSlide();
        const siblings = slide.nodes.filter((n) => !s.initialNodes.has(n.id));
        const snap = computeSmartSnap(movedBox, siblings, 8 / this.viewport.zoom);
        dx += snap.dx;
        dy += snap.dy;
        guides = snap.guides;
      }

      this.overlay.snapGuides = guides;
      const updates = new Map<string, Partial<SceneNode>>();
      for (const [id, orig] of s.initialNodes) {
        updates.set(id, {
          x: Math.round(orig.x + dx),
          y: Math.round(orig.y + dy),
        });
      }
      this.store.applyLiveNodeUpdates(updates);
      this.requestFrame();
      return;
    }

    if (s.mode === 'rotate' && s.initialNodes.size === 1) {
      s.moved = true;
      const orig = Array.from(s.initialNodes.values())[0];
      const cx = orig.x + orig.width * 0.5;
      const cy = orig.y + orig.height * 0.5;
      let angle = radToDeg(Math.atan2(worldPt.y - cy, worldPt.x - cx)) + 90;
      if (e.shiftKey) {
        angle = Math.round(angle / 15) * 15;
      }
      const normalized = ((Math.round(angle) % 360) + 360) % 360;
      this.store.applyLiveNodeUpdates(new Map([[orig.id, { rotation: normalized }]]));
      this.requestFrame();
      return;
    }

    if (s.mode === 'resize' && s.handle && s.initialGroupBox) {
      s.moved = true;
      this.applyResizeDrag(s, worldPt, e.shiftKey);
      this.requestFrame();
    }
  }

  private applyResizeDrag(s: DragSession, worldPt: Point, preserveAspect: boolean): void {
    const handle = s.handle!;
    const minSize = 20;

    if (s.initialNodes.size === 1) {
      const orig = Array.from(s.initialNodes.values())[0];
      const cx = orig.x + orig.width * 0.5;
      const cy = orig.y + orig.height * 0.5;
      const localStart = rotatePoint(s.startWorld.x, s.startWorld.y, cx, cy, -orig.rotation);
      const localCur = rotatePoint(worldPt.x, worldPt.y, cx, cy, -orig.rotation);
      const dx = localCur.x - localStart.x;
      const dy = localCur.y - localStart.y;

      let x = orig.x;
      let y = orig.y;
      let w = orig.width;
      let h = orig.height;

      if (handle.includes('e')) w = Math.max(minSize, orig.width + dx);
      if (handle.includes('s')) h = Math.max(minSize, orig.height + dy);
      if (handle.includes('w')) {
        const nextW = Math.max(minSize, orig.width - dx);
        x = orig.x + (orig.width - nextW);
        w = nextW;
      }
      if (handle.includes('n')) {
        const nextH = Math.max(minSize, orig.height - dy);
        y = orig.y + (orig.height - nextH);
        h = nextH;
      }

      if (preserveAspect && orig.width > 0 && orig.height > 0) {
        const aspect = orig.width / orig.height;
        if (handle === 'n' || handle === 's') {
          w = h * aspect;
        } else {
          h = w / aspect;
        }
      }

      const patch: Partial<SceneNode> = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
      };

      if (orig.type === 'line' || orig.type === 'arrow') {
        const ln = orig as LineNode;
        const sx = w / Math.max(1, orig.width);
        const sy = h / Math.max(1, orig.height);
        Object.assign(patch, {
          x1: ln.x1 * sx,
          y1: ln.y1 * sy,
          x2: ln.x2 * sx,
          y2: ln.y2 * sy,
        });
      }

      this.store.applyLiveNodeUpdates(new Map([[orig.id, patch]]));
      return;
    }

    // Multi-node proportional scaling
    const box = s.initialGroupBox!;
    const origW = Math.max(1, box.maxX - box.minX);
    const origH = Math.max(1, box.maxY - box.minY);
    const dx = worldPt.x - s.startWorld.x;
    const dy = worldPt.y - s.startWorld.y;

    let newMinX = box.minX;
    let newMinY = box.minY;
    let newMaxX = box.maxX;
    let newMaxY = box.maxY;

    if (handle.includes('e')) newMaxX = Math.max(box.minX + minSize, box.maxX + dx);
    if (handle.includes('s')) newMaxY = Math.max(box.minY + minSize, box.maxY + dy);
    if (handle.includes('w')) newMinX = Math.min(box.maxX - minSize, box.minX + dx);
    if (handle.includes('n')) newMinY = Math.min(box.maxY - minSize, box.minY + dy);

    const scaleX = (newMaxX - newMinX) / origW;
    const scaleY = (newMaxY - newMinY) / origH;

    const updates = new Map<string, Partial<SceneNode>>();
    for (const [id, orig] of s.initialNodes) {
      updates.set(id, {
        x: Math.round(newMinX + (orig.x - box.minX) * scaleX),
        y: Math.round(newMinY + (orig.y - box.minY) * scaleY),
        width: Math.max(minSize, Math.round(orig.width * scaleX)),
        height: Math.max(minSize, Math.round(orig.height * scaleY)),
      });
    }
    this.store.applyLiveNodeUpdates(updates);
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.session) return;
    const s = this.session;
    this.session = null;
    this.overlay.marqueeRect = null;
    this.overlay.snapGuides = [];

    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }

    if (s.mode === 'pan') {
      this.canvas.style.cursor = this.spacePressed ? 'grab' : 'default';
      this.requestFrame();
      return;
    }

    if (s.mode === 'create' && s.createdNodeId) {
      const node = this.store.getActiveSlide().nodes.find((n) => n.id === s.createdNodeId);
      if (node && !s.moved) {
        // Click without drag -> assign clean default size
        const updates = new Map<string, Partial<SceneNode>>();
        if (node.type === 'text') {
          updates.set(node.id, { width: 420, height: 110 });
        } else if (node.type === 'line' || node.type === 'arrow') {
          updates.set(node.id, { width: 260, height: 40, x1: 0, y1: 20, x2: 260, y2: 20 } as Partial<LineNode>);
        } else {
          updates.set(node.id, { width: 280, height: 180 });
        }
        this.store.applyLiveNodeUpdates(updates);
      }
      this.store.setTool('select');
      if (node && node.type === 'text') {
        this.openInlineTextEditor(node);
      }
      this.requestFrame();
      return;
    }

    if ((s.mode === 'move' || s.mode === 'resize' || s.mode === 'rotate') && s.moved) {
      const before = Array.from(s.initialNodes.values());
      const after = this.store
        .getActiveSlide()
        .nodes.filter((n) => s.initialNodes.has(n.id))
        .map((n) => cloneNode(n));
      this.store.commitNodeSnapshots(
        s.mode === 'move' ? 'Move objects' : s.mode === 'rotate' ? 'Rotate object' : 'Resize objects',
        before,
        after,
      );
      this.store.emit({ type: 'selection' });
    }

    this.requestFrame();
  }

  private onDoubleClick(e: MouseEvent): void {
    const screenPt = this.getScreenPoint(e);
    const worldPt = this.viewport.screenToWorld(screenPt.x, screenPt.y);
    const hit = this.hitTestTopNode(worldPt);
    if (hit && hit.type === 'text') {
      this.store.selectNodes([hit.id], false);
      this.openInlineTextEditor(hit);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.commitInlineTextEdit();
    const screenPt = this.getScreenPoint(e);

    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.008);
      this.viewport.zoomAt(screenPt.x, screenPt.y, factor);
    } else if (Math.abs(e.deltaX) > 0 || e.shiftKey) {
      this.viewport.panBy(-e.deltaX, -e.deltaY);
    } else {
      // Smooth zoom with mouse wheel
      const factor = Math.exp(-e.deltaY * 0.0018);
      this.viewport.zoomAt(screenPt.x, screenPt.y, factor);
    }
    this.requestFrame();
  }

  private updateHoverCursor(screenPt: Point, worldPt: Point): void {
    if (this.spacePressed || this.store.activeTool === 'hand') {
      this.canvas.style.cursor = 'grab';
      return;
    }
    if (this.store.activeTool !== 'select') {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    const handle = this.hitTestHandle(screenPt);
    if (handle) {
      const cursorMap: Record<HandleKind, string> = {
        nw: 'nwse-resize',
        se: 'nwse-resize',
        ne: 'nesw-resize',
        sw: 'nesw-resize',
        n: 'ns-resize',
        s: 'ns-resize',
        e: 'ew-resize',
        w: 'ew-resize',
        rotate: 'grab',
      };
      this.canvas.style.cursor = cursorMap[handle];
      return;
    }

    const hit = this.hitTestTopNode(worldPt);
    const nextHover = hit ? hit.id : null;
    if (nextHover !== this.overlay.hoveredNodeId) {
      this.overlay.hoveredNodeId = nextHover;
      this.requestFrame();
    }
    this.canvas.style.cursor = hit ? 'move' : 'default';
  }

  private createDraftNode(tool: string, pt: Point): SceneNode | null {
    const theme = getThemeById(this.store.presentation.themeId);
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);

    if (tool === 'rect') {
      return {
        id: uid('rect'),
        type: 'rect',
        name: 'Rectangle',
        x,
        y,
        width: 12,
        height: 12,
        rotation: 0,
        opacity: 1,
        shadow: createDefaultShadow(),
        groupId: null,
        locked: false,
        fill: theme.accent,
        stroke: 'transparent',
        strokeWidth: 0,
        cornerRadius: 16,
      };
    }

    if (tool === 'ellipse') {
      return {
        id: uid('ellipse'),
        type: 'ellipse',
        name: 'Ellipse',
        x,
        y,
        width: 12,
        height: 12,
        rotation: 0,
        opacity: 1,
        shadow: createDefaultShadow(),
        groupId: null,
        locked: false,
        fill: theme.accent,
        stroke: 'transparent',
        strokeWidth: 0,
      };
    }

    if (tool === 'line' || tool === 'arrow') {
      return {
        id: uid(tool),
        type: tool,
        name: tool === 'arrow' ? 'Arrow' : 'Line',
        x,
        y,
        width: 12,
        height: 12,
        rotation: 0,
        opacity: 1,
        shadow: createDefaultShadow(),
        groupId: null,
        locked: false,
        x1: 0,
        y1: 0,
        x2: 12,
        y2: 12,
        stroke: theme.ink,
        strokeWidth: 5,
        dashed: false,
        arrowStart: false,
        arrowEnd: tool === 'arrow',
      };
    }

    if (tool === 'text') {
      return {
        id: uid('txt'),
        type: 'text',
        name: 'Text Box',
        x,
        y,
        width: 320,
        height: 96,
        rotation: 0,
        opacity: 1,
        shadow: createDefaultShadow(),
        groupId: null,
        locked: false,
        text: 'Type something…',
        fontFamily: theme.bodyFont,
        fontSize: 38,
        fontWeight: 600,
        fontStyle: 'normal',
        textAlign: 'left',
        verticalAlign: 'top',
        lineHeight: 1.35,
        letterSpacing: 0,
        color: theme.ink,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        cornerRadius: 8,
        padding: 8,
      };
    }

    return null;
  }

  public openInlineTextEditor(node: TextNode): void {
    this.commitInlineTextEdit();
    this.inlineOriginalNode = cloneNode(node);
    this.store.setEditingNode(node.id);

    const ta = document.createElement('textarea');
    ta.className = 'canvas-inline-text-editor';
    ta.value = node.text;

    const topLeft = this.viewport.worldToScreen(node.x, node.y);
    const w = node.width * this.viewport.zoom;
    const h = node.height * this.viewport.zoom;

    ta.style.left = `${topLeft.x}px`;
    ta.style.top = `${topLeft.y}px`;
    ta.style.width = `${w}px`;
    ta.style.height = `${h}px`;
    ta.style.transform = node.rotation !== 0 ? `rotate(${node.rotation}deg)` : 'none';
    ta.style.fontFamily = node.fontFamily;
    ta.style.fontSize = `${node.fontSize * this.viewport.zoom}px`;
    ta.style.fontWeight = String(node.fontWeight);
    ta.style.fontStyle = node.fontStyle;
    ta.style.lineHeight = String(node.lineHeight);
    ta.style.letterSpacing = `${node.letterSpacing * this.viewport.zoom}px`;
    ta.style.textAlign = node.textAlign;
    ta.style.color = node.color;
    ta.style.padding = `${node.padding * this.viewport.zoom}px`;

    ta.addEventListener('input', () => {
      node.text = ta.value;
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
        e.preventDefault();
        this.commitInlineTextEdit();
      }
    });
    ta.addEventListener('blur', () => {
      this.commitInlineTextEdit();
    });

    this.stageEl.appendChild(ta);
    this.inlineEditor = ta;
    ta.focus();
    ta.select();
  }

  public commitInlineTextEdit(): void {
    if (!this.inlineEditor || !this.inlineOriginalNode) return;
    const ta = this.inlineEditor;
    const orig = this.inlineOriginalNode;
    this.inlineEditor = null;
    this.inlineOriginalNode = null;

    const newText = ta.value;
    ta.remove();

    const current = this.store.getActiveSlide().nodes.find((n) => n.id === orig.id) as
      | TextNode
      | undefined;
    this.store.setEditingNode(null);

    if (current && newText !== orig.text) {
      current.text = newText;
      this.store.commitNodeSnapshots('Edit text', [orig], [cloneNode(current)]);
      const box = mergeBBoxes([computeNodeBBox(orig, true), computeNodeBBox(current, true)]);
      if (box) {
        this.store.emit({
          type: 'scene',
          dirtyRects: [box],
          slideId: this.store.activeSlideId,
        });
      }
    }
    this.requestFrame();
  }

  public async importImageFiles(files: FileList | File[], worldDropPt: Point): Promise<void> {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const dims = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 800, height: img.naturalHeight || 600 });
        img.onerror = () => resolve({ width: 800, height: 600 });
        img.src = dataUrl;
      });

      const assetId = uid('img_asset');
      const record: AssetRecord = {
        id: assetId,
        mimeType: file.type || 'image/png',
        dataUrl,
        width: dims.width,
        height: dims.height,
        createdAt: Date.now(),
      };

      await this.db.saveAsset(record);
      this.imageCache.registerDataUrl(assetId, dataUrl);

      const maxW = 860;
      const maxH = 620;
      const scale = Math.min(1, maxW / dims.width, maxH / dims.height);
      const w = Math.round(dims.width * scale);
      const h = Math.round(dims.height * scale);

      const node: ImageNode = {
        id: uid('image'),
        type: 'image',
        name: file.name.replace(/\.[^.]+$/, '') || 'Image',
        x: Math.round(worldDropPt.x - w * 0.5 + i * 28),
        y: Math.round(worldDropPt.y - h * 0.5 + i * 28),
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
        shadow: createDefaultShadow(),
        groupId: null,
        locked: false,
        assetId,
        naturalWidth: dims.width,
        naturalHeight: dims.height,
        objectFit: 'cover',
        cornerRadius: 16,
        stroke: 'transparent',
        strokeWidth: 0,
      };

      this.store.addNode(node, true);
    }
  }
}
