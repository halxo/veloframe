import type { ImageCache } from '../engine/imageCache';
import { renderSlideToCanvas } from '../engine/renderer';
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type AssetRecord,
  type EllipseNode,
  type ImageNode,
  type LineNode,
  type Presentation,
  type RectNode,
  type SceneNode,
  type Slide,
  type TextNode,
} from '../model/types';
import type { VeloFrameDB } from './db';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeFilename(title: string): string {
  return (title || 'veloframe-deck')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'veloframe-deck';
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function exportPresentationJSON(
  presentation: Presentation,
  db: VeloFrameDB,
): Promise<void> {
  const referencedIds = new Set<string>();
  for (const slide of presentation.slides) {
    for (const node of slide.nodes) {
      if (node.type === 'image') referencedIds.add(node.assetId);
    }
  }

  const assets: AssetRecord[] = [];
  for (const assetId of referencedIds) {
    const rec = await db.getAsset(assetId);
    if (rec) assets.push(rec);
  }

  const payload = {
    format: 'veloframe-deck-v1',
    exportedAt: new Date().toISOString(),
    presentation,
    assets,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${safeFilename(presentation.title)}.veloframe.json`);
}

export async function exportSlidePNG(
  slide: Slide,
  title: string,
  slideNumber: number,
  imageCache: ImageCache,
  scale = 2,
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = SLIDE_WIDTH * scale;
  canvas.height = SLIDE_HEIGHT * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  renderSlideToCanvas(ctx, slide, imageCache, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (blob) {
    triggerDownload(blob, `${safeFilename(title)}-slide-${slideNumber}.png`);
  }
}

export async function exportSlideSVG(
  slide: Slide,
  title: string,
  slideNumber: number,
  imageCache: ImageCache,
  db: VeloFrameDB,
): Promise<void> {
  const defs: string[] = [];
  const body: string[] = [];

  if (slide.background.type === 'gradient' && slide.background.gradientEnd) {
    const angle = slide.background.gradientAngle ?? 135;
    defs.push(
      `<linearGradient id="slideBgGrad" gradientTransform="rotate(${angle} 0.5 0.5)">` +
        `<stop offset="0%" stop-color="${escapeXml(slide.background.color)}"/>` +
        `<stop offset="100%" stop-color="${escapeXml(slide.background.gradientEnd)}"/>` +
        `</linearGradient>`,
    );
    body.push(`<rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#slideBgGrad)"/>`);
  } else {
    body.push(
      `<rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="${escapeXml(slide.background.color)}"/>`,
    );
  }

  for (let i = 0; i < slide.nodes.length; i++) {
    const node = slide.nodes[i];
    const svgEl = await serializeNodeToSVG(node, i, defs, imageCache, db);
    if (svgEl) body.push(svgEl);
  }

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}">\n` +
    `<defs>${defs.join('\n')}</defs>\n` +
    `${body.join('\n')}\n` +
    `</svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(blob, `${safeFilename(title)}-slide-${slideNumber}.svg`);
}

async function serializeNodeToSVG(
  node: SceneNode,
  index: number,
  defs: string[],
  imageCache: ImageCache,
  db: VeloFrameDB,
): Promise<string> {
  const cx = node.x + node.width * 0.5;
  const cy = node.y + node.height * 0.5;
  const transform =
    node.rotation !== 0 ? ` transform="rotate(${node.rotation} ${cx} ${cy})"` : '';
  const opacity = node.opacity < 1 ? ` opacity="${node.opacity}"` : '';

  if (node.type === 'rect') {
    const r = node as RectNode;
    return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${r.cornerRadius}" fill="${escapeXml(r.fill)}" stroke="${escapeXml(r.stroke)}" stroke-width="${r.strokeWidth}"${opacity}${transform}/>`;
  }

  if (node.type === 'ellipse') {
    const e = node as EllipseNode;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${e.width * 0.5}" ry="${e.height * 0.5}" fill="${escapeXml(e.fill)}" stroke="${escapeXml(e.stroke)}" stroke-width="${e.strokeWidth}"${opacity}${transform}/>`;
  }

  if (node.type === 'line' || node.type === 'arrow') {
    const ln = node as LineNode;
    const x1 = ln.x + ln.x1;
    const y1 = ln.y + ln.y1;
    const x2 = ln.x + ln.x2;
    const y2 = ln.y + ln.y2;
    const markerId = `arrow_${index}`;
    let markerAttrs = '';
    if (ln.arrowEnd || ln.arrowStart) {
      defs.push(
        `<marker id="${markerId}" markerWidth="10" markerHeight="10" refX="7" refY="3.5" orient="auto-start-reverse">` +
          `<polygon points="0 0, 10 3.5, 0 7" fill="${escapeXml(ln.stroke)}"/>` +
          `</marker>`,
      );
      if (ln.arrowEnd) markerAttrs += ` marker-end="url(#${markerId})"`;
      if (ln.arrowStart) markerAttrs += ` marker-start="url(#${markerId})"`;
    }
    const dash = ln.dashed ? ` stroke-dasharray="${ln.strokeWidth * 3} ${ln.strokeWidth * 2}"` : '';
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeXml(ln.stroke)}" stroke-width="${ln.strokeWidth}" stroke-linecap="round"${dash}${markerAttrs}${opacity}${transform}/>`;
  }

  if (node.type === 'text') {
    const t = node as TextNode;
    const lines = t.text.split('\n');
    const anchor = t.textAlign === 'center' ? 'middle' : t.textAlign === 'right' ? 'end' : 'start';
    const textX =
      t.textAlign === 'center'
        ? t.x + t.width * 0.5
        : t.textAlign === 'right'
          ? t.x + t.width - t.padding
          : t.x + t.padding;
    const linePx = t.fontSize * t.lineHeight;
    const tspans = lines
      .map(
        (line, idx) =>
          `<tspan x="${textX}" dy="${idx === 0 ? t.fontSize * 0.85 : linePx}">${escapeXml(line || ' ')}</tspan>`,
      )
      .join('');
    const bgRect =
      t.fill && t.fill !== 'transparent'
        ? `<rect x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}" rx="${t.cornerRadius}" fill="${escapeXml(t.fill)}" stroke="${escapeXml(t.stroke)}" stroke-width="${t.strokeWidth}"/>`
        : '';
    return `<g${opacity}${transform}>${bgRect}<text x="${textX}" y="${t.y + t.padding}" fill="${escapeXml(t.color)}" font-family="${escapeXml(t.fontFamily)}" font-size="${t.fontSize}" font-weight="${t.fontWeight}" font-style="${t.fontStyle}" text-anchor="${anchor}" letter-spacing="${t.letterSpacing}">${tspans}</text></g>`;
  }

  if (node.type === 'image') {
    const img = node as ImageNode;
    let href = imageCache.getDataUrl(img.assetId);
    if (!href) {
      const rec = await db.getAsset(img.assetId);
      href = rec?.dataUrl;
    }
    if (!href) return '';
    const clipId = `img_clip_${index}`;
    defs.push(
      `<clipPath id="${clipId}"><rect x="${img.x}" y="${img.y}" width="${img.width}" height="${img.height}" rx="${img.cornerRadius}"/></clipPath>`,
    );
    const par = img.objectFit === 'fill' ? 'none' : img.objectFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
    return `<image x="${img.x}" y="${img.y}" width="${img.width}" height="${img.height}" href="${href}" preserveAspectRatio="${par}" clip-path="url(#${clipId})"${opacity}${transform}/>`;
  }

  return '';
}

