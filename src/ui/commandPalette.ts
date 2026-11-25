export interface PaletteCommand {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

/**
 * Keyboard-driven Command Palette (Cmd/Ctrl+K) with instant fuzzy filtering
 * for themes, layouts, tools, slide navigation, exports, and performance benchmarks.
 */
export class CommandPalette {
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private listEl: HTMLElement;
  private getCommands: () => PaletteCommand[];
  private filtered: PaletteCommand[] = [];
  private activeIdx = 0;
  private isOpen = false;

  constructor(getCommands: () => PaletteCommand[]) {
    this.getCommands = getCommands;

    this.overlay = document.createElement('div');
    this.overlay.className = 'palette-backdrop';
    this.overlay.style.display = 'none';

    const dialog = document.createElement('div');
    dialog.className = 'palette-dialog';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'palette-search-wrap';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'palette-input';
    this.input.placeholder = 'Type a command, theme, layout, or export…';

    const escBadge = document.createElement('kbd');
    escBadge.className = 'palette-kbd';
    escBadge.textContent = 'ESC';

    searchWrap.appendChild(this.input);
    searchWrap.appendChild(escBadge);

    this.listEl = document.createElement('div');
    this.listEl.className = 'palette-list';

    dialog.appendChild(searchWrap);
    dialog.appendChild(this.listEl);
    this.overlay.appendChild(dialog);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.input.addEventListener('input', () => {
      this.activeIdx = 0;
      this.refresh();
    });
    this.input.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  open(): void {
    this.isOpen = true;
    this.overlay.style.display = 'flex';
    this.input.value = '';
    this.activeIdx = 0;
    this.refresh();
    this.input.focus();
  }

  close(): void {
    this.isOpen = false;
    this.overlay.style.display = 'none';
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private refresh(): void {
    const query = this.input.value.trim().toLowerCase();
    const all = this.getCommands();

    if (!query) {
      this.filtered = all;
    } else {
      const terms = query.split(/\s+/);
      this.filtered = all.filter((cmd) => {
        const hay = `${cmd.title} ${cmd.category} ${cmd.keywords ?? ''}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }

    if (this.activeIdx >= this.filtered.length) {
      this.activeIdx = Math.max(0, this.filtered.length - 1);
    }

    const frag = document.createDocumentFragment();
    if (this.filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = 'No matching commands.';
      frag.appendChild(empty);
    } else {
      this.filtered.forEach((cmd, idx) => {
        const row = document.createElement('button');
        row.className = 'palette-item' + (idx === this.activeIdx ? ' active' : '');

        const left = document.createElement('div');
        left.className = 'palette-item-left';
        const cat = document.createElement('span');
        cat.className = 'palette-cat';
        cat.textContent = cmd.category;
        const title = document.createElement('span');
        title.className = 'palette-title';
        title.textContent = cmd.title;
        left.appendChild(cat);
        left.appendChild(title);
        row.appendChild(left);

        if (cmd.shortcut) {
          const kbd = document.createElement('kbd');
          kbd.className = 'palette-kbd';
          kbd.textContent = cmd.shortcut;
          row.appendChild(kbd);
        }

        row.addEventListener('mouseenter', () => {
          this.activeIdx = idx;
          this.updateActiveHighlight();
        });
        row.addEventListener('click', () => {
          this.close();
          cmd.run();
        });
        frag.appendChild(row);
      });
    }
    this.listEl.replaceChildren(frag);
  }

  private updateActiveHighlight(): void {
    const items = this.listEl.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === this.activeIdx);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.filtered.length > 0) {
        this.activeIdx = (this.activeIdx + 1) % this.filtered.length;
        this.updateActiveHighlight();
        this.listEl.children[this.activeIdx]?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.filtered.length > 0) {
        this.activeIdx = (this.activeIdx - 1 + this.filtered.length) % this.filtered.length;
        this.updateActiveHighlight();
        this.listEl.children[this.activeIdx]?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = this.filtered[this.activeIdx];
      if (target) {
        this.close();
        target.run();
      }
    }
  }
}
