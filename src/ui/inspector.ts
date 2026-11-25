import { THEMES } from '../model/themes';
import type {
  EllipseNode,
  ImageNode,
  LineNode,
  RectNode,
  SceneNode,
  SlideLayoutType,
  TextNode,
  TransitionType,
} from '../model/types';
import type { EditorStore } from '../state/store';

const FONT_FAMILIES = [
  { label: 'Plus Jakarta Sans', value: 'Plus Jakarta Sans, Inter, system-ui, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Georgia Serif', value: 'Georgia, serif' },
  { label: 'JetBrains Mono', value: 'JetBrains Mono, ui-monospace, monospace' },
];

const QUICK_SWATCHES = [
  '#141517',
  '#5C606B',
  '#FFFFFF',
  '#FAF9F6',
  '#0057FF',
  '#0F766E',
  '#C84B31',
  '#F59E0B',
  '#E11D48',
  '#0F172A',
];

const LAYOUT_OPTIONS: Array<{ id: SlideLayoutType; label: string }> = [
  { id: 'title', label: 'Title Cover' },
  { id: 'section', label: 'Section' },
  { id: 'title-body', label: 'Title & Body' },
  { id: 'two-column', label: 'Two Column' },
  { id: 'big-metric', label: 'Big Metric' },
  { id: 'blank', label: 'Blank' },
];

export class ContextualInspector {
  private container: HTMLElement;
  private store: EditorStore;

  constructor(container: HTMLElement, store: EditorStore) {
    this.container = container;
    this.store = store;
    this.render();
  }

  render(): void {
    const selected = this.store.getSelectedNodes();
    if (selected.length === 0) {
      this.renderSlideInspector();
    } else if (selected.length === 1) {
      this.renderNodeInspector(selected[0]);
    } else {
      this.renderMultiInspector(selected);
    }
  }

