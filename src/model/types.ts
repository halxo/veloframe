export type NodeType = 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'image';

export type TransitionType = 'none' | 'fade' | 'slide' | 'morph';

export type ToolType = 'select' | 'hand' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface DropShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface BaseNode {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  shadow: DropShadow;
  groupId: string | null;
  locked: boolean;
}

export interface RectNode extends BaseNode {
  type: 'rect';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
}

export interface EllipseNode extends BaseNode {
  type: 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface LineNode extends BaseNode {
  type: 'line' | 'arrow';
  /** Start point relative to (x, y) in local unrotated coordinates */
  x1: number;
  y1: number;
  /** End point relative to (x, y) in local unrotated coordinates */
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
}

export interface TextNode extends BaseNode {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  letterSpacing: number;
  color: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  padding: number;
}

export interface ImageNode extends BaseNode {
  type: 'image';
  assetId: string;
  naturalWidth: number;
  naturalHeight: number;
  objectFit: 'cover' | 'contain' | 'fill';
  cornerRadius: number;
  stroke: string;
  strokeWidth: number;
}

export type SceneNode = RectNode | EllipseNode | LineNode | TextNode | ImageNode;

export interface SlideBackground {
  type: 'solid' | 'gradient';
  color: string;
  gradientEnd?: string;
  gradientAngle?: number;
}

export interface Slide {
  id: string;
  background: SlideBackground;
  transition: TransitionType;
  transitionDurationMs: number;
  notes: string;
  nodes: SceneNode[];
}

export interface Presentation {
  id: string;
  title: string;
  slideWidth: number;
  slideHeight: number;
  themeId: string;
  slides: Slide[];
  createdAt: number;
  updatedAt: number;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  background: SlideBackground;
  surface: string;
  surfaceBorder: string;
  ink: string;
  mutedInk: string;
  accent: string;
  accentSoft: string;
  headingFont: string;
  bodyFont: string;
}

export type SlideLayoutType =
  | 'title'
  | 'section'
  | 'title-body'
  | 'two-column'
  | 'big-metric'
  | 'blank';

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
  kind: 'edge' | 'center' | 'spacing';
  label?: string;
}

export interface AssetRecord {
  id: string;
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: number;
}

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

export function createDefaultShadow(): DropShadow {
  return {
    enabled: false,
    color: 'rgba(15, 23, 42, 0.22)',
    blur: 24,
    offsetX: 0,
    offsetY: 12,
  };
}

export function uid(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 9);
  const time = Date.now().toString(36).slice(-5);
  return `${prefix}_${time}_${rand}`;
}

export function cloneNode<T extends SceneNode>(node: T): T {
  return {
    ...node,
    shadow: { ...node.shadow },
  };
}

export function cloneSlide(slide: Slide): Slide {
  return {
    ...slide,
    background: { ...slide.background },
    nodes: slide.nodes.map((n) => cloneNode(n)),
  };
}
