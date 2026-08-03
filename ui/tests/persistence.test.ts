import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fileStem,
  supportsFileSystemAccess,
  timestampedName,
  writeArchive,
  type FileBinding
} from '../src/persistence.js';

/**
 * jsdom has no File System Access API, which is the honest baseline: it is the
 * fallback path, and it is what Safari and every phone run. The write-back
 * routes are covered by installing fakes on `window` — this proves the module
 * *routes* correctly, not that Chromium's API behaves as documented, which no
 * test in jsdom could show.
 */

/** The handle plus the two methods `lib.dom` does not declare, so a test can assert on them. */
interface FakeHandle extends FileSystemFileHandle {
  queryPermission: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  createWritable: ReturnType<typeof vi.fn>;
}

/**
 * A handle that records what was written through it. `standing` is what
 * `queryPermission` answers and `asked` what the prompt would return, so the
 * already-granted and the must-ask cases are the same fake with two arguments.
 */
function fakeHandle(
  name: string,
  standing: PermissionState = 'granted',
  asked: PermissionState = standing
) {
  const written: unknown[] = [];
  const closed = { value: false };
  return {
    written,
    closed,
    handle: {
      name,
      queryPermission: vi.fn().mockResolvedValue(standing),
      requestPermission: vi.fn().mockResolvedValue(asked),
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn(async (data: unknown) => {
          written.push(data);
        }),
        close: vi.fn(async () => {
          closed.value = true;
        }),
        abort: vi.fn().mockResolvedValue(undefined)
      })
    } as unknown as FakeHandle
  };
}

afterEach(() => {
  delete (window as any).showOpenFilePicker;
  delete (window as any).showSaveFilePicker;
  vi.restoreAllMocks();
});

describe('timestampedName', () => {
  it('stamps local date and time, zero-padded', () => {
    expect(timestampedName('west-yard', new Date(2026, 7, 2, 14, 32))).toBe(
      'west-yard-20260802-1432.r49'
    );
    expect(timestampedName('yard', new Date(2026, 0, 9, 4, 5))).toBe('yard-20260109-0405.r49');
  });

  // The whole point of the format: the folder listing sorted by name is the
  // folder listing sorted by age, which is what makes the newest generation the
  // one you can see rather than the one you have to remember (#48).
  it('sorts lexically in chronological order', () => {
    const names = [
      timestampedName('yard', new Date(2026, 7, 2, 9, 30)),
      timestampedName('yard', new Date(2025, 11, 31, 23, 59)),
      timestampedName('yard', new Date(2026, 7, 2, 10, 0)),
      timestampedName('yard', new Date(2026, 6, 2, 10, 0))
    ];
    expect([...names].sort()).toEqual([names[1], names[3], names[0], names[2]]);
  });
});

describe('fileStem', () => {
  it('strips the extension, case-insensitively, and leaves anything else', () => {
    expect(fileStem('west-yard.r49')).toBe('west-yard');
    expect(fileStem('west-yard.R49')).toBe('west-yard');
    expect(fileStem('west-yard')).toBe('west-yard');
    expect(fileStem('yard.v2.r49')).toBe('yard.v2');
  });
});

describe('supportsFileSystemAccess', () => {
  it('is false in a browser without the picker', () => {
    expect(supportsFileSystemAccess()).toBe(false);
  });

  it('is true once the picker exists', () => {
    (window as any).showOpenFilePicker = vi.fn();
    expect(supportsFileSystemAccess()).toBe(true);
  });
});

