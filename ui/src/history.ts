import type { R49Archive, Image, Layout } from '@occupancy/r49';

/**
 * Undo/redo for the editor, as scoped snapshots of the manifest.
 *
 * A plain module, not an element: `rr-app` owns one instance and passes it down
 * (see `ui/README.md` § State and data flow). It deliberately does **not** live
 * in `@occupancy/r49` — that package is a parser/serializer, and an edit history
 * is an editing-session concept, coupled here to view state that means nothing
 * to the training exporter or to `fixtures.test.ts`.
 *
 * Three properties are load-bearing, and each one closes a failure mode:
 *
 * 1. **Snapshots, not inverse commands.** Every entry carries `before` and
 *    `after` clones of the subtree it touched, so undo and redo are one
 *    operation with the fields swapped. There is no per-command inverse to
 *    author, and therefore no way to write one that silently produces a subtly
 *    wrong manifest — the failure that would surface a training run later.
 * 2. **Scoped, not whole-manifest.** Every edit targets exactly one image
 *    record, the layout, or the images array, so an entry costs kilobytes
 *    rather than the hundreds of KB a fully labeled manifest runs to. The
 *    corollary the editor must honour: **key on label `id`, never on object
 *    identity** — applying a snapshot replaces the objects wholesale.
 * 3. **No holes.** A history that silently skips some edits is worse than none,
 *    because the binding teaches the user to trust it. Deleting an image
 *    therefore retains its bytes rather than being excluded as too expensive.
 *
 * @see SPEC.md § Undo and redo
 */

/** What an entry's snapshot covers. Every editor mutation targets exactly one. */
export type HistoryTarget =
  /** `layout` — sensors, calibration, scale, metadata. */
  | { kind: 'layout' }
  /** One image record — its car labels and `labeled_complete`. */
  | { kind: 'image'; filename: string }
  /** The images array itself — add, remove, reorder. */
  | { kind: 'images' };

/**
 * One undoable edit. Returned by {@link EditHistory.undo} and
 * {@link EditHistory.redo} so the caller can satisfy the navigation invariant:
 * an undo that changes another image must reveal that image before the user is
 * told anything happened.
 */
export interface HistoryEntry {
  /** Human phrase, rendered as "Undo <label>". */
  readonly label: string;
  readonly target: HistoryTarget;
  /** Retained bytes for images this entry can bring back. */
  readonly blobs: ReadonlyMap<string, Uint8Array>;
  /** Approximate retained size, the unit the budget is spent in. */
  readonly bytes: number;
}

interface MutableEntry extends HistoryEntry {
  before: string;
  after: string;
  blobs: Map<string, Uint8Array>;
}

/**
 * Default retention ceiling.
 *
 * A byte budget rather than an entry count, because entries are heterogeneous
 * by three orders of magnitude: a label edit clones ~10 KB, a deleted image
 * retains megabytes of JPEG. "100 entries" is 1 MB or 800 MB depending on what
 * the user happened to do, which makes it useless as a bound.
 *
 * The property this buys: in a pure labeling session — no image removals, the
 * overwhelmingly common case — this is tens of thousands of entries, so undo
 * reaches all the way back to the state the archive was opened in. The budget
 * only bites when images are being deleted, which is when retention genuinely
 * is expensive and a saved file is the fallback.
 *
 * Not a `config.yaml` value: that file is scoped to parameters that must agree
 * *across stages*, and a browser memory ceiling agrees with nothing outside
 * `ui/`. Putting it there would force a `lib/config` regeneration for a number
 * no other stage can read.
 */
