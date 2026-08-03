/**
 * Where a session's work goes when it is saved, and the two ways of putting it
 * there (#48).
 *
 * A browser cannot write to a file it was handed through `<input type="file">`;
 * only the File System Access API yields a handle that can be written back, and
 * that API exists in Chromium desktop alone — not Firefox, not Safari, and on
 * no phone at all. `ui/CLAUDE.md` names Chrome, Safari and Firefox as supported
 * equally and `SPEC.md` assumes the labeling device *is* a phone, so write-back
 * is an enhancement over a download path that stays permanently, never a
 * replacement for it.
 *
 * The module exists so that split lives in one place. `rr-app` holds a
 * {@link FileBinding} and calls {@link openArchive} and {@link writeArchive};
 * which of the two paths runs is decided here, and the only part that can be
 * unit-tested in jsdom — {@link timestampedName} — is a pure function rather
 * than a branch inside a component. `capture.ts` wraps `getUserMedia` the same
 * way and for the same reason.
 */

/**
 * The file on disk this session writes back to.
 *
 * `handle` present means Save **overwrites**; absent means Save **downloads a
 * new generation**. The `stem` is carried separately because the fallback path
 * has no handle to read a name from and still needs one to build a filename —
 * and because it survives a binding that never gains a handle.
 */
export interface FileBinding {
  /** Filename without the `.r49` extension. */
  readonly stem: string;
  /** Present only where the File System Access API exists. */
  readonly handle?: FileSystemFileHandle;
}

/** What a save actually did, so the caller can say so. */
export type SaveOutcome =
  /** Written into a real file on disk; `binding` may be newly bound. */
  | { kind: 'wrote'; binding: FileBinding; filename: string }
  /** A new generation landed in the browser's download folder. */
  | { kind: 'downloaded'; binding: FileBinding; filename: string }
  /** The user dismissed the picker. Nothing was written, nothing rebound. */
  | { kind: 'cancelled' };

/** An archive chosen to open, and the binding that opening it establishes. */
export interface OpenedArchive {
  readonly file: File;
  readonly binding: FileBinding;
}

/**
 * The picker methods, declared narrowly rather than pulled in as a global
 * augmentation: they are absent from `lib.dom` (unlike `FileSystemFileHandle`
 * itself, which OPFS put there), and a `window as any` here would be the cast
 * that spreads.
 */
