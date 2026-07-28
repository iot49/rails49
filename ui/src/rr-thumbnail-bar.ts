import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/**
 * Horizontal strip of image thumbnails for selecting and managing layout images.
 * 
 * @fires rr-image-select - When a thumbnail is clicked. Detail: { index: number }
 * @fires rr-image-delete - When the delete button on a thumbnail is clicked. Detail: { index: number }
 * @fires rr-image-add - When an add button is clicked. Detail: { source: 'camera' | 'file' }
 */
@customElement('rr-thumbnail-bar')
export class RRThumbnailBar extends LitElement {
  @property({ type: Array }) images: string[] = [];
  @property({ type: Number }) selectedIndex = -1;

  @state() private _draggedIndex: number | null = null;
  @state() private _dropIndex: number | null = null;

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      height: 80px;
      padding: 0 1rem;
      gap: 1rem;
      background-color: #1a1a1a;
      border-bottom: 1px solid #333;
      overflow-x: auto;
      user-select: none;
    }

    /* Hide scrollbar but allow scrolling */
    :host::-webkit-scrollbar {
      height: 4px;
    }
    :host::-webkit-scrollbar-thumb {
      background: #444;
      border-radius: 2px;
    }

    .thumbnail-wrapper {
      position: relative;
      flex-shrink: 0;
      width: 64px;
      height: 64px;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border: 2px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      background: #000;
      transition: border-color 0.2s;
    }

    img.active {
      border-color: var(--sl-color-primary-500);
    }

    .delete-btn {
      position: absolute;
      top: -6px;
      right: -6px;
      width: 20px;
      height: 20px;
      background-color: var(--sl-color-danger-600);
      color: white;
      border-radius: 50%;
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      z-index: 10;
    }

    .thumbnail-wrapper:hover .delete-btn {
      display: flex;
    }

    .add-btn {
      flex-shrink: 0;
      width: 64px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px dashed #444;
      border-radius: 4px;
      color: #888;
      cursor: pointer;
      font-size: 1.5rem;
      transition: all 0.2s;
    }

    .add-btn:hover {
      border-color: var(--sl-color-primary-500);
      color: var(--sl-color-primary-500);
      background: #222;
    }

    .thumbnail-wrapper.dragging {
      opacity: 0.4;
    }

    .thumbnail-wrapper.drop-target {
      outline: 2px solid var(--sl-color-primary-500);
      outline-offset: 2px;
      border-radius: 4px;
    }
  `;

  private _onSelect(index: number) {
    this.dispatchEvent(new CustomEvent('rr-image-select', {
      detail: { index },
      bubbles: true,
      composed: true
    }));
  }

  private _onDelete(e: Event, index: number) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('rr-image-delete', {
      detail: { index },
      bubbles: true,
      composed: true
    }));
  }

  private _onAdd(source: 'camera' | 'file') {
    this.dispatchEvent(new CustomEvent('rr-image-add', {
      detail: { source },
      bubbles: true,
      composed: true
    }));
  }

  private _onDragStart(e: DragEvent, index: number) {
    this._draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
    }
  }

  private _onDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    if (this._draggedIndex === null || this._draggedIndex === index) return;
    this._dropIndex = index;
  }

  private _onDragLeave() {
    this._dropIndex = null;
  }

  private _onDrop(e: DragEvent, index: number) {
    e.preventDefault();
    this._dropIndex = null;
    if (this._draggedIndex === null || this._draggedIndex === index) {
      this._draggedIndex = null;
      return;
    }

    this.dispatchEvent(new CustomEvent('rr-image-reorder', {
      detail: { from: this._draggedIndex, to: index },
      bubbles: true,
      composed: true
    }));

    this._draggedIndex = null;
  }

  private _onDragEnd() {
    this._draggedIndex = null;
    this._dropIndex = null;
  }

  render() {
    return html`
      ${this.images.map((url, index) => html`
        <div 
          class="thumbnail-wrapper ${this._draggedIndex === index ? 'dragging' : ''} ${this._dropIndex === index ? 'drop-target' : ''}"
          draggable="true"
          @dragstart=${(e: DragEvent) => this._onDragStart(e, index)}
          @dragover=${(e: DragEvent) => this._onDragOver(e, index)}
          @dragleave=${this._onDragLeave}
          @drop=${(e: DragEvent) => this._onDrop(e, index)}
          @dragend=${this._onDragEnd}
        >
          <sl-tooltip content="Switch to image">
            <img 
              src="${url}" 
              class="${index === this.selectedIndex ? 'active' : ''}"
              @click=${() => this._onSelect(index)}
              alt="Thumbnail ${index + 1}"
            />
          </sl-tooltip>
          <div class="delete-btn" @click=${(e: Event) => this._onDelete(e, index)}>
            <sl-icon name="x-lg"></sl-icon>
          </div>
        </div>
      `)}

      <sl-tooltip content="Capture from Camera">
        <div class="add-btn" @click=${() => this._onAdd('camera')}>
          <sl-icon name="camera"></sl-icon>
        </div>
      </sl-tooltip>

      <sl-tooltip content="Add Image from File">
        <div class="add-btn" @click=${() => this._onAdd('file')}>
          <sl-icon name="folder-plus"></sl-icon>
        </div>
      </sl-tooltip>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-thumbnail-bar': RRThumbnailBar;
  }
}