export const DEFAULT_HISTORY_BUDGET_BYTES = 256 * 1024 * 1024;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class EditHistory {
  private _archive: R49Archive | null = null;
  private _entries: MutableEntry[] = [];
  /** Number of entries currently applied; the boundary between undo and redo. */
  private _index = 0;
  /** `_index` as of the last save. Negative once eviction passes it. */
  private _savedIndex = 0;
  private _bytes = 0;
  private readonly _budgetBytes: number;

  constructor(budgetBytes: number = DEFAULT_HISTORY_BUDGET_BYTES) {
    this._budgetBytes = budgetBytes;
  }

  /**
   * Binds the history to an archive, discarding any existing stack.
   *
   * New and Open replace the archive wholesale, which invalidates every scoped
   * snapshot in it — so clearing is not a policy choice here, it is the only
   * correct behaviour. Attaching also resets the save marker, so a
   * freshly-opened archive is not dirty.
   */
  attach(archive: R49Archive | null): void {
    this._archive = archive;
    this._entries = [];
    this._index = 0;
    this._savedIndex = 0;
    this._bytes = 0;
  }

  get canUndo(): boolean {
    return this._index > 0;
  }

  get canRedo(): boolean {
    return this._index < this._entries.length;
  }

  /** Label of the edit `undo()` would reverse, or null. */
  get undoLabel(): string | null {
    return this.canUndo ? this._entries[this._index - 1].label : null;
  }

  /** Label of the edit `redo()` would reapply, or null. */
  get redoLabel(): string | null {
    return this.canRedo ? this._entries[this._index].label : null;
  }

  /**
   * Whether the archive differs from what was last saved.
   *
   * Falls out of the save marker rather than needing separate bookkeeping, and
   * it is what makes the confirm-on-discard gate possible — the one destructive
   * act undo structurally cannot cover, since New and Open take the stack with
   * them.
   */
  get isDirty(): boolean {
    return this._index !== this._savedIndex;
  }

  /** Entries currently retained. Undo reaches back at most this far. */
  get size(): number {
    return this._entries.length;
  }

  /** Bytes currently retained, against {@link DEFAULT_HISTORY_BUDGET_BYTES}. */
  get bytes(): number {
    return this._bytes;
  }

  /**
   * Marks the current position as saved. Called after a successful export —
   * saving does not clear the history, because the bytes on disk are unaffected
   * by anything undone afterwards, so undoing past a save stays legitimate.
   */
  markSaved(): void {
    this._savedIndex = this._index;
  }

  /**
   * Runs a mutation and records it, if it changed anything.
   *
   * **Every manifest mutation in the editor must go through this.** Nothing in
   * the compiler enforces it: a component that reaches into `.archive` directly
   * still typechecks, still renders, and leaves a stack that is wrong rather
   * than merely short.
   *
   * @param label Human phrase for the affordance — "delete image".
   * @param target The subtree the mutation touches. Getting this wrong is the
   *   one class of bug scoped snapshots admit, which is what the round-trip
   *   test in `tests/history.test.ts` exists to catch.
   * @param mutate Performs the edit. May be async.
   * @param options.retain Filenames whose bytes must survive the mutation, for
   *   an edit that removes images. Read *before* `mutate` runs, since removal
   *   drops them from the zip.
   * @returns Whatever `mutate` returned.
   */
  async record<T>(
    label: string,
    target: HistoryTarget,
    mutate: () => T | Promise<T>,
    options?: { retain?: string[] }
  ): Promise<T> {
    const archive = this._archive;
    if (!archive) return await mutate();

    const blobs = new Map<string, Uint8Array>();
    for (const filename of options?.retain ?? []) {
      const data = await archive.getImage(filename);
      if (data) blobs.set(filename, data);
    }

    const before = JSON.stringify(this._read(target));
    const result = await mutate();
    const after = JSON.stringify(this._read(target));

    // No-op suppression: a drag returned to its origin, a reclassify to the
    // class it already had, a retyped identical name. None may consume a slot.
    if (before === after) return result;

    if (target.kind === 'images') {
      await this._retainImageBytes(archive, before, after, blobs);
    }

    let bytes = before.length + after.length;
    for (const data of blobs.values()) bytes += data.byteLength;

    // Linear redo: any new edit discards the abandoned branch.
    this._drop(this._entries.splice(this._index));
    this._entries.push({ label, target, before, after, blobs, bytes });
    this._index = this._entries.length;
    this._bytes += bytes;
    this._evict();

    return result;
  }

  /**
   * Reverses the most recent edit.
   *
   * @returns The entry that was reversed, so the caller can reveal what it
   *   changed, or null if there was nothing to undo.
   */
  async undo(): Promise<HistoryEntry | null> {
    if (!this.canUndo) return null;
    const entry = this._entries[this._index - 1];
    await this._apply(entry, entry.before);
    this._index--;
    return entry;
  }

  /** Reapplies the next edit. Mirror of {@link undo}. */
  async redo(): Promise<HistoryEntry | null> {
    if (!this.canRedo) return null;
    const entry = this._entries[this._index];
    await this._apply(entry, entry.after);
    this._index++;
    return entry;
  }

  /**
   * Makes an images entry reversible in **both** directions.
   *
   * An entry that changes the image list moves bytes, not just manifest rows,
   * and the two directions need opposite timing:
   *
   * * A **removal** loses its bytes when it runs, so they must be read before —
   *   which only the caller can arrange, via `retain`.
   * * An **addition** is the mirror: undoing it deletes the bytes from the zip,
   *   so *redo* needs them. They are still there once the mutation has run, so
   *   this captures them automatically and the caller need not think about it.
   *
   * The warning is deliberate. A removal whose bytes nobody retained produces
   * an entry that restores a manifest row naming an image that is not in the
   * archive — a hole, and holes are what this design refuses everywhere. Better
   * noisy in the console than discovered by a user pressing Cmd+Z.
   */
  private async _retainImageBytes(
    archive: R49Archive,
    before: string,
    after: string,
    blobs: Map<string, Uint8Array>
  ): Promise<void> {
    const names = (json: string) => new Set((JSON.parse(json) as Image[]).map((img) => img.filename));
    const wasPresent = names(before);
    const isPresent = names(after);

    for (const filename of isPresent) {
      if (wasPresent.has(filename) || blobs.has(filename)) continue;
      const data = await archive.getImage(filename);
      if (data) blobs.set(filename, data);
    }
    for (const filename of wasPresent) {
      if (isPresent.has(filename) || blobs.has(filename)) continue;
      console.warn(
        `EditHistory: "${filename}" was removed without retaining its bytes; ` +
          'undo will restore the manifest entry but not the image. Pass it in options.retain.'
      );
    }
  }

  /** Reads the target subtree out of the live manifest. */
  private _read(target: HistoryTarget): Layout | Image | Image[] | null {
    const manifest = this._archive!.getManifest();
    switch (target.kind) {
      case 'layout':
        return manifest.layout;
      case 'image':
        return manifest.images.find((img) => img.filename === target.filename) ?? null;
      case 'images':
        return manifest.images;
    }
  }

  private async _apply(entry: MutableEntry, snapshot: string): Promise<void> {
    const archive = this._archive;
    if (!archive) return;
    const manifest = archive.getManifest();
    const data = JSON.parse(snapshot);

    switch (entry.target.kind) {
      case 'layout':
        manifest.layout = data as Layout;
        return;

      case 'image': {
        if (data === null) return;
        const image = data as Image;
        const index = manifest.images.findIndex((img) => img.filename === image.filename);
        if (index >= 0) manifest.images[index] = image;
        return;
      }

      case 'images': {
        // Reconcile the zip's payload before the manifest, so a restored entry
        // never names bytes that are not there.
        const wanted = data as Image[];
        const wantedNames = new Set(wanted.map((img) => img.filename));
        const present = new Set(manifest.images.map((img) => img.filename));

        for (const filename of present) {
          if (!wantedNames.has(filename)) archive.removeImage(filename);
        }
        for (const filename of wantedNames) {
          if (present.has(filename)) continue;
          const bytes = entry.blobs.get(filename);
          if (bytes) await archive.addImage(filename, bytes);
        }
        manifest.images = clone(wanted);
        return;
      }
    }
  }

  /**
   * Spends the budget down by dropping the oldest entries.
   *
   * Truncates the tail; never removes a middle entry to reclaim a large blob.
   * A hole would be invisible until the user undid into it, which is the exact
   * failure this design refuses everywhere else. The newest entry is always
   * kept, even if it alone exceeds the budget: discarding what the user just
   * did is a worse answer than exceeding a memory target.
   */
  private _evict(): void {
    while (this._bytes > this._budgetBytes && this._entries.length > 1) {
      const [evicted] = this._entries.splice(0, 1);
      this._bytes -= evicted.bytes;
      this._index--;
      this._savedIndex--;
    }
  }

  private _drop(entries: MutableEntry[]): void {
    for (const entry of entries) this._bytes -= entry.bytes;
  }
}
