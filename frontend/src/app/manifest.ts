/**
 * Manifest for .r49 files.
 * 
 * The Manifest class manages the metadata state for a Rails49 project file, including:
 * - Layout configuration (scale, dimensions)
 * - Camera calibration settings
 * - Image metadata and labels
 * 
 * It serves as the single source of truth for the project's data structure.
 * 
 * Reactivity:
 * The class extends EventTarget. Setters (e.g., `setLayout`, `setMarker`) 
 * modify the internal state and emit a 'rr-manifest-changed' event.
 * 
 * R49File includes a Manifest and listens to the 'rr-manifest-changed' events.
 * 
 * Serialization:
 * The internal state is stored in a JSON-serializable `_data` object, accessible via `toJSON()`.
 */

import { createContext } from "@lit/context";


export class Manifest extends EventTarget {
  private _data: ManifestData = {
    version: 2,
    layout: { name: 'layout', scale: 'HO', size: { width: undefined, height: undefined } },
    camera: { resolution: { width: 0, height: 0 } },
    calibration: {},
    images: [], // List of Image metadata (filenames, labels). Actual binary data is managed by R49File.
  };

  constructor(data?: any) {
    super();
    if (data) {
      this._data = { ...this._data, ...data };
    }
  }

  get version(): number { return this._data.version; }
  get layout(): Layout { return this._data.layout; }
  get camera(): Camera { return this._data.camera; }
  get calibration(): Record<string, Point> { return this._data.calibration; }
  get images(): Image[] { return this._data.images; }
  get scale(): number { return Scale2Number[this._data.layout.scale]; }
  scale_factor(target_dpt: number): number { return target_dpt / this.dots_per_track; }

  /**
   * Resolution of images in dots per track. Similar to DPI but more relevant for railroad layouts.
   * Example: track spacing for HO is standard_gauge_mm/86 = 16mm.
   * For DPI = 72, dots_per_track = DPI * (16/25.4) = 45.
   */
  get dots_per_track(): number {
    const layout_size = this._data.layout.size;
    if (!layout_size.width && !layout_size.height) return -1;

    const rect0 = this._data.calibration['rect-0']; // Top-Left
    const rect1 = this._data.calibration['rect-1']; // Bottom-Left
    const rect2 = this._data.calibration['rect-2']; // Top-Right
    const rect3 = this._data.calibration['rect-3']; // Bottom-Right

    const track_mm = standard_gauge_mm / this.scale;
    const dpts: number[] = [];

    const dist = (p1: Point, p2: Point) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

    // Horizontal edges (Width)
    if (layout_size.width) {
      if (rect0 && rect2) {
        const topPx = dist(rect0, rect2);
        dpts.push((topPx / layout_size.width) * track_mm);
      }
      if (rect1 && rect3) {
        const botPx = dist(rect1, rect3);
        dpts.push((botPx / layout_size.width) * track_mm);
      }
    }

    // Vertical edges (Height)
    if (layout_size.height) {
      if (rect0 && rect1) {
        const leftPx = dist(rect0, rect1);
        dpts.push((leftPx / layout_size.height) * track_mm);
      }
      if (rect2 && rect3) {
        const rightPx = dist(rect2, rect3);
        dpts.push((rightPx / layout_size.height) * track_mm);
      }
    }

    if (dpts.length === 0) return -1;

    const averageDpt = dpts.reduce((sum, dpt) => sum + dpt, 0) / dpts.length;
    return Math.round(averageDpt);
  }

  get px_per_mm(): number {
    const dpt = this.dots_per_track;
    if (dpt < 0) return 0;
    const gauge_mm = standard_gauge_mm / this.scale;
    return dpt / gauge_mm;
  }

  /**
   * Updates the layout configuration (name, scale, size).
   * Triggers a change event.
   */
  setLayout(layout: Layout) {
    this._invalidateCache();
    this._data.layout = layout;
    this._emitChange();
  }