describe('writeArchive', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it('downloads a timestamped generation when there is no API', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const outcome = await writeArchive(bytes, { stem: 'west-yard' });

    expect(click).toHaveBeenCalled();
    expect(outcome.kind).toBe('downloaded');
    expect(outcome.kind === 'downloaded' && outcome.filename).toMatch(/^west-yard-\d{8}-\d{4}\.r49$/);
    // A download binds nothing: the next save must ask the same question again.
    expect(outcome.kind === 'downloaded' && outcome.binding.handle).toBeUndefined();
  });

  it('overwrites a bound handle without opening a picker', async () => {
    const { handle, written, closed } = fakeHandle('west-yard.r49');
    const showSaveFilePicker = vi.fn();
    (window as any).showSaveFilePicker = showSaveFilePicker;

    const binding: FileBinding = { stem: 'west-yard', handle };
    const outcome = await writeArchive(bytes, binding);

    expect(showSaveFilePicker).not.toHaveBeenCalled();
    expect(written).toEqual([bytes]);
    expect(closed.value).toBe(true);
    expect(outcome).toEqual({ kind: 'wrote', binding, filename: 'west-yard.r49' });
  });

  it('does not re-prompt when write permission already stands', async () => {
    const { handle, written } = fakeHandle('west-yard.r49', 'granted');

    await writeArchive(bytes, { stem: 'west-yard', handle });

    expect(handle.requestPermission).not.toHaveBeenCalled();
    expect(written).toEqual([bytes]);
  });

  it('prompts for write permission at the first save, and writes once granted', async () => {
    const { handle, written } = fakeHandle('west-yard.r49', 'prompt', 'granted');

    await writeArchive(bytes, { stem: 'west-yard', handle });

    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(written).toEqual([bytes]);
  });

  // A refused prompt must not cost the user a save. It falls back to the
  // download path rather than raising, or asking a second time with a picker.
  it('falls back to a download when write permission is refused', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { handle } = fakeHandle('west-yard.r49', 'prompt', 'denied');
    const showSaveFilePicker = vi.fn();
    (window as any).showSaveFilePicker = showSaveFilePicker;

    const outcome = await writeArchive(bytes, { stem: 'west-yard', handle });

    expect(showSaveFilePicker).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(outcome.kind).toBe('downloaded');
  });

  // The suggested name is plain: an overwritten file keeps its name forever,
  // so a timestamp there would misreport when it was last written.
  it('suggests an unstamped name for an archive that has never been saved', async () => {
    const { handle, written } = fakeHandle('chosen.r49');
    const showSaveFilePicker = vi.fn().mockResolvedValue(handle);
    (window as any).showSaveFilePicker = showSaveFilePicker;

    const outcome = await writeArchive(bytes, { stem: 'New Layout' });

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'New Layout.r49' })
    );
    expect(written).toEqual([bytes]);
    expect(outcome).toEqual({
      kind: 'wrote',
      binding: { stem: 'chosen', handle },
      filename: 'chosen.r49'
    });
  });

  it('rebinds to the file chosen by Save As', async () => {
    const bound = fakeHandle('west-yard.r49');
    const chosen = fakeHandle('west-yard-copy.r49');
    (window as any).showSaveFilePicker = vi.fn().mockResolvedValue(chosen.handle);

    const outcome = await writeArchive(
      bytes,
      { stem: 'west-yard', handle: bound.handle },
      { rebind: true }
    );

    expect(bound.written).toEqual([]);
    expect(chosen.written).toEqual([bytes]);
    expect(outcome.kind === 'wrote' && outcome.binding.handle).toBe(chosen.handle);
  });

  it('writes nothing and keeps the binding when the picker is dismissed', async () => {
    (window as any).showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('dismissed', 'AbortError'));

    const outcome = await writeArchive(bytes, { stem: 'New Layout' });

    expect(outcome).toEqual({ kind: 'cancelled' });
  });

  it('discards the swap file when the write fails', async () => {
    const { handle } = fakeHandle('west-yard.r49');
    const abort = vi.fn().mockResolvedValue(undefined);
    handle.createWritable.mockResolvedValue({
      write: vi.fn().mockRejectedValue(new Error('disk full')),
      close: vi.fn(),
      abort
    });

    await expect(writeArchive(bytes, { stem: 'west-yard', handle })).rejects.toThrow('disk full');
    expect(abort).toHaveBeenCalled();
  });
});