  private renderSlideInspector(): void {
    const slide = this.store.getActiveSlide();
    const bg = slide.background;

    const root = document.createElement('div');
    root.className = 'inspector-content';

    root.appendChild(this.makeSectionHeader('Slide', `Slide ${this.store.getActiveSlideIndex() + 1} of ${this.store.presentation.slides.length}`));

    // Background section
    const bgSection = this.makeGroup('Background');
    const typeRow = this.makeSegmented(
      [
        { label: 'Solid', value: 'solid' },
        { label: 'Gradient', value: 'gradient' },
      ],
      bg.type,
      (val) => {
        this.store.updateSlideBackground({
          type: val as 'solid' | 'gradient',
          color: bg.color,
          gradientEnd: bg.gradientEnd ?? '#181C24',
          gradientAngle: bg.gradientAngle ?? 135,
        });
        this.render();
      },
    );
    bgSection.appendChild(typeRow);

    const colorRow = document.createElement('div');
    colorRow.className = 'inspector-row';
    colorRow.appendChild(
      this.makeColorInput('Primary', bg.color, (color) => {
        this.store.updateSlideBackground({ ...bg, color });
      }),
    );
    if (bg.type === 'gradient') {
      colorRow.appendChild(
        this.makeColorInput('Secondary', bg.gradientEnd ?? '#181C24', (gradientEnd) => {
          this.store.updateSlideBackground({ ...bg, gradientEnd });
        }),
      );
    }
    bgSection.appendChild(colorRow);
    bgSection.appendChild(
      this.makeSwatchBar((hex) => {
        this.store.updateSlideBackground({ ...bg, color: hex });
        this.render();
      }),
    );
    root.appendChild(bgSection);

    // Transition section
    const transSection = this.makeGroup('Transition');
    const transSelect = document.createElement('select');
    transSelect.className = 'inspector-select';
    const transitions: Array<{ value: TransitionType; label: string }> = [
      { value: 'none', label: 'None (Instant)' },
      { value: 'fade', label: 'Crossfade (GPU)' },
      { value: 'slide', label: 'Slide Push (GPU)' },
      { value: 'morph', label: 'Magic Morph (ID Match)' },
    ];
    for (const t of transitions) {
      const opt = document.createElement('option');
      opt.value = t.value;
      opt.textContent = t.label;
      opt.selected = slide.transition === t.value;
      transSelect.appendChild(opt);
    }
    transSelect.addEventListener('change', () => {
      this.store.updateSlideTransition(transSelect.value as TransitionType);
    });
    transSection.appendChild(transSelect);

    transSection.appendChild(
      this.makeSlider('Duration', slide.transitionDurationMs, 150, 1200, 30, 'ms', (val) => {
        this.store.updateSlideTransition(slide.transition, val);
      }),
    );
    root.appendChild(transSection);

    // Quick Layouts
    const layoutSection = this.makeGroup('Slide Layout');
    const layoutGrid = document.createElement('div');
    layoutGrid.className = 'inspector-chip-grid';
    for (const item of LAYOUT_OPTIONS) {
      const btn = document.createElement('button');
      btn.className = 'inspector-chip';
      btn.textContent = item.label;
      btn.addEventListener('click', () => this.store.applyLayoutToActiveSlide(item.id));
      layoutGrid.appendChild(btn);
    }
    layoutSection.appendChild(layoutGrid);
    root.appendChild(layoutSection);

    // Deck Themes
    const themeSection = this.makeGroup('Deck Theme');
    const themeList = document.createElement('div');
    themeList.className = 'inspector-theme-list';
    for (const theme of THEMES) {
      const btn = document.createElement('button');
      btn.className =
        'inspector-theme-btn' + (this.store.presentation.themeId === theme.id ? ' active' : '');
      const dot = document.createElement('span');
      dot.className = 'theme-swatch-pair';
      dot.style.background = theme.background.color;
      dot.style.borderColor = theme.accent;
      const accentDot = document.createElement('span');
      accentDot.className = 'theme-swatch-accent';
      accentDot.style.background = theme.accent;
      dot.appendChild(accentDot);

      const label = document.createElement('span');
      label.textContent = theme.name;
      btn.appendChild(dot);
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        this.store.applyTheme(theme.id);
        this.render();
      });
      themeList.appendChild(btn);
    }
    themeSection.appendChild(themeList);
    root.appendChild(themeSection);

    // Speaker Notes
    const notesSection = this.makeGroup('Speaker Notes');
    const ta = document.createElement('textarea');
    ta.className = 'inspector-notes';
    ta.placeholder = 'Add presenter notes for this slide…';
    ta.value = slide.notes;
    ta.rows = 4;
    ta.addEventListener('input', () => {
      this.store.updateSlideNotes(ta.value);
    });
    notesSection.appendChild(ta);
    root.appendChild(notesSection);

    this.container.replaceChildren(root);
  }

  private renderMultiInspector(nodes: SceneNode[]): void {
    const root = document.createElement('div');
    root.className = 'inspector-content';
    root.appendChild(this.makeSectionHeader('Selection', `${nodes.length} objects selected`));

    const actions = this.makeGroup('Group & Layer');
    const btnRow = document.createElement('div');
    btnRow.className = 'inspector-btn-row';

    const allGrouped =
      nodes[0].groupId !== null && nodes.every((n) => n.groupId === nodes[0].groupId);
    btnRow.appendChild(
      this.makeButton(allGrouped ? 'Ungroup (⌘G)' : 'Group (⌘G)', () =>
        this.store.toggleGroupSelection(),
      ),
    );
    btnRow.appendChild(
      this.makeButton('Duplicate', () => this.store.duplicateSelection()),
    );
    actions.appendChild(btnRow);
    actions.appendChild(this.makeLayerButtons());
    root.appendChild(actions);

    const style = this.makeGroup('Shared Appearance');
    style.appendChild(
      this.makeSlider('Opacity', Math.round(nodes[0].opacity * 100), 5, 100, 1, '%', (v) => {
        this.store.updateSelectedNodes({ opacity: v / 100 }, 'Update opacity', 'opacity');
      }),
    );
    root.appendChild(style);

    this.container.replaceChildren(root);
  }

  private renderNodeInspector(node: SceneNode): void {
    const root = document.createElement('div');
    root.className = 'inspector-content';

    const typeTitle =
      node.type === 'rect'
        ? 'Rectangle'
        : node.type === 'ellipse'
          ? 'Ellipse'
          : node.type === 'text'
            ? 'Typography'
            : node.type === 'image'
              ? 'Image'
              : node.type === 'arrow'
                ? 'Arrow'
                : 'Line';

    root.appendChild(this.makeSectionHeader(typeTitle, node.name));

    // Layout & Transform
    const geom = this.makeGroup('Transform');
    const xyRow = document.createElement('div');
    xyRow.className = 'inspector-grid-2';
    xyRow.appendChild(
      this.makeNumberInput('X', Math.round(node.x), (val) =>
        this.store.updateSelectedNodes({ x: val }, 'Move X', 'pos_x'),
      ),
    );
    xyRow.appendChild(
      this.makeNumberInput('Y', Math.round(node.y), (val) =>
        this.store.updateSelectedNodes({ y: val }, 'Move Y', 'pos_y'),
      ),
    );
    xyRow.appendChild(
      this.makeNumberInput('W', Math.round(node.width), (val) =>
        this.store.updateSelectedNodes({ width: Math.max(12, val) }, 'Resize W', 'size_w'),
      ),
    );
    xyRow.appendChild(
      this.makeNumberInput('H', Math.round(node.height), (val) =>
        this.store.updateSelectedNodes({ height: Math.max(12, val) }, 'Resize H', 'size_h'),
      ),
    );
    geom.appendChild(xyRow);

    const rotRow = document.createElement('div');
    rotRow.className = 'inspector-grid-2';
    rotRow.appendChild(
      this.makeNumberInput('Angle °', Math.round(node.rotation), (val) =>
        this.store.updateSelectedNodes({ rotation: val % 360 }, 'Rotate', 'rot'),
      ),
    );
    if (node.type === 'rect' || node.type === 'text' || node.type === 'image') {
      rotRow.appendChild(
        this.makeNumberInput('Radius', Math.round((node as RectNode).cornerRadius), (val) =>
          this.store.updateSelectedNodes(
            { cornerRadius: Math.max(0, val) } as Partial<RectNode>,
            'Corner radius',
            'radius',
          ),
        ),
      );
    }
    geom.appendChild(rotRow);
    root.appendChild(geom);

    // Typography section for TextNode
    if (node.type === 'text') {
      const t = node as TextNode;
      const typo = this.makeGroup('Typography');

      const fontSelect = document.createElement('select');
      fontSelect.className = 'inspector-select';
      for (const f of FONT_FAMILIES) {
        const opt = document.createElement('option');
        opt.value = f.value;
        opt.textContent = f.label;
        opt.selected = t.fontFamily === f.value;
        fontSelect.appendChild(opt);
      }
      fontSelect.addEventListener('change', () => {
        this.store.updateSelectedNodes({ fontFamily: fontSelect.value } as Partial<TextNode>, 'Font');
      });
      typo.appendChild(fontSelect);

      const fontRow = document.createElement('div');
      fontRow.className = 'inspector-grid-2';
      fontRow.appendChild(
        this.makeNumberInput('Size', t.fontSize, (val) =>
          this.store.updateSelectedNodes(
            { fontSize: Math.max(10, Math.min(300, val)) } as Partial<TextNode>,
            'Font size',
            'font_size',
          ),
        ),
      );
      fontRow.appendChild(
        this.makeNumberInput('Weight', t.fontWeight, (val) =>
          this.store.updateSelectedNodes(
            { fontWeight: Math.max(300, Math.min(900, val)) } as Partial<TextNode>,
            'Font weight',
            'font_weight',
          ),
        ),
      );
      typo.appendChild(fontRow);

      typo.appendChild(
        this.makeColorInput('Text Color', t.color, (color) =>
          this.store.updateSelectedNodes({ color } as Partial<TextNode>, 'Text color', 'text_color'),
        ),
      );

      typo.appendChild(
        this.makeSegmented(
          [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
          t.textAlign,
          (val) =>
            this.store.updateSelectedNodes(
              { textAlign: val as 'left' | 'center' | 'right' } as Partial<TextNode>,
              'Text align',
            ),
        ),
      );
      root.appendChild(typo);
    }

    // Fill & Stroke
    const appearance = this.makeGroup('Fill & Stroke');
    if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'text') {
      const fillVal = (node as RectNode | EllipseNode | TextNode).fill;
      appearance.appendChild(
        this.makeColorInput(
          'Fill',
          fillVal === 'transparent' ? '#FFFFFF' : fillVal,
          (fill) => this.store.updateSelectedNodes({ fill } as Partial<RectNode>, 'Fill', 'fill'),
          fillVal === 'transparent',
          () =>
            this.store.updateSelectedNodes(
              { fill: 'transparent' } as Partial<RectNode>,
              'Clear fill',
            ),
        ),
      );
    }

    const strokeVal = (node as RectNode | LineNode | ImageNode).stroke;
    const strokeW = (node as RectNode | LineNode | ImageNode).strokeWidth;
    appearance.appendChild(
      this.makeColorInput(
        'Stroke',
        strokeVal === 'transparent' ? '#141517' : strokeVal,
        (stroke) =>
          this.store.updateSelectedNodes(
            { stroke, strokeWidth: Math.max(2, strokeW) } as Partial<RectNode>,
            'Stroke color',
            'stroke_color',
          ),
        strokeVal === 'transparent' || strokeW === 0,
        () =>
          this.store.updateSelectedNodes(
            { stroke: 'transparent', strokeWidth: 0 } as Partial<RectNode>,
            'Clear stroke',
          ),
      ),
    );

    appearance.appendChild(
      this.makeSlider('Stroke Width', strokeW, 0, 24, 1, 'px', (val) =>
        this.store.updateSelectedNodes(
          {
            strokeWidth: val,
            stroke: strokeVal === 'transparent' && val > 0 ? '#141517' : strokeVal,
          } as Partial<RectNode>,
          'Stroke width',
          'stroke_w',
        ),
      ),
    );

    appearance.appendChild(
      this.makeSlider('Opacity', Math.round(node.opacity * 100), 5, 100, 1, '%', (val) =>
        this.store.updateSelectedNodes({ opacity: val / 100 }, 'Opacity', 'opacity'),
      ),
    );
    root.appendChild(appearance);

    // Drop Shadow
    const shadowGroup = this.makeGroup('Drop Shadow');
    const toggleRow = document.createElement('label');
    toggleRow.className = 'inspector-toggle-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = node.shadow.enabled;
    cb.addEventListener('change', () => {
      this.store.updateSelectedNodes(
        { shadow: { ...node.shadow, enabled: cb.checked } },
        'Toggle shadow',
      );
      this.render();
    });
    const cbLabel = document.createElement('span');
    cbLabel.textContent = 'Enable Drop Shadow';
    toggleRow.appendChild(cb);
    toggleRow.appendChild(cbLabel);
    shadowGroup.appendChild(toggleRow);

    if (node.shadow.enabled) {
      shadowGroup.appendChild(
        this.makeSlider('Blur', node.shadow.blur, 0, 80, 2, 'px', (blur) =>
          this.store.updateSelectedNodes(
            { shadow: { ...node.shadow, blur } },
            'Shadow blur',
            'shadow_blur',
          ),
        ),
      );
      shadowGroup.appendChild(
        this.makeSlider('Offset Y', node.shadow.offsetY, -40, 60, 2, 'px', (offsetY) =>
          this.store.updateSelectedNodes(
            { shadow: { ...node.shadow, offsetY } },
            'Shadow Y',
            'shadow_y',
          ),
        ),
      );
    }
    root.appendChild(shadowGroup);

    // Layering & Actions
    const layerGroup = this.makeGroup('Arrange');
    layerGroup.appendChild(this.makeLayerButtons());
    const delBtn = this.makeButton('Delete Object', () => this.store.deleteSelectedNodes());
    delBtn.classList.add('danger');
    layerGroup.appendChild(delBtn);
    root.appendChild(layerGroup);

    this.container.replaceChildren(root);
  }

  private makeSectionHeader(title: string, subtitle: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'inspector-header';
    const h = document.createElement('div');
    h.className = 'inspector-title';
    h.textContent = title;
    const sub = document.createElement('div');
    sub.className = 'inspector-subtitle';
    sub.textContent = subtitle;
    el.appendChild(h);
    el.appendChild(sub);
    return el;
  }

  private makeGroup(label: string): HTMLElement {
    const sec = document.createElement('div');
    sec.className = 'inspector-section';
    const lbl = document.createElement('div');
    lbl.className = 'inspector-label';
    lbl.textContent = label;
    sec.appendChild(lbl);
    return sec;
  }

  private makeNumberInput(label: string, value: number, onChange: (val: number) => void): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'inspector-num-field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(value);
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (!Number.isNaN(parsed)) onChange(parsed);
    });
    wrap.appendChild(span);
    wrap.appendChild(input);
    return wrap;
  }

  private makeSlider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    unit: string,
    onChange: (val: number) => void,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'inspector-slider-field';
    const top = document.createElement('div');
    top.className = 'inspector-slider-top';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    const valSpan = document.createElement('span');
    valSpan.className = 'inspector-slider-val';
    valSpan.textContent = `${value}${unit}`;
    top.appendChild(lbl);
    top.appendChild(valSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const num = Number(input.value);
      valSpan.textContent = `${num}${unit}`;
      onChange(num);
    });

    wrap.appendChild(top);
    wrap.appendChild(input);
    return wrap;
  }

  private makeColorInput(
    label: string,
    hex: string,
    onChange: (hex: string) => void,
    isNone = false,
    onClear?: () => void,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'inspector-color-field';

    const lbl = document.createElement('span');
    lbl.className = 'inspector-color-lbl';
    lbl.textContent = label;

    const controls = document.createElement('div');
    controls.className = 'inspector-color-controls';

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'inspector-color-picker';
    picker.value = hex.startsWith('#') && hex.length === 7 ? hex : '#141517';
    picker.addEventListener('input', () => onChange(picker.value));

    const text = document.createElement('span');
    text.className = 'inspector-color-hex';
    text.textContent = isNone ? 'None' : picker.value.toUpperCase();
    picker.addEventListener('input', () => {
      text.textContent = picker.value.toUpperCase();
    });

    controls.appendChild(picker);
    controls.appendChild(text);

    if (onClear && !isNone) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'inspector-clear-btn';
      clearBtn.title = `Clear ${label}`;
      clearBtn.textContent = '×';
      clearBtn.addEventListener('click', () => {
        onClear();
        this.render();
      });
      controls.appendChild(clearBtn);
    }

    wrap.appendChild(lbl);
    wrap.appendChild(controls);
    return wrap;
  }

  private makeSwatchBar(onPick: (hex: string) => void): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'inspector-swatches';
    for (const hex of QUICK_SWATCHES) {
      const sw = document.createElement('button');
      sw.className = 'inspector-swatch';
      sw.style.background = hex;
      sw.title = hex;
      sw.addEventListener('click', () => onPick(hex));
      bar.appendChild(sw);
    }
    return bar;
  }

  private makeSegmented(
    options: Array<{ label: string; value: string }>,
    current: string,
    onChange: (val: string) => void,
  ): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'inspector-segmented';
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'inspector-seg-btn' + (opt.value === current ? ' active' : '');
      btn.textContent = opt.label;
      btn.addEventListener('click', () => onChange(opt.value));
      bar.appendChild(btn);
    }
    return bar;
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'inspector-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private makeLayerButtons(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'inspector-grid-2';
    row.appendChild(this.makeButton('Bring Forward', () => this.store.reorderLayer('forward')));
    row.appendChild(this.makeButton('Send Backward', () => this.store.reorderLayer('backward')));
    row.appendChild(this.makeButton('To Front', () => this.store.reorderLayer('front')));
    row.appendChild(this.makeButton('To Back', () => this.store.reorderLayer('back')));
    return row;
  }
}