interface FilePickerWindow {
  showOpenFilePicker?: (options?: {
    types?: { description?: string; accept: Record<string, string[]> }[];
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileSystemFileHandle>;
}

/**
 * The permission pair, also absent from `lib.dom`. Optional because a handle
 * from OPFS has neither, and because the fallback path never gets this far.
 */
interface PermissionedHandle extends FileSystemFileHandle {
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
}

const PICKER_TYPES = [
  { description: 'r49 layout archive', accept: { 'application/octet-stream': ['.r49'] } }
];

function picker(): FilePickerWindow {
  return window as unknown as FilePickerWindow;
}

/** True where a file can be written back in place. Chromium desktop only. */
export function supportsFileSystemAccess(): boolean {
  return typeof picker().showOpenFilePicker === 'function';
}

/** `west-yard.r49` → `west-yard`. Any other extension is left alone. */
export function fileStem(filename: string): string {
  return filename.replace(/\.r49$/i, '');
}

/**
 * The download path's filename: `west-yard-20260802-1432.r49`.
 *
 * Every download creates a *new* file, so without an ordering in the name the
 * folder fills with `west-yard (1)`, `west-yard (2)` and the newest generation
 * is the one you have to remember rather than the one you can see. The format
 * is zero-padded and coarse-to-fine precisely so a lexical sort of the folder
 * *is* a chronological one.
 *
 * **Local time, not UTC**, because it is read against the clock on the wall
 * during a labeling session, not compared across machines.
 *
 * This name belongs to the download path alone. The picker suggests a plain
 * `west-yard.r49`, because a written-back file keeps its name across every
 * later overwrite — a timestamp there would be a name asserting a save time the
 * file no longer has, which is worse than no timestamp, since one invites trust.
 */
export function timestampedName(stem: string, date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${stem}-${stamp}.r49`;
}

/**
 * Chooses a `.r49` to open, through the picker where one exists and a file
 * input everywhere else.
 *
 * Resolves `null` when the user dismisses either. Only **read** access is asked
 * for here; the permission to write is requested at the first save, where the
 * prompt's purpose is visible — see {@link writeArchive}.
 */
export async function openArchive(): Promise<OpenedArchive | null> {
  const showOpenFilePicker = picker().showOpenFilePicker;
  if (showOpenFilePicker) {
    let handle: FileSystemFileHandle;
    try {
      [handle] = await showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
    const file = await handle.getFile();
    return { file, binding: { stem: fileStem(file.name), handle } };
  }

  const file = await promptForFile();
  if (!file) return null;
  return { file, binding: { stem: fileStem(file.name) } };
}

/**
 * Writes the archive, in place where the binding allows it and as a new
 * timestamped download where it does not.
 *
 * Four routes, in order:
 *
 * 1. A bound handle, `rebind` false — overwrite it, silently. `createWritable`
 *    stages into a swap file and commits on `close()`, so an interrupted write
 *    cannot truncate the original; that atomicity is the whole safety net, by
 *    decision (#48). There is no `.bak` and no verification read: re-parsing
 *    every image on every save costs more than the failure it guards.
 * 2. A bound handle whose write permission is refused — falls through to (4)
 *    rather than failing. A denied prompt must not cost the user a save.
 * 3. No handle (or `rebind`) with the API present — the picker, suggesting the
 *    binding's plain stem. Dismissing it returns `cancelled`; nothing is
 *    written and the old binding stands.
 * 4. No API — a timestamped download. The binding is returned unchanged: a
 *    download binds nothing, so the next save asks the same question again.
 *
 * `rebind` is Save As. On route 4 it is indistinguishable from a plain save,
 * which is why the affordance is a Shift-click rather than a button: a control
 * that did nothing different on Safari would still have to be explained there.
 */
export async function writeArchive(
  bytes: Uint8Array,
  binding: FileBinding,
  options: { rebind?: boolean } = {}
): Promise<SaveOutcome> {
  const handle = options.rebind ? undefined : binding.handle;
  if (handle && (await canWrite(handle))) {
    await writeThrough(handle, bytes);
    return { kind: 'wrote', binding, filename: `${binding.stem}.r49` };
  }

  // A truthy `handle` here means route 2: the write permission was refused, and
  // the answer is the download, not a second dialog asking for a location.
  const showSaveFilePicker = handle ? undefined : picker().showSaveFilePicker;
  if (showSaveFilePicker) {
    let chosen: FileSystemFileHandle;
    try {
      chosen = await showSaveFilePicker({
        suggestedName: `${binding.stem}.r49`,
        types: PICKER_TYPES
      });
    } catch (err) {
      if (isAbort(err)) return { kind: 'cancelled' };
      throw err;
    }
    await writeThrough(chosen, bytes);
    const stem = fileStem(chosen.name);
    return { kind: 'wrote', binding: { stem, handle: chosen }, filename: `${stem}.r49` };
  }

  const filename = timestampedName(binding.stem);
  download(bytes, filename);
  return { kind: 'downloaded', binding, filename };
}

/**
 * Asks for write permission, lazily — this is the first moment the browser's
 * "let this site edit the file?" prompt has a visible purpose, which is why
 * opening does not ask. A handle from the save picker already answers
 * `granted`, so a New layout never sees the prompt at all.
 */
async function canWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const permissioned = handle as PermissionedHandle;
  if (!permissioned.queryPermission || !permissioned.requestPermission) return true;
  if ((await permissioned.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await permissioned.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function writeThrough(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes as unknown as BufferSource);
  } catch (err) {
    // Discard the swap file rather than committing a partial one. A failing
    // abort must not replace the error that caused it.
    await writable.abort().catch(() => undefined);
    throw err;
  }
  await writable.close();
}

/** The download fallback: an anchor click, the only write a browser without the API allows. */
function download(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** A dismissed picker, which is a normal outcome rather than a failure. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** The fallback chooser. Resolves null on dismissal — which `change` never fires for. */
function promptForFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.r49';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    // `cancel` is not universal; where it is missing the promise simply never
    // settles, which costs nothing — no archive is replaced until it does.
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
