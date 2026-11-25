export interface HistoryCommand {
  label: string;
  coalesceKey?: string;
  timestamp: number;
  execute(): void;
  undo(): void;
}

/**
 * Command-pattern undo/redo stack with time-window coalescing for continuous
 * direct-manipulation operations (drags, sliders, live typing).
 */
export class CommandHistory {
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];
  private maxDepth: number;
  private coalesceWindowMs: number;
  private onChange: () => void;

  constructor(onChange: () => void, maxDepth = 150, coalesceWindowMs = 350) {
    this.onChange = onChange;
    this.maxDepth = maxDepth;
    this.coalesceWindowMs = coalesceWindowMs;
  }

  execute(cmd: HistoryCommand): void {
    cmd.execute();
    this.pushExecuted(cmd);
  }

  pushExecuted(cmd: HistoryCommand): void {
    const prev = this.undoStack[this.undoStack.length - 1];
    if (
      prev &&
      cmd.coalesceKey &&
      prev.coalesceKey === cmd.coalesceKey &&
      cmd.timestamp - prev.timestamp <= this.coalesceWindowMs
    ) {
      const merged: HistoryCommand = {
        label: cmd.label,
        coalesceKey: cmd.coalesceKey,
        timestamp: cmd.timestamp,
        execute: cmd.execute,
        undo: prev.undo,
      };
      this.undoStack[this.undoStack.length - 1] = merged;
    } else {
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.maxDepth) {
        this.undoStack.shift();
      }
    }
    this.redoStack.length = 0;
    this.onChange();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.onChange();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    this.onChange();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange();
  }
}
