import { RTree } from '../engine/rtree';
import { computeNodeBBox } from '../model/geometry';
import {
  createSlideFromLayout,
  generateBenchmarkSlides,
  getThemeById,
} from '../model/themes';
import {
  cloneNode,
  cloneSlide,
  uid,
  type BBox,
  type Presentation,
  type SceneNode,
  type Slide,
  type SlideBackground,
  type SlideLayoutType,
  type ToolType,
  type TransitionType,
} from '../model/types';
import { CommandHistory } from './history';

export type StoreEventType =
  | 'scene'
  | 'selection'
  | 'slides'
  | 'tool'
  | 'history'
  | 'save-status';

export interface StoreChangeEvent {
  type: StoreEventType;
  dirtyRects?: BBox[];
  fullRepaint?: boolean;
  slideId?: string;
}

type StoreListener = (event: StoreChangeEvent) => void;

export class EditorStore {
  public presentation: Presentation;
  public activeSlideId: string;
  public selectedIds: Set<string> = new Set();
  public activeTool: ToolType = 'select';
  public editingNodeId: string | null = null;
  public saveStatus: 'saved' | 'saving' | 'offline' = 'saved';

  public readonly rtree: RTree<SceneNode>;
  public readonly history: CommandHistory;

  private listeners = new Set<StoreListener>();
  private clipboard: SceneNode[] = [];

