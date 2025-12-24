import { LitElement, html, css, svg } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { Manifest, type MarkerCategory } from './app/manifest.ts';
import { HEIGHT_COLOR, MARKER_SIZE_PX, WIDTH_COLOR } from './app/config.ts';


import { getMarkerDefs } from './styles/marker-defs.ts';

import { R49File, r49FileContext } from './app/r49file.ts';
import { Classifier, classifierContext } from './app/classifier.ts';

/* Display current image with markers */

interface ValidationResult {
  x: number;
  y: number;
  type: string;
  match: boolean;
  predicted?: string;
  comparison?: {
      label: string;
      match: boolean;
  };
}

// DEBUG: sometimes switching images displays incorrect validation results for some markers
// triggering an update (e.g. by moving a label) fixes it.
// diagnose this issue and devise a plan to fix it.
// Do not make any changes to the code until the issue is diagnosed, 
// except adding console.log statements if needed.

@customElement('rr-label')
export class RrLabel extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    svg {
      width: 100%;
      height: auto;
      display: block;
    }

    symbol {
      overflow: visible;
      stroke-width: 0.3;
      cursor: pointer;
    }

    .validation-rect {
      fill: none;
      stroke-width: 2;
      pointer-events: none;
    }
    
    .debug-popup {
      display: none;
      position: fixed;
      z-index: 1000;
      background: white;
      border: 1px solid #ccc;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      padding: 8px;
      cursor: pointer;
    }
  `;

  @consume({ context: r49FileContext, subscribe: true })
  @state()
  r49File!: R49File;

  @consume({ context: classifierContext, subscribe: true })
  @state()
  classifier: Classifier | undefined;

  get manifest(): Manifest {
    return this.r49File?.manifest;
  }

  // Derived from r49File context
  // get imageUrl removed, use r49File.getImageUrl(index) directly

  @property({ type: Number })
  imageIndex: number = -1;

  @state()
  private _imageBitmap: ImageBitmap | null = null; // Managed by r49File.dispose(), no manual close() here.
  
  @state()
  validationResults: Record<string, ValidationResult> = {};

  private _markerValidationRequests: Record<string, number> = {};

  @state()
  private dragHandle: { id: string; category: MarkerCategory } | null = null;

  @property({ attribute: false })
  activeTool: string | null = null;

  @state()
  symbolSize: number = 48; // default, updated by resize observer

  private resizeObserver: ResizeObserver | null = null;

  @query('#svg')
  svg!: SVGGElement;

  firstUpdated() {
    this.resizeObserver = new ResizeObserver(() => {
      this.updateSymbolSize();
    });
    this.resizeObserver.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  private updateSymbolSize() {
    if (!this.manifest || !this.manifest.camera) return;

    const width = this.offsetWidth;
    if (width === 0) return; // not visible yet

    const imageWidth = this.manifest.camera.resolution.width;
    // The SVG viewBox width matches imageWidth.
    // So the number of SVG units per screen pixel is imageWidth / screenWidth.
    const scale = imageWidth / width;

    this.symbolSize = MARKER_SIZE_PX * scale;
  }

  willUpdate(changedProperties: Map<string, any>) {
    // Synchronously clear state when image or file changes to prevent stale data usage
    if (changedProperties.has('r49File') || changedProperties.has('imageIndex')) {
      this.updateSymbolSize();
      this.validationResults = {};
      this._imageBitmap = null;
      this._updateImage();
    }
  }

  // When image loads or manifest changes, we might need to recalculate if resolution changed
  updated(changedProperties: Map<string, any>) {
    // Re-validate markers if the classifier, bitmap, or dragging state changes.
    // By only validating when _imageBitmap is present, we ensure we don't use stale data.
    if (
        changedProperties.has('classifier') || 
        changedProperties.has('_imageBitmap') ||
        changedProperties.has('dragHandle')
    ) {
        if (this._imageBitmap && !this.dragHandle) {
            this.validateMarkers();
        }
    }
  }

  private async _updateImage() {
    if (this.imageIndex < 0 || !this.r49File) {
        this.validationResults = {};
        this._imageBitmap = null;
        return;
    }

    try {
        // R49Image handles caching bitmap internally, accessed via wrapper
        const bitmap = await this.r49File.getImageBitmap(this.imageIndex);
        this._imageBitmap = bitmap || null;
    } catch (e) {
        console.error("Failed to load image bitmap", e);
        this._imageBitmap = null;
    }
  }

  private async validateMarkers() {
    if (this.dragHandle) return;
    const currentImageIndex = this.imageIndex;
    const currentImage = this.manifest?.images[currentImageIndex];
    if (!currentImage?.labels || !this._imageBitmap || !this.classifier) return;
    
    const img_dpt = this.manifest.dots_per_track;
    if (img_dpt <= 0) return; 

    // Use a local object to batch results and prevent multiple render cycles
    const results: Record<string, ValidationResult> = {};
    const labels = Object.entries(currentImage.labels);

    const tasks = labels.map(async ([id, marker]) => {
        const requestId = (this._markerValidationRequests[id] || 0) + 1;
        this._markerValidationRequests[id] = requestId;

        try {
            const predictedLabel = await this.classifier!.classify(
                this._imageBitmap!,
                { x: marker.x, y: marker.y },
                img_dpt
            );

            // Guard against stale results if image index changed during async work
            if (this.imageIndex !== currentImageIndex || 
                this._markerValidationRequests[id] !== requestId) return;
            
            results[id] = { 
               x: marker.x, 
               y: marker.y, 
               type: marker.type, 
               match: predictedLabel === marker.type,
               predicted: predictedLabel,
               comparison: undefined 
            };
        } catch (e) {
            console.error(`[rr-label] Classification failed for ${id}`, e);
        }
    });

    await Promise.all(tasks);

    // One final check before setting state to trigger a single update cycle
    if (this.imageIndex === currentImageIndex && !this.dragHandle) {
        this.validationResults = results;
    }
  }

  render() {
    // Calculate the SVG viewBox to match image dimensions
    const imageWidth = this.manifest.camera.resolution.width;
    const imageHeight = this.manifest.camera.resolution.height;
    const viewBox = `0 0 ${imageWidth} ${imageHeight}`;

    return html`
      <div style="position: relative; width: 100%; height: 100%;" @mousedown=${this.handleMouseDown}>
        <svg
          id="svg"
          viewBox=${viewBox}
          @mousemove=${this.handleMouseMove}
          @click=${this.handleClick}
        >
          ${getMarkerDefs(this.symbolSize)}
          <image
            id="image"
            href=${this.r49File?.getImageUrl(this.imageIndex)}
            x="0"
            y="0"
            width=${imageWidth}
            height=${imageHeight}
          ></image>
          ${this.markerTemplate('label')} ${this.imageIndex === 0 ? this.rectTemplate() : svg``}
        </svg>
        <div id="debug-popup-container" 
             class="debug-popup"
             @click=${(e: Event) => {(e.target as HTMLElement).style.display = 'none';}}
        ></div>
      </div>
    `;
  }

  private markerTemplate(category: MarkerCategory) {
    if (!this.manifest.images[this.imageIndex]) return svg``;
    const markers = this.manifest.images[this.imageIndex].labels || {};
    return svg`
      ${Object.entries(markers).map(([markerId, marker]) => {
        const validation = this.validationResults[markerId];
        const color = validation
          ? validation.match 
            ? (validation.comparison && !validation.comparison.match ? 'orange' : 'green') 
            : 'red'
          : 'gray';
        
        let strokeDasharray = "0";
        if (validation && validation.comparison && validation.predicted !== validation.comparison.label) {
            strokeDasharray = "4"; // Dashed line for model disagreement
        }
        
        return svg`
          <g id=${markerId} class=${category}
             style="cursor: grab">
             
            <use class=${category} href="#${marker.type}" x=${marker.x} y=${marker.y}></use>
            <rect 
                x=${marker.x - this.symbolSize / 2} 
                y=${marker.y - this.symbolSize / 2} 
                width=${this.symbolSize} 
                height=${this.symbolSize} 
                class="validation-rect"
                stroke=${color}
                stroke-dasharray=${strokeDasharray}
            />
          </g>
        `;
      })}
    `;
  }

  private rectTemplate(handles = true) {
    if (Object.keys(this.manifest.calibration || {}).length < 4) return svg``;

    const {
      'rect-0': rect0,
      'rect-1': rect1,
      'rect-2': rect2,
      'rect-3': rect3,
    } = this.manifest.calibration;

    return svg`
      <line x1=${rect0.x} y1=${rect0.y} x2=${rect1.x} y2=${rect1.y} stroke=${WIDTH_COLOR} stroke-width="3" vector-effect="non-scaling-stroke" style="pointer-events: none;" />
      <line x1=${rect1.x} y1=${rect1.y} x2=${rect3.x} y2=${rect3.y} stroke=${HEIGHT_COLOR} stroke-width="3" vector-effect="non-scaling-stroke" style="pointer-events: none;" />
      <line x1=${rect3.x} y1=${rect3.y} x2=${rect2.x} y2=${rect2.y} stroke=${WIDTH_COLOR} stroke-width="3" vector-effect="non-scaling-stroke" style="pointer-events: none;" />
      <line x1=${rect2.x} y1=${rect2.y} x2=${rect0.x} y2=${rect0.y} stroke=${HEIGHT_COLOR} stroke-width="3" vector-effect="non-scaling-stroke" style="pointer-events: none;" />
      ${
        handles
          ? svg`
            <use id="rect-0" class="calibration" href="#drag-handle" x=${rect0.x} y=${rect0.y} />
            <use id="rect-1" class="calibration" href="#drag-handle" x=${rect1.x} y=${rect1.y} />
            <use id="rect-2" class="calibration" href="#drag-handle" x=${rect2.x} y=${rect2.y} />
            <use id="rect-3" class="calibration" href="#drag-handle" x=${rect3.x} y=${rect3.y} />
          `
          : svg``
      }
    `;
  }

  private toSVGPoint(x: number, y: number) {
    const p = new DOMPoint(x, y);
    const ctm = this.svg.getScreenCTM();
    if (!ctm) {
      throw new Error('Unable to get screen CTM from SVG element');
    }
    return p.matrixTransform(ctm.inverse());
  }

  private debugClick(event: MouseEvent) {
    const screenCoords = this.toSVGPoint(event.clientX, event.clientY);

    // Default size for debug patch

    
    if (!this._imageBitmap || !this.classifier) {
        console.warn("Classifier or ImageBitmap not ready for debugging");
        return;
    }

    const img = this._imageBitmap;
    
    // --- Scaled Patch via Classifier.patch ---
    const model_dpt = this.classifier.spec.dpt || 28;
    const img_dpt = this.manifest.dots_per_track;
    
    const scale_factor = model_dpt / img_dpt;
    const img_patch = this.classifier.patch(img, screenCoords, this.classifier.spec.crop_size, scale_factor);

    if (img_patch) {
      // Setup Popup Container
      const mainContainer = this.shadowRoot?.querySelector('#debug-popup-container');
      if (mainContainer) {
        mainContainer.replaceChildren();
        (mainContainer as HTMLElement).style.display = 'block';
        (mainContainer as HTMLElement).style.left = `${event.clientX + 20}px`;
        (mainContainer as HTMLElement).style.top = `${event.clientY + 20}px`;
      }

      const classifyPromise = this.classifier.classify(img, screenCoords, img_dpt);
      
      classifyPromise.then((label) => {
        const resultDiv = document.createElement('div');
        resultDiv.style.background = '#e8f5e9';
        resultDiv.style.padding = '4px';
        resultDiv.innerHTML = label;
        this.shadowRoot?.querySelector('#debug-popup-container')?.appendChild(resultDiv);
      });

      this.shadowRoot?.querySelector('#debug-popup-container')?.appendChild(img_patch);
    }
  }

  private handleClick = (event: MouseEvent) => {
    // do not create label after dragging
    if (this.dragHandle === null) {
      // create a new marker
      const tool = this.activeTool;
      // Cannot create with delete tool or calibrate tool.
      // Calibrate tool is effectively "move only" for calibration handles.
      if (!tool || tool === 'delete') return;

      // check for debug tool
      if (tool === 'debug') {
        this.debugClick(event);
        return;
      }
      
      const category: MarkerCategory = 'label';
      const id = crypto.randomUUID();

      const screenCoords = this.toSVGPoint(event.clientX, event.clientY);
      this.manifest.setMarker(category, id, screenCoords.x, screenCoords.y, tool, this.imageIndex);
    } else {
      // finished dragging
      this.dragHandle = null;
    }
  };

  private handleMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement | SVGElement;
    const marker = target.closest('[id].label, [id].calibration');
    
    if (!marker) return;

    const id = marker.id;
    const classList = marker.classList;

    if (this.activeTool === 'delete') {
      if (classList.contains('label')) {
        this.manifest.deleteMarker('label', id, this.imageIndex);
      }
    } else {
      if (classList.contains('label')) {
        this.dragHandle = { id, category: 'label' };
      } else if (classList.contains('calibration')) {
        this.dragHandle = { id, category: 'calibration' };
      }
    }
  };

  // Removed showDebugPopup



  private handleMouseMove = (event: MouseEvent) => {
    if (!this.dragHandle) return;
    const screenCoords = this.toSVGPoint(event.clientX, event.clientY);

    if (this.dragHandle.category === 'calibration') {
      this.manifest.setMarker('calibration', this.dragHandle.id, screenCoords.x, screenCoords.y);
    } else {
      // Preserving the type is tricky here since we don't have it locally easily
      // unless we look it up, but setMarker merges so type should be preserved if passed undefined
      // However, setMarker signature currently expects type. Let's look it up.
      let type = 'track';
      if (
        this.manifest.images[this.imageIndex] &&
        this.manifest.images[this.imageIndex].labels[this.dragHandle.id]
      ) {
        type = this.manifest.images[this.imageIndex].labels[this.dragHandle.id].type;
      }

      this.manifest.setMarker(
        this.dragHandle.category,
        this.dragHandle.id,
        screenCoords.x,
        screenCoords.y,
        type,
        this.imageIndex,
      );
    }
  };
}