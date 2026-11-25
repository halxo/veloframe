import { computeNodeBBox } from '../model/geometry';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type BBox, type SceneNode, type SnapGuide } from '../model/types';

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

interface CandidateLine {
  pos: number;
  start: number;
  end: number;
  kind: 'edge' | 'center';
}

/**
 * Computes real-time magnetic snapping for moving objects against slide boundaries,
 * slide centerlines, sibling object edges/centers, and equal-spacing distribution gaps.
 */
export function computeSmartSnap(
  movingBBox: BBox,
  siblings: SceneNode[],
  thresholdWorld: number,
): SnapResult {
  const guides: SnapGuide[] = [];
  const movingLeft = movingBBox.minX;
  const movingRight = movingBBox.maxX;
  const movingCenterX = (movingLeft + movingRight) * 0.5;
  const movingTop = movingBBox.minY;
  const movingBottom = movingBBox.maxY;
  const movingCenterY = (movingTop + movingBottom) * 0.5;

  const vCandidates: CandidateLine[] = [
    { pos: 0, start: 0, end: SLIDE_HEIGHT, kind: 'edge' },
    { pos: SLIDE_WIDTH * 0.5, start: 0, end: SLIDE_HEIGHT, kind: 'center' },
    { pos: SLIDE_WIDTH, start: 0, end: SLIDE_HEIGHT, kind: 'edge' },
  ];
  const hCandidates: CandidateLine[] = [
    { pos: 0, start: 0, end: SLIDE_WIDTH, kind: 'edge' },
    { pos: SLIDE_HEIGHT * 0.5, start: 0, end: SLIDE_WIDTH, kind: 'center' },
    { pos: SLIDE_HEIGHT, start: 0, end: SLIDE_WIDTH, kind: 'edge' },
  ];

  const siblingBoxes: BBox[] = [];
  for (let i = 0; i < siblings.length; i++) {
    const b = computeNodeBBox(siblings[i], false);
    siblingBoxes.push(b);
    const cx = (b.minX + b.maxX) * 0.5;
    const cy = (b.minY + b.maxY) * 0.5;

    vCandidates.push(
      { pos: b.minX, start: Math.min(b.minY, movingTop), end: Math.max(b.maxY, movingBottom), kind: 'edge' },
      { pos: cx, start: Math.min(b.minY, movingTop), end: Math.max(b.maxY, movingBottom), kind: 'center' },
      { pos: b.maxX, start: Math.min(b.minY, movingTop), end: Math.max(b.maxY, movingBottom), kind: 'edge' },
    );
    hCandidates.push(
      { pos: b.minY, start: Math.min(b.minX, movingLeft), end: Math.max(b.maxX, movingRight), kind: 'edge' },
      { pos: cy, start: Math.min(b.minX, movingLeft), end: Math.max(b.maxX, movingRight), kind: 'center' },
      { pos: b.maxY, start: Math.min(b.minX, movingLeft), end: Math.max(b.maxX, movingRight), kind: 'edge' },
    );
  }

  // Find closest vertical snap (X axis)
  let bestDx = 0;
  let bestDistX = thresholdWorld + 0.001;
  let bestVGuide: SnapGuide | null = null;
  const movingXPoints = [movingLeft, movingCenterX, movingRight];

  for (let i = 0; i < vCandidates.length; i++) {
    const cand = vCandidates[i];
    for (let j = 0; j < movingXPoints.length; j++) {
      const diff = cand.pos - movingXPoints[j];
      const absDiff = Math.abs(diff);
      if (absDiff < bestDistX) {
        bestDistX = absDiff;
        bestDx = diff;
        bestVGuide = {
          orientation: 'vertical',
          position: cand.pos,
          start: cand.start,
          end: cand.end,
          kind: cand.kind,
        };
      }
    }
  }

  // Find closest horizontal snap (Y axis)
  let bestDy = 0;
  let bestDistY = thresholdWorld + 0.001;
  let bestHGuide: SnapGuide | null = null;
  const movingYPoints = [movingTop, movingCenterY, movingBottom];

  for (let i = 0; i < hCandidates.length; i++) {
    const cand = hCandidates[i];
    for (let j = 0; j < movingYPoints.length; j++) {
      const diff = cand.pos - movingYPoints[j];
      const absDiff = Math.abs(diff);
      if (absDiff < bestDistY) {
        bestDistY = absDiff;
        bestDy = diff;
        bestHGuide = {
          orientation: 'horizontal',
          position: cand.pos,
          start: cand.start,
          end: cand.end,
          kind: cand.kind,
        };
      }
    }
  }

  if (bestVGuide) guides.push(bestVGuide);
  if (bestHGuide) guides.push(bestHGuide);

  // Equal-spacing horizontal detection when moving between two siblings
  const adjLeft = movingLeft + bestDx;
  const adjRight = movingRight + bestDx;
  const adjTop = movingTop + bestDy;
  const adjBottom = movingBottom + bestDy;

  const hBandSiblings = siblingBoxes
    .filter((b) => b.maxY > adjTop && b.minY < adjBottom)
    .sort((a, b) => a.minX - b.minX);

  if (hBandSiblings.length >= 2) {
    // Check if moving box sits between leftNeighbor and rightNeighbor
    let leftNeighbor: BBox | null = null;
    let rightNeighbor: BBox | null = null;
    for (let i = 0; i < hBandSiblings.length; i++) {
      const b = hBandSiblings[i];
      if (b.maxX <= adjLeft + thresholdWorld) {
        leftNeighbor = b;
      } else if (b.minX >= adjRight - thresholdWorld && !rightNeighbor) {
        rightNeighbor = b;
      }
    }

    if (leftNeighbor && rightNeighbor) {
      const gapL = movingLeft - leftNeighbor.maxX;
      const gapR = rightNeighbor.minX - movingRight;
      const delta = (gapR - gapL) * 0.5;
      if (Math.abs(delta) < thresholdWorld && gapL > 4 && gapR > 4) {
        bestDx = delta;
        const snappedLeft = movingLeft + bestDx;
        const snappedRight = movingRight + bestDx;
        const eqGap = Math.round(snappedLeft - leftNeighbor.maxX);
        const midY = (Math.max(adjTop, leftNeighbor.minY, rightNeighbor.minY) + Math.min(adjBottom, leftNeighbor.maxY, rightNeighbor.maxY)) * 0.5;
        guides.push(
          {
            orientation: 'horizontal',
            position: midY,
            start: leftNeighbor.maxX,
            end: snappedLeft,
            kind: 'spacing',
            label: `${eqGap}px`,
          },
          {
            orientation: 'horizontal',
            position: midY,
            start: snappedRight,
            end: rightNeighbor.minX,
            kind: 'spacing',
            label: `${eqGap}px`,
          },
        );
      }
    }
  }

  // Equal-spacing vertical detection when moving between top and bottom siblings
  const vBandSiblings = siblingBoxes
    .filter((b) => b.maxX > adjLeft && b.minX < adjRight)
    .sort((a, b) => a.minY - b.minY);

  if (vBandSiblings.length >= 2) {
    let topNeighbor: BBox | null = null;
    let bottomNeighbor: BBox | null = null;
    for (let i = 0; i < vBandSiblings.length; i++) {
      const b = vBandSiblings[i];
      if (b.maxY <= adjTop + thresholdWorld) {
        topNeighbor = b;
      } else if (b.minY >= adjBottom - thresholdWorld && !bottomNeighbor) {
        bottomNeighbor = b;
      }
    }

    if (topNeighbor && bottomNeighbor) {
      const gapT = movingTop - topNeighbor.maxY;
      const gapB = bottomNeighbor.minY - movingBottom;
      const delta = (gapB - gapT) * 0.5;
      if (Math.abs(delta) < thresholdWorld && gapT > 4 && gapB > 4) {
        bestDy = delta;
        const snappedTop = movingTop + bestDy;
        const snappedBottom = movingBottom + bestDy;
        const eqGap = Math.round(snappedTop - topNeighbor.maxY);
        const midX = (Math.max(adjLeft, topNeighbor.minX, bottomNeighbor.minX) + Math.min(adjRight, topNeighbor.maxX, bottomNeighbor.maxX)) * 0.5;
        guides.push(
          {
            orientation: 'vertical',
            position: midX,
            start: topNeighbor.maxY,
            end: snappedTop,
            kind: 'spacing',
            label: `${eqGap}px`,
          },
          {
            orientation: 'vertical',
            position: midX,
            start: snappedBottom,
            end: bottomNeighbor.minY,
            kind: 'spacing',
            label: `${eqGap}px`,
          },
        );
      }
    }
  }

  return { dx: bestDx, dy: bestDy, guides };
}
