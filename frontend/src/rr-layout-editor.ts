import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';

import { captureImage } from './app/capture.ts';


import { R49File, r49FileContext } from './app/r49file.ts';

import { layoutEditorStyles } from './styles/layout-editor.ts';

import { statusBarStyles } from './styles/status-bar.ts';

/* Layout Editor handles status bar, tool selection, image carousel, and layout image via rr-label */

@customElement('rr-layout-editor')
export class RrLayoutEditor extends LitElement {
  @consume({ context: r49FileContext, subscribe: true })
  r49File!: R49File;

  get manifest() {
    return this.r49File?.manifest;
  }

  get images(): { filename: string, labels: any }[] {
    return this.manifest?.images || [];
  }

  @state()
  currentImageIndex: number = -1;

  @state()
  activeTool: string | null = null;

  static styles = [
    statusBarStyles,
    layoutEditorStyles
  ];

  protected async firstUpdated() {
    try {
      if (this.images.length > 0) return;

      // Load default demo.r49 from server (not disk) if no images are present in R49File
      const response = await fetch('demo.r49');
      if (!response.ok) return;
      const blob = await response.blob();
      const file = new File([blob], 'demo.r49', { type: 'application/zip' });
      this._load_r49(file);
    } catch (e) {
      console.warn('Failed to load demo.r49', e);
    }
  }

  render() {
    // If manifest hasn't loaded (unlikely since it's prop), handle gracefully
    if (!this.manifest) return html``;

    // Editor Mode Status
    const layout = this.manifest.layout;
    const dpt = this.manifest.dots_per_track;
    const statusTemplate = html`
      <div slot="status" class="status-bar">
          <span style="font-weight: bold; font-size: var(--sl-font-size-medium);">${layout.name || 'Untitled Layout'}</span>
          <span>Scale: ${layout.scale}</span>
          <span>Size: ${layout.size.width || '?'}x${layout.size.height || '?'} mm</span>
          <span>Resolution: ${dpt > 0 ? dpt + ' dpt' : 'Not Calibrated'}</span>
      </div>
    `;

    return html`
      <rr-page>
        ${statusTemplate}
        <div class="container">
          <nav>${this._fileToolsTemplate()} ${this._labelToolsTemplate()}</nav>
          <div class="main-content">
          ${this._thumbnailBarTemplate()}
          <main>
            ${this.currentImageIndex >= 0
            ? this._renderMainContent()
            : html``}
          </main>
          </div>
        </div>
      </rr-page>
    `;
  }

  private _fileToolsTemplate() {
    return html`
      <div class="toolbar-group">
        ${this._renderToolButton('Upload Image', 'folder2-open', 'open', false)},
        ${this._renderToolButton('Save Image', 'floppy', 'save', this.currentImageIndex < 0)}
      </div>
    `;
  }

  private _thumbnailBarTemplate() {
    return html`
      <div class="thumbnails">
        ${this.images.map(
          (_, index) => html`
            <div class="thumbnail-wrapper">
              <img
                src="${this.r49File.getImageUrl(index)}"
                class="thumbnail ${index === this.currentImageIndex ? 'active' : ''}"
                @click=${() => (this.currentImageIndex = index)}
              />
              <div class="delete-btn" @click=${(e: Event) => this._handleDeleteImage(e, index)}>
                <sl-icon name="x-lg"></sl-icon>
              </div>
            </div>
          `,
        )}
        <div class="add-image-btn" @click=${() => this._handleAddImageClick('camera')}>
          <sl-icon name="camera"></sl-icon>
        </div>
        <div class="add-image-btn" @click=${() => this._handleAddImageClick('file')}>
          <sl-icon name="folder-plus"></sl-icon>
        </div>
      </div>
    `;
  }

  private _labelToolsTemplate() {
    // Safety check if manifest is undefined (should come from prop)
    const disabled = this.currentImageIndex < 0 || !this.manifest?.layout?.size?.width || !this.manifest?.layout?.size?.height;

    return html` <div class="toolbar-group">
      ${this._renderToolButton('Label as Other', 'question-circle', 'other', disabled)}
      ${this._renderToolButton('Label as Track', 'sign-railroad', 'track', disabled)}
      ${this._renderToolButton('Label as Train Car', 'truck-front', 'train', disabled)}
      ${this._renderToolButton(
      'Label as Train Front/Back',
      'arrow-bar-right',
      'train-end',
      disabled,
    )}
      ${this._renderToolButton(
      'Label as Train Coupling',
      'arrows-collapse-vertical',
      'coupling',
      disabled,
    )}
      ${this._renderToolButton('Delete Label', 'trash3', 'delete', disabled)}
      ${this._renderToolButton('Debug (Log Coordinates)', 'check-circle', 'debug', disabled)}
    </div>`;
  }

  private _renderToolButton(toolTip: string, name: string, tool_id: string, disabled: boolean) {
    return html`
      <sl-tooltip content=${toolTip}>
        <sl-icon-button
          name=${name}
          style="font-size: 2em; color: white;"
          @click=${() => this._handleToolClick(tool_id)}
          ?disabled=${disabled}
          class=${this.activeTool === tool_id ? 'active-tool' : ''}
        ></sl-icon-button>
      </sl-tooltip>
    `;
  }

  private async _handleToolClick(tool_id: string) {
    switch (tool_id) {
      case 'open': {
        this.activeTool = null;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.r49,application/zip,.zip';
        input.onchange = this._handleChooseFile.bind(this);
        input.click();
        break;
      }
      case 'save': {
        this.r49File.save();
        break;
      }
      default: {
        this.activeTool = tool_id;
        break;
      }
    }
  }

  private _renderMainContent() {
    // Default view
    return html` <rr-label
      .imageIndex=${this.currentImageIndex}
      .activeTool=${this.activeTool}
    ></rr-label>`;
  }

  private async _load_r49(file: File) {
    try {
      await this.r49File.load(file);
      this.currentImageIndex = 0;
    } catch (e) {
      alert(`Error loading file: ${(e as Error).message}`);
      console.error(e);
    }
  }

  private async _load_imgfile(file: File) {
    try {
        await this.r49File.addImageValidated(file);
        // Switch to the new image
        const newIndex = this.images.length - 1;
        this.currentImageIndex = newIndex;
    } catch (e) {
        alert((e as Error).message);
    }
  }

  private _handleChooseFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      file.name.toLowerCase().endsWith('.r49') ? this._load_r49(file) : this._load_imgfile(file);
    }
  }

  private async _performInstantCapture() {
    const file = await captureImage();
    if (file) {
      this._load_imgfile(file);
    }
  }

  private _handleAddImageClick(source: 'camera' | 'file') {
    if (source === 'camera') {
      this._performInstantCapture();
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg, image/jpg, image/png';
      input.onchange = (e) => this._handleChooseFile(e);
      input.click();
    }
  }

  private _handleDeleteImage(e: Event, index: number) {
    e.stopPropagation(); // Prevent selecting the image when deleting

    // Remove image from array
    this.r49File.remove_image(index);
    // Context update handles re-render

    // Update index if needed
    if (this.currentImageIndex > index) {
      this.currentImageIndex--;
    } else if (this.currentImageIndex >= this.images.length) {
      this.currentImageIndex = this.images.length - 1;
    } else if (this.currentImageIndex === index) {
      // If we deleted the current image, safety check (handled by length check above mostly, but good for clarity)
      this.currentImageIndex = Math.max(0, this.currentImageIndex - 1);
      if (this.images.length === 1) this.currentImageIndex = 0;
    }

    // If no images left, reset
    if (this.images.length === 0) {
      this.currentImageIndex = -1;
    }
  }
}