  /**
   * Updates the camera resolution and re-initializes calibration markers if dimensions change.
   * This is typically called when loading a new background image.
   */
  setImageDimensions(width: number, height: number) {
    this._invalidateCache();
    const calibrationMarkerCount = Object.keys(this.calibration || {}).length;
    if (
      width != this.camera.resolution.width ||
      height != this.camera.resolution.height ||
      calibrationMarkerCount < 4
    ) {
      const newCalibrationMarkers = {
        'rect-0': { x: 50, y: 50 },
        'rect-1': { x: 50, y: height - 50 },
        'rect-2': { x: width - 50, y: 50 },
        'rect-3': { x: width - 50, y: height - 50 },
      };

      this._data.camera.resolution = { width, height };
      this._data.calibration = newCalibrationMarkers;
      this._emitChange();
    }
  }

  setImages(images: Image[]) {
    this._data.images = images;
    this._emitChange();
  }

  /**
   * Adds or updates a marker (calibration point or label).
   * @param category 'calibration' or 'label'
   * @param id Unique identifier for the marker
   * @param x X coordinate
   * @param y Y coordinate
   * @param type (Optional) Type of label (e.g., 'track', 'train')
   * @param imageIndex Index of the image to apply the label to (default 0)
   */
  setMarker(
    category: MarkerCategory,
    id: string,
    x: number,
    y: number,
    type?: string,
    imageIndex: number = 0,
  ) {
    if (category === 'calibration') {
      this._invalidateCache();
      const calibration = {
        ...this._data.calibration,
        [id]: { x: Math.round(x), y: Math.round(y) },
      };
      this._data.calibration = calibration;
      this._emitChange();
    } else if (category === 'label') {
      const image = this._data.images[imageIndex];
      if (!image) return; // Should not happen if index is valid

      const labels = {
        ...image.labels,
        [id]: { x: Math.round(x), y: Math.round(y), type: type || 'track' },
      };
      const newImages = [...this._data.images];
      newImages[imageIndex] = { ...image, labels };
      this._data.images = newImages;
      this._emitChange();
    }
  }

  /**
   * Removes a marker by ID.
   */
  deleteMarker(category: MarkerCategory, id: string, imageIndex: number = 0) {
    if (category === 'calibration') {
      const { [id]: deleted, ...calibration } = this._data.calibration;
      this._data.calibration = calibration;
      this._emitChange();
    } else if (category === 'label') {
      const image = this._data.images[imageIndex];
      if (!image) return;

      const { [id]: deleted, ...labels } = image.labels;
      const newImages = [...this._data.images];
      newImages[imageIndex] = { ...image, labels };
      this._data.images = newImages;

      this._emitChange();
    }
  }

  toJSON(): string {
    return JSON.stringify(this._data, null, 2);
  }

  static fromJSON(json: string): Manifest {
    const data = JSON.parse(json);
    if (data.version !== 2) {
      throw new Error(
        `Unsupported manifest version: ${data.version}. Application only supports version 2.`,
      );
    }
    return new Manifest(data);
  }

  private _emitChange() {
    this.dispatchEvent(
      new CustomEvent('rr-manifest-changed', {
        detail: { ...this._data },
      }),
    );
  }

  private _invalidateCache() {
    // Stub for cache invalidation logic if needed in the future
  }
}

export type UUID = string;

export interface Point {
  x: number;
  y: number;
}

export interface Marker extends Point {
  type: string;
}

export type MarkerCategory = 'calibration' | 'label';

export interface Image {
  filename: string;
  labels: Record<UUID, Marker>;
}

export interface ManifestData {
  version: number;
  layout: Layout;
  camera: Camera;
  calibration: Record<string, Point>;
  images: Image[];
}

export interface Layout {
  name: string | undefined;
  scale: ValidScales;
  size: { width: number | undefined; height: number | undefined };  // in mm
  description?: string;
  contact?: string;
}

type ValidScales = keyof typeof Scale2Number;

export interface Camera {
  resolution: { width: number; height: number };
  model?: string;
}

export const Scale2Number = {
  G: 25,
  O: 48,
  S: 64,
  HO: 87,
  T: 72,
  N: 160,
  Z: 96,
};

export const standard_gauge_mm = 1435; // Standard gauge in millimeters

export const manifestContext = createContext<Manifest>('manifest');