  constructor(initialPresentation: Presentation) {
    this.presentation = initialPresentation;
    this.activeSlideId = initialPresentation.slides[0]?.id ?? '';
    this.rtree = new RTree<SceneNode>(9);
    this.history = new CommandHistory(() => this.emit({ type: 'history' }));
    this.rebuildSpatialIndex();
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: StoreChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  getActiveSlide(): Slide {
    const found = this.presentation.slides.find((s) => s.id === this.activeSlideId);
    if (found) return found;
    const fallback = this.presentation.slides[0];
    this.activeSlideId = fallback.id;
    return fallback;
  }

  getActiveSlideIndex(): number {
    return Math.max(
      0,
      this.presentation.slides.findIndex((s) => s.id === this.activeSlideId),
    );
  }

  getSelectedNodes(): SceneNode[] {
    const slide = this.getActiveSlide();
    return slide.nodes.filter((n) => this.selectedIds.has(n.id));
  }

  rebuildSpatialIndex(): void {
    const slide = this.getActiveSlide();
    this.rtree.rebuild(
      slide.nodes.map((node) => ({
        id: node.id,
        bbox: computeNodeBBox(node, true),
        value: node,
      })),
    );
  }

  setPresentation(pres: Presentation): void {
    this.presentation = pres;
    this.activeSlideId = pres.slides[0]?.id ?? '';
    this.selectedIds.clear();
    this.editingNodeId = null;
    this.history.clear();
    this.rebuildSpatialIndex();
    this.emit({ type: 'slides', fullRepaint: true });
    this.emit({ type: 'selection' });
    this.emit({ type: 'scene', fullRepaint: true, slideId: this.activeSlideId });
  }

  setSaveStatus(status: 'saved' | 'saving' | 'offline'): void {
    this.saveStatus = status;
    this.emit({ type: 'save-status' });
  }

  setTool(tool: ToolType): void {
    if (this.activeTool === tool) return;
    this.activeTool = tool;
    this.emit({ type: 'tool' });
  }

  setEditingNode(nodeId: string | null): void {
    if (this.editingNodeId === nodeId) return;
    this.editingNodeId = nodeId;
    this.emit({ type: 'scene', fullRepaint: true, slideId: this.activeSlideId });
  }

  setActiveSlide(slideId: string): void {
    if (this.activeSlideId === slideId) return;
    if (!this.presentation.slides.some((s) => s.id === slideId)) return;
    this.activeSlideId = slideId;
    this.selectedIds.clear();
    this.editingNodeId = null;
    this.rebuildSpatialIndex();
    this.emit({ type: 'slides', slideId });
    this.emit({ type: 'selection' });
    this.emit({ type: 'scene', fullRepaint: true, slideId });
  }

  selectNodes(ids: string[], expandGroups = true): void {
    const slide = this.getActiveSlide();
    const next = new Set<string>(ids);

    if (expandGroups && ids.length > 0) {
      const groupIds = new Set<string>();
      for (const n of slide.nodes) {
        if (next.has(n.id) && n.groupId) {
          groupIds.add(n.groupId);
        }
      }
      if (groupIds.size > 0) {
        for (const n of slide.nodes) {
          if (n.groupId && groupIds.has(n.groupId)) {
            next.add(n.id);
          }
        }
      }
    }

    this.selectedIds = next;
    this.emit({ type: 'selection' });
  }

  clearSelection(): void {
    if (this.selectedIds.size === 0) return;
    this.selectedIds.clear();
    this.emit({ type: 'selection' });
  }

  updateTitle(title: string): void {
    const trimmed = title.trim() || 'Untitled Presentation';
    if (this.presentation.title === trimmed) return;
    this.presentation.title = trimmed;
    this.presentation.updatedAt = Date.now();
    this.emit({ type: 'slides' });
  }

  addNode(node: SceneNode, select = true): void {
    const slide = this.getActiveSlide();
    const slideId = slide.id;
    const nodeCopy = cloneNode(node);

    this.history.execute({
      label: `Add ${node.type}`,
      timestamp: Date.now(),
      execute: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        const instance = cloneNode(nodeCopy);
        target.nodes.push(instance);
        this.presentation.updatedAt = Date.now();
        const bbox = computeNodeBBox(instance, true);
        if (this.activeSlideId === slideId) {
          this.rtree.insert(instance.id, bbox, instance);
          if (select) this.selectNodes([instance.id], false);
          this.emit({ type: 'scene', dirtyRects: [bbox], slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
      undo: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        const idx = target.nodes.findIndex((n) => n.id === nodeCopy.id);
        if (idx === -1) return;
        const removed = target.nodes.splice(idx, 1)[0];
        const bbox = computeNodeBBox(removed, true);
        this.presentation.updatedAt = Date.now();
        if (this.activeSlideId === slideId) {
          this.rtree.remove(removed.id);
          this.selectedIds.delete(removed.id);
          this.emit({ type: 'selection' });
          this.emit({ type: 'scene', dirtyRects: [bbox], slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
    });
  }

  /**
   * High-frequency mutation used during active pointer drags / resizes / rotations.
   * Updates R-tree and emits exact old+new dirty rects without pushing to undo stack until commit.
   */
  applyLiveNodeUpdates(updates: Map<string, Partial<SceneNode>>): void {
    const slide = this.getActiveSlide();
    const dirtyRects: BBox[] = [];

    for (let i = 0; i < slide.nodes.length; i++) {
      const node = slide.nodes[i];
      const patch = updates.get(node.id);
      if (!patch) continue;
      const oldBox = this.rtree.getCachedBBox(node.id) ?? computeNodeBBox(node, true);
      dirtyRects.push(oldBox);
      Object.assign(node, patch);
      const newBox = computeNodeBBox(node, true);
      dirtyRects.push(newBox);
      this.rtree.update(node.id, newBox, node);
    }

    if (dirtyRects.length > 0) {
      this.emit({ type: 'scene', dirtyRects, slideId: slide.id });
    }
  }

  commitNodeSnapshots(
    label: string,
    before: SceneNode[],
    after: SceneNode[],
    coalesceKey?: string,
  ): void {
    const slideId = this.activeSlideId;
    const beforeClones = before.map((n) => cloneNode(n));
    const afterClones = after.map((n) => cloneNode(n));

    const applySnapshots = (snaps: SceneNode[]) => {
      const slide = this.presentation.slides.find((s) => s.id === slideId);
      if (!slide) return;
      const map = new Map(snaps.map((s) => [s.id, s]));
      const dirtyRects: BBox[] = [];
      for (let i = 0; i < slide.nodes.length; i++) {
        const cur = slide.nodes[i];
        const target = map.get(cur.id);
        if (!target) continue;
        dirtyRects.push(computeNodeBBox(cur, true));
        const nextNode = cloneNode(target);
        slide.nodes[i] = nextNode;
        const newBox = computeNodeBBox(nextNode, true);
        dirtyRects.push(newBox);
        if (this.activeSlideId === slideId) {
          this.rtree.update(nextNode.id, newBox, nextNode);
        }
      }
      this.presentation.updatedAt = Date.now();
      if (this.activeSlideId === slideId) {
        this.emit({ type: 'scene', dirtyRects, slideId });
        this.emit({ type: 'selection' });
      }
      this.emit({ type: 'slides', slideId });
    };

    this.presentation.updatedAt = Date.now();
    this.history.pushExecuted({
      label,
      coalesceKey,
      timestamp: Date.now(),
      execute: () => applySnapshots(afterClones),
      undo: () => applySnapshots(beforeClones),
    });
    this.emit({ type: 'slides', slideId });
  }

  updateSelectedNodes(
    patch: Partial<SceneNode>,
    label = 'Update properties',
    coalesceKey?: string,
  ): void {
    const selected = this.getSelectedNodes();
    if (selected.length === 0) return;
    const before = selected.map((n) => cloneNode(n));
    const updates = new Map<string, Partial<SceneNode>>();
    for (const n of selected) {
      updates.set(n.id, patch);
    }
    this.applyLiveNodeUpdates(updates);
    const after = this.getSelectedNodes().map((n) => cloneNode(n));
    this.commitNodeSnapshots(label, before, after, coalesceKey);
    this.emit({ type: 'selection' });
  }

  deleteSelectedNodes(): void {
    const slide = this.getActiveSlide();
    const ids = new Set(this.selectedIds);
    if (ids.size === 0) return;

    const slideId = slide.id;
    const removedWithIdx: Array<{ index: number; node: SceneNode }> = [];
    slide.nodes.forEach((n, idx) => {
      if (ids.has(n.id)) removedWithIdx.push({ index: idx, node: cloneNode(n) });
    });

    this.history.execute({
      label: 'Delete objects',
      timestamp: Date.now(),
      execute: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        const dirtyRects: BBox[] = [];
        target.nodes = target.nodes.filter((n) => {
          if (ids.has(n.id)) {
            dirtyRects.push(computeNodeBBox(n, true));
            if (this.activeSlideId === slideId) this.rtree.remove(n.id);
            return false;
          }
          return true;
        });
        this.presentation.updatedAt = Date.now();
        if (this.activeSlideId === slideId) {
          this.selectedIds.clear();
          this.emit({ type: 'selection' });
          this.emit({ type: 'scene', dirtyRects, slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
      undo: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        const dirtyRects: BBox[] = [];
        const restoredIds: string[] = [];
        for (const item of removedWithIdx) {
          const clone = cloneNode(item.node);
          target.nodes.splice(Math.min(item.index, target.nodes.length), 0, clone);
          const bbox = computeNodeBBox(clone, true);
          dirtyRects.push(bbox);
          restoredIds.push(clone.id);
          if (this.activeSlideId === slideId) this.rtree.insert(clone.id, bbox, clone);
        }
        this.presentation.updatedAt = Date.now();
        if (this.activeSlideId === slideId) {
          this.selectNodes(restoredIds, false);
          this.emit({ type: 'scene', dirtyRects, slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
    });
  }

  copySelection(): void {
    const selected = this.getSelectedNodes();
    if (selected.length === 0) return;
    this.clipboard = selected.map((n) => cloneNode(n));
  }

  pasteClipboard(): void {
    if (this.clipboard.length === 0) return;
    const slide = this.getActiveSlide();
    const slideId = slide.id;
    const groupMap = new Map<string, string>();
    const newNodes = this.clipboard.map((n) => {
      const c = cloneNode(n);
      c.id = uid(c.type);
      c.x += 32;
      c.y += 32;
      if (c.groupId) {
        let mapped = groupMap.get(c.groupId);
        if (!mapped) {
          mapped = uid('grp');
          groupMap.set(c.groupId, mapped);
        }
        c.groupId = mapped;
      }
      return c;
    });
    // Shift clipboard slightly so repeated paste cascades cleanly
    this.clipboard = newNodes.map((n) => cloneNode(n));

    this.history.execute({
      label: 'Paste objects',
      timestamp: Date.now(),
      execute: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        const dirtyRects: BBox[] = [];
        const ids: string[] = [];
        for (const n of newNodes) {
          const inst = cloneNode(n);
          target.nodes.push(inst);
          const bbox = computeNodeBBox(inst, true);
          dirtyRects.push(bbox);
          ids.push(inst.id);
          if (this.activeSlideId === slideId) this.rtree.insert(inst.id, bbox, inst);
        }
        this.presentation.updatedAt = Date.now();
        if (this.activeSlideId === slideId) {
          this.selectNodes(ids, false);
          this.emit({ type: 'scene', dirtyRects, slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
      undo: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        const idSet = new Set(newNodes.map((n) => n.id));
        const dirtyRects: BBox[] = [];
        target.nodes = target.nodes.filter((n) => {
          if (idSet.has(n.id)) {
            dirtyRects.push(computeNodeBBox(n, true));
            if (this.activeSlideId === slideId) this.rtree.remove(n.id);
            return false;
          }
          return true;
        });
        this.presentation.updatedAt = Date.now();
        if (this.activeSlideId === slideId) {
          this.selectedIds.clear();
          this.emit({ type: 'selection' });
          this.emit({ type: 'scene', dirtyRects, slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
    });
  }

  duplicateSelection(): void {
    this.copySelection();
    this.pasteClipboard();
  }

  toggleGroupSelection(): void {
    const selected = this.getSelectedNodes();
    if (selected.length < 2) return;
    const allSameGroup =
      selected[0].groupId !== null &&
      selected.every((n) => n.groupId === selected[0].groupId);
    const nextGroupId = allSameGroup ? null : uid('grp');
    this.updateSelectedNodes(
      { groupId: nextGroupId },
      allSameGroup ? 'Ungroup objects' : 'Group objects',
    );
  }

  reorderLayer(direction: 'front' | 'forward' | 'backward' | 'back'): void {
    const slide = this.getActiveSlide();
    if (this.selectedIds.size === 0) return;
    const slideId = slide.id;
    const prevOrder = slide.nodes.map((n) => n.id);
    const nextNodes = [...slide.nodes];

    if (direction === 'front') {
      const rest = nextNodes.filter((n) => !this.selectedIds.has(n.id));
      const sel = nextNodes.filter((n) => this.selectedIds.has(n.id));
      nextNodes.splice(0, nextNodes.length, ...rest, ...sel);
    } else if (direction === 'back') {
      const rest = nextNodes.filter((n) => !this.selectedIds.has(n.id));
      const sel = nextNodes.filter((n) => this.selectedIds.has(n.id));
      nextNodes.splice(0, nextNodes.length, ...sel, ...rest);
    } else if (direction === 'forward') {
      for (let i = nextNodes.length - 2; i >= 0; i--) {
        if (this.selectedIds.has(nextNodes[i].id) && !this.selectedIds.has(nextNodes[i + 1].id)) {
          const tmp = nextNodes[i];
          nextNodes[i] = nextNodes[i + 1];
          nextNodes[i + 1] = tmp;
        }
      }
    } else if (direction === 'backward') {
      for (let i = 1; i < nextNodes.length; i++) {
        if (this.selectedIds.has(nextNodes[i].id) && !this.selectedIds.has(nextNodes[i - 1].id)) {
          const tmp = nextNodes[i];
          nextNodes[i] = nextNodes[i - 1];
          nextNodes[i - 1] = tmp;
        }
      }
    }

    const nextOrder = nextNodes.map((n) => n.id);
    if (prevOrder.every((id, idx) => id === nextOrder[idx])) return;

    const applyOrder = (order: string[]) => {
      const target = this.presentation.slides.find((s) => s.id === slideId);
      if (!target) return;
      const byId = new Map(target.nodes.map((n) => [n.id, n]));
      target.nodes = order.map((id) => byId.get(id)!).filter(Boolean);
      this.presentation.updatedAt = Date.now();
      if (this.activeSlideId === slideId) {
        this.emit({ type: 'scene', fullRepaint: true, slideId });
      }
      this.emit({ type: 'slides', slideId });
    };

    this.history.execute({
      label: `Bring ${direction}`,
      timestamp: Date.now(),
      execute: () => applyOrder(nextOrder),
      undo: () => applyOrder(prevOrder),
    });
  }

  updateSlideBackground(bg: SlideBackground): void {
    const slide = this.getActiveSlide();
    const slideId = slide.id;
    const prev = { ...slide.background };
    const next = { ...bg };

    this.history.execute({
      label: 'Change slide background',
      coalesceKey: `bg_${slideId}`,
      timestamp: Date.now(),
      execute: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        target.background = { ...next };
        this.presentation.updatedAt = Date.now();
        if (this.activeSlideId === slideId) {
          this.emit({ type: 'scene', fullRepaint: true, slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
      undo: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        target.background = { ...prev };
        this.presentation.updatedAt = Date.now();
        if (this.activeSlideId === slideId) {
          this.emit({ type: 'scene', fullRepaint: true, slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
    });
  }

  updateSlideTransition(transition: TransitionType, durationMs?: number): void {
    const slide = this.getActiveSlide();
    slide.transition = transition;
    if (durationMs !== undefined) slide.transitionDurationMs = durationMs;
    this.presentation.updatedAt = Date.now();
    this.emit({ type: 'selection' });
    this.emit({ type: 'slides', slideId: slide.id });
  }

  updateSlideNotes(notes: string): void {
    const slide = this.getActiveSlide();
    slide.notes = notes;
    this.presentation.updatedAt = Date.now();
    this.emit({ type: 'slides', slideId: slide.id });
  }

  addSlide(layout: SlideLayoutType = 'title-body', insertAfterActive = true): void {
    const theme = getThemeById(this.presentation.themeId);
    const newSlide = createSlideFromLayout(layout, theme);
    const insertIdx = insertAfterActive
      ? this.getActiveSlideIndex() + 1
      : this.presentation.slides.length;
    const prevActive = this.activeSlideId;

    this.history.execute({
      label: 'Add slide',
      timestamp: Date.now(),
      execute: () => {
        this.presentation.slides.splice(insertIdx, 0, cloneSlide(newSlide));
        this.presentation.updatedAt = Date.now();
        this.setActiveSlide(newSlide.id);
      },
      undo: () => {
        const idx = this.presentation.slides.findIndex((s) => s.id === newSlide.id);
        if (idx !== -1) this.presentation.slides.splice(idx, 1);
        this.presentation.updatedAt = Date.now();
        this.setActiveSlide(prevActive);
      },
    });
  }

  duplicateSlide(slideId = this.activeSlideId): void {
    const idx = this.presentation.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return;
    const copy = cloneSlide(this.presentation.slides[idx]);
    copy.id = uid('slide');
    const prevActive = this.activeSlideId;

    this.history.execute({
      label: 'Duplicate slide',
      timestamp: Date.now(),
      execute: () => {
        this.presentation.slides.splice(idx + 1, 0, cloneSlide(copy));
        this.presentation.updatedAt = Date.now();
        this.setActiveSlide(copy.id);
      },
      undo: () => {
        const rmIdx = this.presentation.slides.findIndex((s) => s.id === copy.id);
        if (rmIdx !== -1) this.presentation.slides.splice(rmIdx, 1);
        this.presentation.updatedAt = Date.now();
        this.setActiveSlide(prevActive);
      },
    });
  }

  deleteSlide(slideId = this.activeSlideId): void {
    if (this.presentation.slides.length <= 1) return;
    const idx = this.presentation.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return;
    const removed = cloneSlide(this.presentation.slides[idx]);

    this.history.execute({
      label: 'Delete slide',
      timestamp: Date.now(),
      execute: () => {
        const curIdx = this.presentation.slides.findIndex((s) => s.id === slideId);
        if (curIdx === -1) return;
        this.presentation.slides.splice(curIdx, 1);
        this.presentation.updatedAt = Date.now();
        const nextSlide = this.presentation.slides[Math.min(curIdx, this.presentation.slides.length - 1)];
        this.setActiveSlide(nextSlide.id);
      },
      undo: () => {
        this.presentation.slides.splice(idx, 0, cloneSlide(removed));
        this.presentation.updatedAt = Date.now();
        this.setActiveSlide(removed.id);
      },
    });
  }

  reorderSlide(fromIndex: number, toIndex: number): void {
    const len = this.presentation.slides.length;
    if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len || fromIndex === toIndex) {
      return;
    }

    const move = (from: number, to: number) => {
      const [item] = this.presentation.slides.splice(from, 1);
      this.presentation.slides.splice(to, 0, item);
      this.presentation.updatedAt = Date.now();
      this.emit({ type: 'slides' });
    };

    this.history.execute({
      label: 'Reorder slide',
      timestamp: Date.now(),
      execute: () => move(fromIndex, toIndex),
      undo: () => move(toIndex, fromIndex),
    });
  }

  applyTheme(themeId: string): void {
    const theme = getThemeById(themeId);
    const prevThemeId = this.presentation.themeId;
    const prevSlides = this.presentation.slides.map((s) => cloneSlide(s));

    this.history.execute({
      label: `Apply theme ${theme.name}`,
      timestamp: Date.now(),
      execute: () => {
        this.presentation.themeId = theme.id;
        for (const slide of this.presentation.slides) {
          slide.background = { ...theme.background };
          for (const node of slide.nodes) {
            if (node.type === 'text') {
              node.fontFamily = node.fontSize >= 42 ? theme.headingFont : theme.bodyFont;
              if (node.color === '#141517' || node.color === '#0F172A' || node.color === '#F8FAFC' || node.color === '#241B15' || node.color === '#FFFFFF') {
                node.color = theme.ink;
              } else if (node.color === '#5C606B' || node.color === '#9AA4B2' || node.color === '#475569' || node.color === '#6E5A4C' || node.color === '#B6C9E8') {
                node.color = theme.mutedInk;
              }
            } else if (node.type === 'rect') {
              if (node.fill === '#FFFFFF' || node.fill === '#1F242E' || node.fill === '#FFFDF9' || node.fill === '#173A72') {
                node.fill = theme.surface;
                if (node.strokeWidth > 0) node.stroke = theme.surfaceBorder;
              }
            }
          }
        }
        this.presentation.updatedAt = Date.now();
        this.rebuildSpatialIndex();
        this.emit({ type: 'scene', fullRepaint: true, slideId: this.activeSlideId });
        this.emit({ type: 'slides', fullRepaint: true });
        this.emit({ type: 'selection' });
      },
      undo: () => {
        this.presentation.themeId = prevThemeId;
        this.presentation.slides = prevSlides.map((s) => cloneSlide(s));
        this.presentation.updatedAt = Date.now();
        this.rebuildSpatialIndex();
        this.emit({ type: 'scene', fullRepaint: true, slideId: this.activeSlideId });
        this.emit({ type: 'slides', fullRepaint: true });
        this.emit({ type: 'selection' });
      },
    });
  }

  applyLayoutToActiveSlide(layout: SlideLayoutType): void {
    const theme = getThemeById(this.presentation.themeId);
    const template = createSlideFromLayout(layout, theme);
    const slide = this.getActiveSlide();
    const slideId = slide.id;
    const prevSlide = cloneSlide(slide);

    this.history.execute({
      label: `Apply ${layout} layout`,
      timestamp: Date.now(),
      execute: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        target.nodes = template.nodes.map((n) => cloneNode(n));
        target.background = { ...template.background };
        this.presentation.updatedAt = Date.now();
        if (this.activeSlideId === slideId) {
          this.selectedIds.clear();
          this.rebuildSpatialIndex();
          this.emit({ type: 'selection' });
          this.emit({ type: 'scene', fullRepaint: true, slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
      undo: () => {
        const target = this.presentation.slides.find((s) => s.id === slideId);
        if (!target) return;
        target.nodes = prevSlide.nodes.map((n) => cloneNode(n));
        target.background = { ...prevSlide.background };
        this.presentation.updatedAt = Date.now();
        if (this.activeSlideId === slideId) {
          this.selectedIds.clear();
          this.rebuildSpatialIndex();
          this.emit({ type: 'selection' });
          this.emit({ type: 'scene', fullRepaint: true, slideId });
        }
        this.emit({ type: 'slides', slideId });
      },
    });
  }

  appendBenchmarkSlides(count = 100): void {
    const theme = getThemeById(this.presentation.themeId);
    const batch = generateBenchmarkSlides(count, theme);
    this.presentation.slides.push(...batch);
    this.presentation.updatedAt = Date.now();
    this.emit({ type: 'slides', fullRepaint: true });
  }
}
