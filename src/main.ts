import './style.css';

import { ImageCache } from './engine/imageCache';
import { SceneRenderer } from './engine/renderer';
import { Viewport } from './engine/viewport';
import { THEMES, createInitialPresentation } from './model/themes';
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type AssetRecord,
  type Presentation,
  type SlideLayoutType,
  type ToolType,
} from './model/types';
import { EditorStore } from './state/store';
import { VeloFrameDB } from './storage/db';
import {
  exportPresentationJSON,
  exportPresentationPDF,
  exportSlidePNG,
  exportSlideSVG,
} from './storage/exporter';
import { CanvasController } from './ui/canvasController';
import { CommandPalette, type PaletteCommand } from './ui/commandPalette';
import { VirtualizedFilmstrip } from './ui/filmstrip';
import { ContextualInspector } from './ui/inspector';
import { PresenterMode } from './ui/presenter';
import { UpdaterBanner } from './ui/updaterBanner';

const TOOL_SPECS: Array<{ id: ToolType; label: string; key: string; svg: string }> = [
  {
    id: 'select',
    label: 'Select',
    key: 'V',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4l7.2 16 2.6-6.2L20 11.2 4 4z"/></svg>',
  },
  {
    id: 'hand',
    label: 'Pan',
    key: 'H',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 11V6a2 2 0 0 0-4 0v4M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9l-1.5-1.5a2 2 0 0 0-2.8 2.8L7 21h9a4 4 0 0 0 4-4v-6a2 2 0 0 0-4 0"/></svg>',
  },
  {
    id: 'text',
    label: 'Text',
    key: 'T',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7V5h16v2M12 5v14M9 19h6"/></svg>',
  },
  {
    id: 'rect',
    label: 'Rect',
    key: 'R',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="5" width="16" height="14" rx="2.5"/></svg>',
  },
  {
    id: 'ellipse',
    label: 'Circle',
    key: 'O',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="8"/></svg>',
  },
  {
    id: 'line',
    label: 'Line',
    key: 'L',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 19L19 5"/></svg>',
  },
  {
    id: 'arrow',
    label: 'Arrow',
    key: 'A',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 19L19 5M12 5h7v7"/></svg>',
  },
];

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const db = new VeloFrameDB();
  let initialDeck: Presentation;
  try {
    const decks = await db.listPresentations();
    if (decks.length > 0 && decks[0].slides.length > 0) {
      initialDeck = decks[0];
    } else {
      initialDeck = createInitialPresentation();
      await db.savePresentation(initialDeck);
    }
  } catch {
    initialDeck = createInitialPresentation();
  }

  const store = new EditorStore(initialDeck);
  const viewport = new Viewport();

  let frameScheduled = false;
  let renderer: SceneRenderer;
  let controller: CanvasController;
  let filmstrip: VirtualizedFilmstrip;
  let inspector: ContextualInspector;

  const requestFrame = () => {
    if (frameScheduled) return;
    frameScheduled = true;
    requestAnimationFrame(() => {
      frameScheduled = false;
      renderNow();
    });
  };

  const imageCache = new ImageCache(
    (assetId) => db.getAsset(assetId),
    () => {
      renderer.invalidateFull();
      filmstrip.invalidateSlide();
      requestFrame();
    },
  );

  // Build application DOM shell
  app.innerHTML = `
    <div class="vf-shell">
      <header class="vf-topbar">
        <div class="vf-topbar-left">
          <div class="vf-brand">
            <div class="vf-logo-mark" aria-hidden="true">V</div>
            <input id="deck-title-input" class="vf-title-input" type="text" aria-label="Presentation title" />
          </div>
          <span id="save-status-pill" class="vf-save-pill saved">Saved locally</span>
        </div>

        <div class="vf-topbar-center">
          <div id="tool-strip" class="vf-tool-group" role="toolbar" aria-label="Drawing tools"></div>
          <button id="btn-insert-image" class="vf-icon-btn" title="Insert Image">Image</button>
          <input id="image-file-input" type="file" accept="image/*" multiple hidden />
          <button id="btn-undo" class="vf-icon-btn" title="Undo (⌘Z)">Undo</button>
          <button id="btn-redo" class="vf-icon-btn" title="Redo (⌘⇧Z)">Redo</button>
        </div>

        <div class="vf-topbar-right">
          <button id="btn-command-palette" class="vf-cmd-trigger" title="Open Command Palette">
            <span>Commands</span>
            <kbd class="vf-kbd">⌘K</kbd>
          </button>

          <div class="vf-dropdown">
            <button id="btn-export-menu" class="vf-icon-btn">Export ▾</button>
            <div id="export-menu" class="vf-dropdown-menu">
              <button class="vf-dropdown-item" data-export="pdf">Export Deck as PDF</button>
              <button class="vf-dropdown-item" data-export="png">Export Slide as 2× PNG</button>
              <button class="vf-dropdown-item" data-export="svg">Export Slide as SVG</button>
              <div class="vf-dropdown-sep"></div>
              <button class="vf-dropdown-item" data-export="json">Save Backup (.veloframe.json)</button>
              <button class="vf-dropdown-item" data-export="import-json">Import Backup JSON…</button>
              <div class="vf-dropdown-sep"></div>
              <button class="vf-dropdown-item" data-export="check-updates">Check for Updates (GitHub)</button>
              <button class="vf-dropdown-item" data-export="new-deck">Reset Demo Presentation</button>
            </div>
            <input id="json-import-input" type="file" accept=".json,application/json" hidden />
          </div>

          <button id="btn-present" class="vf-primary-btn" title="Start Presenter Mode (P)">▶ Present</button>
        </div>
      </header>

      <main class="vf-workspace">
        <aside class="vf-sidebar">
          <div class="vf-sidebar-head">
            <span id="slide-count-label" class="vf-sidebar-title">Slides</span>
            <button id="btn-add-slide" class="vf-add-slide-btn" title="New Slide (⌘M)">+ Slide</button>
          </div>
          <div id="filmstrip-host" class="vf-filmstrip-host"></div>
        </aside>

        <section id="stage-host" class="vf-stage">
          <canvas id="scene-canvas" class="vf-canvas"></canvas>
          <div class="vf-stage-hud">
            <div class="vf-hud-pill" id="perf-hud">
              <span class="vf-perf-dot"></span>
              <span id="perf-text">120 fps · 0.8ms</span>
            </div>
            <div class="vf-hud-pill">
              <button id="btn-zoom-out" class="vf-hud-btn" title="Zoom Out">−</button>
              <button id="btn-zoom-fit" class="vf-hud-btn" title="Fit Slide to Screen">50%</button>
              <button id="btn-zoom-in" class="vf-hud-btn" title="Zoom In">+</button>
            </div>
          </div>
        </section>

        <aside id="inspector-host" class="vf-inspector"></aside>
      </main>
    </div>
    <div id="vf-toast" class="vf-toast"></div>
  `;

  const titleInput = document.getElementById('deck-title-input') as HTMLInputElement;
  const savePill = document.getElementById('save-status-pill') as HTMLElement;
  const toolStrip = document.getElementById('tool-strip') as HTMLElement;
  const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
  const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;
  const insertImgBtn = document.getElementById('btn-insert-image') as HTMLButtonElement;
  const imgFileInput = document.getElementById('image-file-input') as HTMLInputElement;
  const cmdBtn = document.getElementById('btn-command-palette') as HTMLButtonElement;
  const exportMenuBtn = document.getElementById('btn-export-menu') as HTMLButtonElement;
  const exportMenu = document.getElementById('export-menu') as HTMLElement;
  const jsonImportInput = document.getElementById('json-import-input') as HTMLInputElement;
  const presentBtn = document.getElementById('btn-present') as HTMLButtonElement;
  const slideCountLabel = document.getElementById('slide-count-label') as HTMLElement;
  const addSlideBtn = document.getElementById('btn-add-slide') as HTMLButtonElement;
  const filmstripHost = document.getElementById('filmstrip-host') as HTMLElement;
  const stageHost = document.getElementById('stage-host') as HTMLElement;
  const sceneCanvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
  const inspectorHost = document.getElementById('inspector-host') as HTMLElement;
  const perfText = document.getElementById('perf-text') as HTMLElement;
  const zoomOutBtn = document.getElementById('btn-zoom-out') as HTMLButtonElement;
  const zoomFitBtn = document.getElementById('btn-zoom-fit') as HTMLButtonElement;
  const zoomInBtn = document.getElementById('btn-zoom-in') as HTMLButtonElement;
  const toastEl = document.getElementById('vf-toast') as HTMLElement;

  let toastTimer = 0;
  const showToast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('visible'), 2200);
  };

  // Build tool strip buttons
  const toolButtons = new Map<ToolType, HTMLButtonElement>();
  for (const spec of TOOL_SPECS) {
    const btn = document.createElement('button');
    btn.className = 'vf-tool-btn' + (spec.id === store.activeTool ? ' active' : '');
    btn.title = `${spec.label} (${spec.key})`;
    btn.innerHTML = `${spec.svg}<span>${spec.label}</span>`;
    btn.addEventListener('click', () => store.setTool(spec.id));
    toolStrip.appendChild(btn);
    toolButtons.set(spec.id, btn);
  }

  // Initialize core engines & UI modules
  renderer = new SceneRenderer(sceneCanvas, imageCache, store.rtree);
  controller = new CanvasController(
    stageHost,
    sceneCanvas,
    store,
    viewport,
    db,
    imageCache,
    requestFrame,
  );
  filmstrip = new VirtualizedFilmstrip(filmstripHost, store, imageCache);
  inspector = new ContextualInspector(inspectorHost, store);
  const presenter = new PresenterMode(store, imageCache);
  const updaterBanner = new UpdaterBanner(showToast);

  // Render function
  const renderNow = () => {
    controller.syncSelectionFromStore();
    renderer.render(store.getActiveSlide(), viewport, controller.overlay);
    zoomFitBtn.textContent = `${Math.round(viewport.zoom * 100)}%`;
    const m = renderer.metrics;
    perfText.textContent = `${m.fps} fps · ${m.lastFrameMs.toFixed(1)}ms · ${m.totalNodeCount} nodes`;
  };

  // Resize observer for crisp HiDPI canvas sizing
  const syncViewportSize = (fit = false) => {
    const rect = stageHost.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    viewport.resize(rect.width, rect.height);
    renderer.syncSize(rect.width, rect.height);
    if (fit) viewport.fitToSlide(SLIDE_WIDTH, SLIDE_HEIGHT, 56);
    requestFrame();
  };

  const ro = new ResizeObserver(() => syncViewportSize(false));
  ro.observe(stageHost);
  syncViewportSize(true);

  // Debounced IndexedDB autosave
  let saveTimer = 0;
  const scheduleAutosave = () => {
    store.setSaveStatus('saving');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      try {
        await db.savePresentation(store.presentation);
        store.setSaveStatus('saved');
      } catch {
        store.setSaveStatus('offline');
      }
    }, 180);
  };

  window.addEventListener('beforeunload', () => {
    void db.savePresentation(store.presentation);
  });

  // Store subscriptions
  const syncHeaderChrome = () => {
    titleInput.value = store.presentation.title;
    slideCountLabel.textContent = `Slides (${store.presentation.slides.length})`;
    undoBtn.disabled = !store.history.canUndo();
    redoBtn.disabled = !store.history.canRedo();
    for (const [id, btn] of toolButtons) {
      btn.classList.toggle('active', id === store.activeTool);
    }
    savePill.textContent =
      store.saveStatus === 'saving'
        ? 'Saving…'
        : store.saveStatus === 'offline'
          ? 'Local memory'
          : 'Saved locally';
    savePill.classList.toggle('saved', store.saveStatus === 'saved');
  };

  syncHeaderChrome();

  store.subscribe((ev) => {
    if (ev.type === 'scene') {
      if (ev.fullRepaint || !ev.dirtyRects || ev.dirtyRects.length === 0) {
        renderer.invalidateFull();
      } else {
        for (const r of ev.dirtyRects) renderer.invalidateRect(r);
      }
      if (ev.slideId) filmstrip.invalidateSlide(ev.slideId);
      requestFrame();
    } else if (ev.type === 'selection') {
      inspector.render();
      requestFrame();
    } else if (ev.type === 'slides') {
      if (ev.fullRepaint) filmstrip.invalidateSlide();
      else if (ev.slideId) filmstrip.invalidateSlide(ev.slideId);
      else filmstrip.scheduleRender();
      syncHeaderChrome();
      inspector.render();
      scheduleAutosave();
    } else if (ev.type === 'tool' || ev.type === 'history' || ev.type === 'save-status') {
      syncHeaderChrome();
    }
  });

  // Command Palette setup
  const getPaletteCommands = (): PaletteCommand[] => {
    const cmds: PaletteCommand[] = [
      {
        id: 'present',
        title: 'Start Hardware-Accelerated Presenter Mode',
        category: 'Present',
        shortcut: 'P',
        keywords: 'fullscreen slideshow laser morph',
        run: () => presenter.start(),
      },
      {
        id: 'add-slide',
        title: 'Add New Slide',
        category: 'Slide',
        shortcut: '⌘M',
        run: () => store.addSlide('title-body'),
      },
      {
        id: 'dup-slide',
        title: 'Duplicate Current Slide',
        category: 'Slide',
        run: () => store.duplicateSlide(),
      },
      {
        id: 'fit-zoom',
        title: 'Fit Slide to Screen',
        category: 'View',
        shortcut: '0',
        run: () => {
          viewport.fitToSlide(SLIDE_WIDTH, SLIDE_HEIGHT, 56);
          requestFrame();
        },
      },
      {
        id: 'group-toggle',
        title: 'Group / Ungroup Selected Objects',
        category: 'Arrange',
        shortcut: '⌘G',
        run: () => store.toggleGroupSelection(),
      },
      {
        id: 'export-pdf',
        title: 'Export Full Deck as PDF',
        category: 'Export',
        run: async () => {
          showToast('Generating multi-page PDF…');
          await exportPresentationPDF(store.presentation, imageCache);
          showToast('PDF exported');
        },
      },
      {
        id: 'export-png',
        title: 'Export Current Slide as 2× PNG',
        category: 'Export',
        run: async () => {
          await exportSlidePNG(
            store.getActiveSlide(),
            store.presentation.title,
            store.getActiveSlideIndex() + 1,
            imageCache,
          );
          showToast('PNG exported');
        },
      },
      {
        id: 'export-svg',
        title: 'Export Current Slide as Vector SVG',
        category: 'Export',
        run: async () => {
          await exportSlideSVG(
            store.getActiveSlide(),
            store.presentation.title,
            store.getActiveSlideIndex() + 1,
            imageCache,
            db,
          );
          showToast('SVG exported');
        },
      },
      {
        id: 'export-json',
        title: 'Export Local Backup (.veloframe.json)',
        category: 'Export',
        run: async () => {
          await exportPresentationJSON(store.presentation, db);
          showToast('JSON backup saved');
        },
      },
      {
        id: 'check-updates',
        title: 'Check for Desktop Updates (GitHub Releases)',
        category: 'App',
        keywords: 'update auto-updater github release exe version',
        run: () => {
          void updaterBanner.checkForUpdates();
        },
      },
      {
        id: 'benchmark-100',
        title: 'Benchmark: Append 100 Slides (Test Virtualized Filmstrip)',
        category: 'Perf',
        keywords: 'stress test 100 slides fps speed',
        run: () => {
          store.appendBenchmarkSlides(100);
          showToast(`Deck now has ${store.presentation.slides.length} slides — scroll filmstrip!`);
        },
      },
    ];

    // Theme commands
    for (const t of THEMES) {
      cmds.push({
        id: `theme-${t.id}`,
        title: `Apply Theme: ${t.name}`,
        category: 'Theme',
        run: () => {
          store.applyTheme(t.id);
          showToast(`Applied ${t.name} theme`);
        },
      });
    }

    // Layout commands
    const layouts: Array<{ id: SlideLayoutType; label: string }> = [
      { id: 'title', label: 'Title Cover' },
      { id: 'section', label: 'Section Header' },
      { id: 'title-body', label: 'Title & Body' },
      { id: 'two-column', label: 'Two Column' },
      { id: 'big-metric', label: 'Big Metric' },
      { id: 'blank', label: 'Blank Canvas' },
    ];
    for (const l of layouts) {
      cmds.push({
        id: `layout-${l.id}`,
        title: `Apply Layout: ${l.label}`,
        category: 'Layout',
        run: () => store.applyLayoutToActiveSlide(l.id),
      });
    }

    // Tool shortcuts
    for (const spec of TOOL_SPECS) {
      cmds.push({
        id: `tool-${spec.id}`,
        title: `Select Tool: ${spec.label}`,
        category: 'Tool',
        shortcut: spec.key,
        run: () => store.setTool(spec.id),
      });
    }

    return cmds;
  };

  const palette = new CommandPalette(getPaletteCommands);

  // Header & HUD event bindings
  titleInput.addEventListener('change', () => store.updateTitle(titleInput.value));
  undoBtn.addEventListener('click', () => store.history.undo());
  redoBtn.addEventListener('click', () => store.history.redo());
  cmdBtn.addEventListener('click', () => palette.open());
  addSlideBtn.addEventListener('click', () => {
    store.addSlide('title-body');
    filmstrip.scrollToActiveSlide();
  });
  presentBtn.addEventListener('click', () => presenter.start());

  insertImgBtn.addEventListener('click', () => imgFileInput.click());
  imgFileInput.addEventListener('change', () => {
    if (imgFileInput.files?.length) {
      void controller.importImageFiles(imgFileInput.files, {
        x: SLIDE_WIDTH * 0.5,
        y: SLIDE_HEIGHT * 0.5,
      });
      imgFileInput.value = '';
    }
  });

  zoomInBtn.addEventListener('click', () => {
    viewport.setZoomCentered(viewport.zoom * 1.2);
    requestFrame();
  });
  zoomOutBtn.addEventListener('click', () => {
    viewport.setZoomCentered(viewport.zoom / 1.2);
    requestFrame();
  });
  zoomFitBtn.addEventListener('click', () => {
    viewport.fitToSlide(SLIDE_WIDTH, SLIDE_HEIGHT, 56);
    requestFrame();
  });

  exportMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('open');
  });
  window.addEventListener('click', () => exportMenu.classList.remove('open'));

  exportMenu.addEventListener('click', async (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-export]');
    if (!target) return;
    exportMenu.classList.remove('open');
    const kind = target.dataset.export;
    if (kind === 'pdf') {
      showToast('Generating multi-page PDF…');
      await exportPresentationPDF(store.presentation, imageCache);
      showToast('PDF exported');
    } else if (kind === 'png') {
      await exportSlidePNG(
        store.getActiveSlide(),
        store.presentation.title,
        store.getActiveSlideIndex() + 1,
        imageCache,
      );
      showToast('2× PNG exported');
    } else if (kind === 'svg') {
      await exportSlideSVG(
        store.getActiveSlide(),
        store.presentation.title,
        store.getActiveSlideIndex() + 1,
        imageCache,
        db,
      );
      showToast('Vector SVG exported');
    } else if (kind === 'json') {
      await exportPresentationJSON(store.presentation, db);
      showToast('JSON backup saved');
    } else if (kind === 'import-json') {
      jsonImportInput.click();
    } else if (kind === 'check-updates') {
      await updaterBanner.checkForUpdates();
    } else if (kind === 'new-deck') {
      const fresh = createInitialPresentation();
      store.setPresentation(fresh);
      await db.savePresentation(fresh);
      viewport.fitToSlide(SLIDE_WIDTH, SLIDE_HEIGHT, 56);
      showToast('Demo deck restored');
    }
  });

  jsonImportInput.addEventListener('change', async () => {
    const file = jsonImportInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        presentation?: Presentation;
        assets?: AssetRecord[];
      };
      if (!parsed.presentation || !Array.isArray(parsed.presentation.slides)) {
        showToast('Invalid VeloFrame JSON file');
        return;
      }
      if (Array.isArray(parsed.assets)) {
        for (const asset of parsed.assets) {
          await db.saveAsset(asset);
          imageCache.registerDataUrl(asset.id, asset.dataUrl);
        }
      }
      store.setPresentation(parsed.presentation);
      await db.savePresentation(parsed.presentation);
      viewport.fitToSlide(SLIDE_WIDTH, SLIDE_HEIGHT, 56);
      showToast(`Imported "${parsed.presentation.title}"`);
    } catch {
      showToast('Failed to parse JSON file');
    } finally {
      jsonImportInput.value = '';
    }
  });

  // Global keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const isInput =
      e.target instanceof HTMLElement &&
      (e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT' ||
        e.target.isContentEditable);

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette.toggle();
      return;
    }

    if (isInput) return;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.history.redo();
      else store.history.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.history.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      store.copySelection();
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      if (store.selectedIds.size > 0 || true) {
        store.pasteClipboard();
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      store.duplicateSelection();
      return;
    }
    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      store.toggleGroupSelection();
      return;
    }
    if (mod && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      store.addSlide('title-body');
      filmstrip.scrollToActiveSlide();
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      store.selectNodes(
        store.getActiveSlide().nodes.map((n) => n.id),
        false,
      );
      return;
    }

    // Delete selected objects
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.selectedIds.size > 0) {
        e.preventDefault();
        store.deleteSelectedNodes();
      }
      return;
    }

    // Nudge selected objects with arrow keys
    if (
      store.selectedIds.size > 0 &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const selected = store.getSelectedNodes();
      const before = selected.map((n) => ({ ...n, shadow: { ...n.shadow } }));
      const updates = new Map(selected.map((n) => [n.id, { x: n.x + dx, y: n.y + dy }]));
      store.applyLiveNodeUpdates(updates);
      const after = store.getSelectedNodes().map((n) => ({ ...n, shadow: { ...n.shadow } }));
      store.commitNodeSnapshots('Nudge objects', before, after, 'nudge');
      return;
    }

    // Layering shortcuts
    if (e.key === ']') {
      e.preventDefault();
      store.reorderLayer(e.shiftKey ? 'front' : 'forward');
      return;
    }
    if (e.key === '[') {
      e.preventDefault();
      store.reorderLayer(e.shiftKey ? 'back' : 'backward');
      return;
    }

    // Single-key tool & view shortcuts
    const k = e.key.toLowerCase();
    if (k === 'v') store.setTool('select');
    else if (k === 'h') store.setTool('hand');
    else if (k === 't') store.setTool('text');
    else if (k === 'r') store.setTool('rect');
    else if (k === 'o') store.setTool('ellipse');
    else if (k === 'l') store.setTool('line');
    else if (k === 'a') store.setTool('arrow');
    else if (k === 'p') presenter.start();
    else if (k === '0') {
      viewport.fitToSlide(SLIDE_WIDTH, SLIDE_HEIGHT, 56);
      requestFrame();
    } else if (k === '=' || k === '+') {
      viewport.setZoomCentered(viewport.zoom * 1.15);
      requestFrame();
    } else if (k === '-') {
      viewport.setZoomCentered(viewport.zoom / 1.15);
      requestFrame();
    } else if (e.key === 'PageDown') {
      const slides = store.presentation.slides;
      const next = Math.min(slides.length - 1, store.getActiveSlideIndex() + 1);
      store.setActiveSlide(slides[next].id);
      filmstrip.scrollToActiveSlide();
    } else if (e.key === 'PageUp') {
      const slides = store.presentation.slides;
      const prev = Math.max(0, store.getActiveSlideIndex() - 1);
      store.setActiveSlide(slides[prev].id);
      filmstrip.scrollToActiveSlide();
    }
  });
}

void bootstrap();
