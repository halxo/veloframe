import type { BBox, LineNode, Point, SceneNode } from './types';

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function rotatePoint(px: number, py: number, cx: number, cy: number, angleDeg: number): Point {
  if (angleDeg === 0) return { x: px, y: py };
  const rad = degToRad(angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

export function getNodeCenter(node: SceneNode): Point {
  return {
    x: node.x + node.width * 0.5,
    y: node.y + node.height * 0.5,
  };
}

export function getNodeCorners(node: SceneNode): [Point, Point, Point, Point] {
  const cx = node.x + node.width * 0.5;
  const cy = node.y + node.height * 0.5;
  return [
    rotatePoint(node.x, node.y, cx, cy, node.rotation),
    rotatePoint(node.x + node.width, node.y, cx, cy, node.rotation),
    rotatePoint(node.x + node.width, node.y + node.height, cx, cy, node.rotation),
    rotatePoint(node.x, node.y + node.height, cx, cy, node.rotation),
  ];
}

/**
 * Computes the world-space axis-aligned bounding box (AABB) of a scene node,
 * optionally inflated by stroke width and drop shadow extent for dirty-rect painting.
 */
export function computeNodeBBox(node: SceneNode, includePaintMargin = false): BBox {
  let minX: number;
  let minY: number;
  let maxX: number;
  let maxY: number;

  if (node.rotation === 0) {
    minX = node.x;
    minY = node.y;
    maxX = node.x + node.width;
    maxY = node.y + node.height;
  } else {
    const corners = getNodeCorners(node);
    minX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
    minY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
    maxX = Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
    maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
  }

  if (includePaintMargin) {
    let margin = 4;
    if ('strokeWidth' in node && node.strokeWidth > 0) {
      margin += node.strokeWidth * 1.5;
    }
    if (node.type === 'arrow') {
      margin += Math.max(18, node.strokeWidth * 4);
    }
    minX -= margin;
    minY -= margin;
    maxX += margin;
    maxY += margin;

    if (node.shadow.enabled) {
      const blur = node.shadow.blur * 1.5 + 4;
      minX = Math.min(minX, minX + node.shadow.offsetX - blur);
      minY = Math.min(minY, minY + node.shadow.offsetY - blur);
      maxX = Math.max(maxX, maxX + node.shadow.offsetX + blur);
      maxY = Math.max(maxY, maxY + node.shadow.offsetY + blur);
    }
  }

  return { minX, minY, maxX, maxY };
}

export function mergeBBoxes(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function pointInBBox(x: number, y: number, b: BBox): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

export function expandBBox(b: BBox, pad: number): BBox {
  return {
    minX: b.minX - pad,
    minY: b.minY - pad,
    maxX: b.maxX + pad,
    maxY: b.maxY + pad,
  };
}

export function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTestNode(node: SceneNode, worldX: number, worldY: number, tolerance = 8): boolean {
  const cx = node.x + node.width * 0.5;
  const cy = node.y + node.height * 0.5;
  const local = rotatePoint(worldX, worldY, cx, cy, -node.rotation);

  if (node.type === 'line' || node.type === 'arrow') {
    const ln = node as LineNode;
    const x1 = ln.x + ln.x1;
    const y1 = ln.y + ln.y1;
    const x2 = ln.x + ln.x2;
    const y2 = ln.y + ln.y2;
    const dist = distanceToSegment(local.x, local.y, x1, y1, x2, y2);
    return dist <= Math.max(tolerance, ln.strokeWidth * 0.5 + 6);
  }

  if (node.type === 'ellipse') {
    const rx = Math.max(1, node.width * 0.5);
    const ry = Math.max(1, node.height * 0.5);
    const nx = (local.x - cx) / (rx + tolerance * 0.4);
    const ny = (local.y - cy) / (ry + tolerance * 0.4);
    return nx * nx + ny * ny <= 1;
  }

  return (
    local.x >= node.x - tolerance * 0.25 &&
    local.x <= node.x + node.width + tolerance * 0.25 &&
    local.y >= node.y - tolerance * 0.25 &&
    local.y <= node.y + node.height + tolerance * 0.25
  );
}

export function getSelectionBBox(nodes: SceneNode[]): BBox | null {
  if (nodes.length === 0) return null;
  if (nodes.length === 1) {
    const n = nodes[0];
    return {
      minX: n.x,
      minY: n.y,
      maxX: n.x + n.width,
      maxY: n.y + n.height,
    };
  }
  return mergeBBoxes(nodes.map((n) => computeNodeBBox(n, false)));
}