/**
 * Zero-dependency, standards-compliant PDF 1.4 multi-page slide exporter.
 * Renders each slide at 1920x1080 into high-quality JPEG XObjects and writes
 * a valid cross-referenced binary PDF document (16:9 widescreen 960x540 pt).
 */
export async function exportPresentationPDF(
  presentation: Presentation,
  imageCache: ImageCache,
): Promise<void> {
  const pageWidthPt = 960;
  const pageHeightPt = 540;
  const renderW = 1920;
  const renderH = 1080;

  const canvas = document.createElement('canvas');
  canvas.width = renderW;
  canvas.height = renderH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const jpegPages: Uint8Array[] = [];
  for (let i = 0; i < presentation.slides.length; i++) {
    renderSlideToCanvas(ctx, presentation.slides[i], imageCache, renderW, renderH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let b = 0; b < binary.length; b++) {
      bytes[b] = binary.charCodeAt(b);
    }
    jpegPages.push(bytes);
  }

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // object 0
  let byteLength = 0;

  const pushStr = (s: string) => {
    const arr = encoder.encode(s);
    chunks.push(arr);
    byteLength += arr.length;
  };
  const pushBytes = (arr: Uint8Array) => {
    chunks.push(arr);
    byteLength += arr.length;
  };

  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const pageCount = jpegPages.length;
  // Object layout:
  // 1: Catalog
  // 2: Pages
  // For each page i (0..N-1):
  //   pageObj = 3 + i*3
  //   imgObj  = 4 + i*3
  //   cntObj  = 5 + i*3
  const pageKids: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    pageKids.push(`${3 + i * 3} 0 R`);
  }

  // Obj 1: Catalog
  offsets.push(byteLength);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets.push(byteLength);
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [${pageKids.join(' ')}] /Count ${pageCount} >>\nendobj\n`);

  for (let i = 0; i < pageCount; i++) {
    const pageObj = 3 + i * 3;
    const imgObj = 4 + i * 3;
    const cntObj = 5 + i * 3;
    const jpeg = jpegPages[i];

    // Page object
    offsets.push(byteLength);
    pushStr(
      `${pageObj} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt} ${pageHeightPt}] ` +
        `/Resources << /XObject << /Im0 ${imgObj} 0 R >> >> /Contents ${cntObj} 0 R >>\n` +
        `endobj\n`,
    );

    // Image XObject
    offsets.push(byteLength);
    pushStr(
      `${imgObj} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${renderW} /Height ${renderH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n` +
        `stream\n`,
    );
    pushBytes(jpeg);
    pushStr('\nendstream\nendobj\n');

    // Content stream
    const streamCmd = `q\n${pageWidthPt} 0 0 ${pageHeightPt} 0 0 cm\n/Im0 Do\nQ\n`;
    offsets.push(byteLength);
    pushStr(
      `${cntObj} 0 obj\n<< /Length ${streamCmd.length} >>\nstream\n${streamCmd}endstream\nendobj\n`,
    );
  }

  const xrefOffset = byteLength;
  pushStr(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  const blob = new Blob(chunks as BlobPart[], { type: 'application/pdf' });
  triggerDownload(blob, `${safeFilename(presentation.title)}.pdf`);
}
