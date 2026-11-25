import { bboxesIntersect, pointInBBox } from '../model/geometry';
import type { BBox } from '../model/types';

interface RTreeEntry<T> {
  id: string;
  bbox: BBox;
  value: T;
}

interface RTreeNode<T> {
  leaf: boolean;
  bbox: BBox;
  children: RTreeNode<T>[];
  entries: RTreeEntry<T>[];
}

function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function bboxArea(b: BBox): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function enlargement(base: BBox, add: BBox): number {
  return bboxArea(unionBBox(base, add)) - bboxArea(base);
}

function recomputeNodeBBox<T>(node: RTreeNode<T>): void {
  const b = emptyBBox();
  if (node.leaf) {
    for (let i = 0; i < node.entries.length; i++) {
      const eb = node.entries[i].bbox;
      if (eb.minX < b.minX) b.minX = eb.minX;
      if (eb.minY < b.minY) b.minY = eb.minY;
      if (eb.maxX > b.maxX) b.maxX = eb.maxX;
      if (eb.maxY > b.maxY) b.maxY = eb.maxY;
    }
  } else {
    for (let i = 0; i < node.children.length; i++) {
      const cb = node.children[i].bbox;
      if (cb.minX < b.minX) b.minX = cb.minX;
      if (cb.minY < b.minY) b.minY = cb.minY;
      if (cb.maxX > b.maxX) b.maxX = cb.maxX;
      if (cb.maxY > b.maxY) b.maxY = cb.maxY;
    }
  }
  node.bbox = b;
}

/**
 * 2D R-Tree spatial index with an integrated ID -> BBox cache for O(1) bbox lookups
 * and O(log N) spatial queries (hit-testing, viewport culling, snapping).
 */
export class RTree<T> {
  private maxEntries: number;
  private minEntries: number;
  private root: RTreeNode<T>;
  private bboxCache: Map<string, BBox>;

  constructor(maxEntries = 9) {
    this.maxEntries = Math.max(4, maxEntries);
    this.minEntries = Math.max(2, Math.ceil(this.maxEntries * 0.4));
    this.root = this.createLeaf();
    this.bboxCache = new Map();
  }

  private createLeaf(): RTreeNode<T> {
    return { leaf: true, bbox: emptyBBox(), children: [], entries: [] };
  }

  private createInternal(): RTreeNode<T> {
    return { leaf: false, bbox: emptyBBox(), children: [], entries: [] };
  }

  clear(): void {
    this.root = this.createLeaf();
    this.bboxCache.clear();
  }

  getCachedBBox(id: string): BBox | undefined {
    return this.bboxCache.get(id);
  }

  rebuild(items: Array<{ id: string; bbox: BBox; value: T }>): void {
    this.clear();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      this.insert(item.id, item.bbox, item.value);
    }
  }

  insert(id: string, bbox: BBox, value: T): void {
    const entry: RTreeEntry<T> = { id, bbox: { ...bbox }, value };
    this.bboxCache.set(id, entry.bbox);

    const path: RTreeNode<T>[] = [];
    let current = this.root;

    while (!current.leaf) {
      path.push(current);
      let bestIdx = 0;
      let bestEnlarge = Infinity;
      let bestArea = Infinity;

      for (let i = 0; i < current.children.length; i++) {
        const child = current.children[i];
        const enl = enlargement(child.bbox, entry.bbox);
        const area = bboxArea(child.bbox);
        if (enl < bestEnlarge || (enl === bestEnlarge && area < bestArea)) {
          bestEnlarge = enl;
          bestArea = area;
          bestIdx = i;
        }
      }
      current = current.children[bestIdx];
    }

    current.entries.push(entry);
    recomputeNodeBBox(current);
    path.push(current);

    for (let level = path.length - 1; level >= 0; level--) {
      const node = path[level];
      recomputeNodeBBox(node);
      const count = node.leaf ? node.entries.length : node.children.length;
      if (count > this.maxEntries) {
        const sibling = this.splitNode(node);
        if (level === 0) {
          const newRoot = this.createInternal();
          newRoot.children.push(node, sibling);
          recomputeNodeBBox(newRoot);
          this.root = newRoot;
        } else {
          const parent = path[level - 1];
          parent.children.push(sibling);
          recomputeNodeBBox(parent);
        }
      }
    }
  }

  remove(id: string): boolean {
    const cached = this.bboxCache.get(id);
    if (!cached) return false;
    const removed = this.removeRecursive(this.root, id, cached);
    if (removed) {
      this.bboxCache.delete(id);
      if (!this.root.leaf && this.root.children.length === 1) {
        this.root = this.root.children[0];
      }
    }
    return removed;
  }

  update(id: string, bbox: BBox, value: T): void {
    this.remove(id);
    this.insert(id, bbox, value);
  }

  queryRect(rect: BBox): T[] {
    const result: T[] = [];
    if (!bboxesIntersect(this.root.bbox, rect)) return result;
    const stack: RTreeNode<T>[] = [this.root];

    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.leaf) {
        for (let i = 0; i < node.entries.length; i++) {
          const e = node.entries[i];
          if (bboxesIntersect(e.bbox, rect)) {
            result.push(e.value);
          }
        }
      } else {
        for (let i = 0; i < node.children.length; i++) {
          const c = node.children[i];
          if (bboxesIntersect(c.bbox, rect)) {
            stack.push(c);
          }
        }
      }
    }
    return result;
  }

  queryPoint(x: number, y: number, pad = 0): T[] {
    if (pad > 0) {
      return this.queryRect({ minX: x - pad, minY: y - pad, maxX: x + pad, maxY: y + pad });
    }
    const result: T[] = [];
    if (!pointInBBox(x, y, this.root.bbox)) return result;
    const stack: RTreeNode<T>[] = [this.root];

    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.leaf) {
        for (let i = 0; i < node.entries.length; i++) {
          const e = node.entries[i];
          if (pointInBBox(x, y, e.bbox)) {
            result.push(e.value);
          }
        }
      } else {
        for (let i = 0; i < node.children.length; i++) {
          const c = node.children[i];
          if (pointInBBox(x, y, c.bbox)) {
            stack.push(c);
          }
        }
      }
    }
    return result;
  }

  private removeRecursive(node: RTreeNode<T>, id: string, bbox: BBox): boolean {
    if (!bboxesIntersect(node.bbox, bbox)) return false;

    if (node.leaf) {
      const idx = node.entries.findIndex((e) => e.id === id);
      if (idx === -1) return false;
      node.entries.splice(idx, 1);
      recomputeNodeBBox(node);
      return true;
    }

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (this.removeRecursive(child, id, bbox)) {
        const isEmpty = child.leaf ? child.entries.length === 0 : child.children.length === 0;
        if (isEmpty) {
          node.children.splice(i, 1);
        }
        recomputeNodeBBox(node);
        return true;
      }
    }
    return false;
  }

  private splitNode(node: RTreeNode<T>): RTreeNode<T> {
    if (node.leaf) {
      const entries = node.entries;
      const spreadX = node.bbox.maxX - node.bbox.minX;
      const spreadY = node.bbox.maxY - node.bbox.minY;
      entries.sort((a, b) =>
        spreadX >= spreadY
          ? a.bbox.minX + a.bbox.maxX - (b.bbox.minX + b.bbox.maxX)
          : a.bbox.minY + a.bbox.maxY - (b.bbox.minY + b.bbox.maxY),
      );
      const splitIdx = Math.max(this.minEntries, Math.floor(entries.length * 0.5));
      const right = this.createLeaf();
      right.entries = entries.splice(splitIdx);
      recomputeNodeBBox(node);
      recomputeNodeBBox(right);
      return right;
    }

    const children = node.children;
    const spreadX = node.bbox.maxX - node.bbox.minX;
    const spreadY = node.bbox.maxY - node.bbox.minY;
    children.sort((a, b) =>
      spreadX >= spreadY
        ? a.bbox.minX + a.bbox.maxX - (b.bbox.minX + b.bbox.maxX)
        : a.bbox.minY + a.bbox.maxY - (b.bbox.minY + b.bbox.maxY),
    );
    const splitIdx = Math.max(this.minEntries, Math.floor(children.length * 0.5));
    const right = this.createInternal();
    right.children = children.splice(splitIdx);
    recomputeNodeBBox(node);
    recomputeNodeBBox(right);
    return right;
  }
}
