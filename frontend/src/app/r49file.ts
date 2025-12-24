import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { createContext } from '@lit/context';
import { Manifest } from './manifest.ts';

export const r49FileContext = createContext<R49File>('r49File');


/**
 * R49File serves as the root container for a project's state.
 * 
 * It manages:
 * 1. The `Manifest`: JSON metadata for layout, calibration, and labels.
 * 2. The `R49Image` list: Binary image data managed as blobs.
 * 
 * Lifecycle & Reactivity:
 * This class uses an immutable-update pattern for Lit integration.
 * - When `manifest` or `images` change, it emits `r49-file-changed`.
 * - To trigger a full UI refresh (because Lit detects changes by reference),
 *   the `RrMain` component creates a NEW `R49File` instance using the copy-constructor.
 * 
 * Resource Sharing:
 * When copying to a new instance, the underlying `Manifest` and `R49Image` objects
 * are SHARED/TRANSFERRED, not cloned.
 * The `detach()` method is used to remove listeners from the old instance WITHOUT
 * closing the images, preventing double-free errors.
 * 
 * `dispose()` should only be called when completely closing the file/APP.
 */
export class R49File extends EventTarget {
    private _manifest: Manifest;
    private _images: R49Image[];

    /**
     * Creates a new R49File.
     * @param other Optional previous instance to copy state from.
     *              If provided, resources (images) are shared/transferred.
     */
    constructor(other?: R49File) {
        super();
        
        let m: Manifest | undefined;
        try {
             m = other?.manifest;
        } catch (e) {
             console.warn("Failed to retrieve manifest from previous R49File instance", e);
        }

        this._manifest = m || new Manifest();
        // Shallow copy of image list (transferring ownership of the array container).
        // The Images themselves are reference types and are shared between the old and new instances.
        this._images = (other && other.images) ? [...other.images] : [];
        this._attachManifestListener();
    }

    // =========================================================================
    // Public API
    // =========================================================================

    public get manifest(): Manifest {
        return this._manifest;
    }

    /**
     * Detaches internal listeners, preparing this instance for garbage collection,
     * BUT leaves the underlying resources (images) alive.
     * Use this when transferring state to a new `R49File` instance.
     */
    public detach() {
        this._detachManifestListener();
    }

    /**
     * Fully disposes of this file and ALL its resources.
     * Use this only when closing the application or loading a completely new file.
     */
    public dispose() {
        this._detachManifestListener();
        this._images.forEach(img => img.dispose());
    }

    public getImageUrl(index: number): string | undefined {
        if (index < 0 || index >= this._images.length) return undefined;
        return this._images[index].objectURL;
    }

    public getImageBitmap(index: number): Promise<ImageBitmap | undefined> {
        if (index < 0 || index >= this._images.length) return Promise.resolve(undefined);
        return this._images[index].bitmap;
    }

    /**
     * Loads an .r49 (zip) file.
     * Extracts `manifest.json` and images, creating new `Manifest` and `R49Image` objects.
     */
    public async load(file: File) {
        const reader = new FileReader();
    
        return new Promise<void>((resolve, reject) => {
            reader.onload = async (e) => {
                try {
                    const zip = await JSZip.loadAsync(e.target?.result as ArrayBuffer);
                    const imagePromiseList: Promise<R49Image>[] = [];
                    let manifestFileContent: Promise<string> | undefined;
                    
                    zip.forEach((relativePath, zipEntry) => {
                        if (relativePath.startsWith('image')) {
                            // Extract extension, infer mime type
                            const parts = relativePath.split('.');
                            const extension = parts.length > 1 ? parts[parts.length - 1] : 'jpeg';
                            const mimeType = `image/${extension}`;
                            
                            const imagePromise = zipEntry.async('blob').then(blob => {
                                const typedBlob = new Blob([blob], { type: mimeType });
                                return new R49Image(typedBlob, relativePath);
                            });
                            imagePromiseList.push(imagePromise);
                        } else if (relativePath === 'manifest.json') {
                            manifestFileContent = zipEntry.async('string');
                        }
                    });

                    if (imagePromiseList.length > 0 && manifestFileContent) {
                        const manifestJson = await manifestFileContent;
                        const manifestData = JSON.parse(manifestJson);
                        
                        const images = await Promise.all(imagePromiseList);
                        
                        // Robust sort by filename
                        images.sort((a, b) => {
                            const numA = parseInt(a.name.match(/image-(\d+)/)?.[1] || '0');
                            const numB = parseInt(b.name.match(/image-(\d+)/)?.[1] || '0');
                            return numA - numB;
                        });

                        this._detachManifestListener();
                        this._manifest = new Manifest(manifestData);
                        this._attachManifestListener();
                        
                        // Dispose old images
                        this._images.forEach(img => img.dispose());
                        this._images = images;
                        
                        this._emitChange('load');
                        resolve();
                    } else {
                        reject(new Error('Invalid .r49 file: missing image or manifest.json'));
                    }
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Saves the current state as an .r49 (zip) file.
     * Bundles `manifest.json` and all image blobs.
     */
    public async save() {
        if (this._images.length === 0) return;

        const zip = new JSZip();
        const imageFilenames: string[] = [];

        this._images.forEach((img, i) => {
            let extension = 'jpeg';
            const parts = img.name.split('.');
            if (parts.length > 1) extension = parts[parts.length - 1];
            else if (img.blob.type) {
                const typeParts = img.blob.type.split('/');
                if (typeParts.length > 1) extension = typeParts[1];
            }

            const imageName = `image-${i}.${extension}`;
            zip.file(imageName, img.blob);
            imageFilenames.push(imageName);
        });

        const images = imageFilenames.map((filename, index) => {
            const existingImage = this._manifest.images[index];
            return {
                filename: filename,
                labels: existingImage ? existingImage.labels : {},
            };
        });

        this._manifest.setImages(images);
        zip.file('manifest.json', this._manifest.toJSON());

        const content = await zip.generateAsync({ type: 'blob' });
        const name = this._manifest.layout.name || 'layout';
        const filename = `${name}.r49`;
        saveAs(content, filename);
    }

    /**
     * Adds an image file with validation.
     * 
     * Validates that the image dimensions match existing images (or sets dimensions if first image).
     * Extracts the name from the file.
     * 
     * @throws Error if dimensions do not match.
     */
    public async addImageValidated(file: File): Promise<void> {
        return new Promise((resolve, reject) => {
            const objectURL = URL.createObjectURL(file);
            const img = new Image();
            
            img.onload = () => {
                // Validation: Only if we already have images
                if (this._images.length > 0) {
                    const currentWidth = this._manifest.camera.resolution.width;
                    const currentHeight = this._manifest.camera.resolution.height;
                    
                    if (img.width !== currentWidth || img.height !== currentHeight) {
                        URL.revokeObjectURL(objectURL);
                        reject(new Error(
                            `New image dimensions (${img.width}x${img.height}) must match existing images (${currentWidth}x${currentHeight}).`
                        ));
                        return;
                    }
                }

                // Update manifest dimensions (idempotent if already set)
                this._manifest.setImageDimensions(img.width, img.height);

                // Use filename without extension as name
                const name = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                
                this.add_image(file, name);
                
                // Cleanup temp url
                URL.revokeObjectURL(objectURL);
                resolve();
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectURL);
                reject(new Error("Failed to load image for validation."));
            };

            img.src = objectURL;
        });
    }

    /**
     * Adds a new image Blob to the file.
     * Updates the manifest to include the new image metadata.
     */
    public add_image(blob: Blob, name: string) {
        const newImage = new R49Image(blob, name);
        this._images.push(newImage);
        
        // Sync manifest
        const currentImages = this._manifest.images;
        const newIndex = this._images.length - 1; // 0-based index matches array length - 1
        // We use a placeholder filename which will be fixed on save
        const newImageEntry = { filename: `image-${newIndex}`, labels: {} };
        this._manifest.setImages([...currentImages, newImageEntry]);
        
        this._emitChange('images');
    }

    /**
     * Removes an image by index.
     * Disposes of the image resources and updates the manifest.
     */
    public remove_image(index: number) {
        if (index < 0 || index >= this._images.length) return;
        
        const removed = this._images.splice(index, 1);
        removed.forEach(img => img.dispose());

        // Sync manifest
        const currentImages = [...this._manifest.images];
        if (index < currentImages.length) {
            currentImages.splice(index, 1);
            this._manifest.setImages(currentImages);
        }
        this._emitChange('images');
    }

    // =========================================================================
    // Private Details
    // =========================================================================

    // Internal getter for copy-constructor usage
    private get images(): R49Image[] {
        return this._images;
    }

    private set manifest(m: Manifest) {
        this._detachManifestListener();
        this._manifest = m;
        this._attachManifestListener();
        this._emitChange('manifest');
    }

    private set images(imgs: R49Image[]) {
        this._images = imgs;
        this._emitChange('images');
    }

    private _attachManifestListener() {
        this._manifest.addEventListener('rr-manifest-changed', this._onManifestChange);
    }

    private _detachManifestListener() {
        this._manifest.removeEventListener('rr-manifest-changed', this._onManifestChange);
    }

    private _onManifestChange = (e: Event) => {
        // Forward event
        this.dispatchEvent(new CustomEvent('r49-file-changed', {
            detail: { type: 'manifest', originalEvent: e }
        }));
    }

    private _emitChange(type: string) {
        this.dispatchEvent(new CustomEvent('r49-file-changed', {
            detail: { type }
        }));
    }
}

/**
 * R49Image wraps raw image data (Blob) and manages its lifecycle.
 * 
 * It provides lazy access to:
 * - `objectURL`: synchronous URL string for `<img>` tags.
 * - `bitmap`: asynchronous ImageBitmap for canvas drawing / inference.
 * 
 * Resources must be manually released via `dispose()`.
 */
class R49Image {
    private _blob: Blob;
    private _name: string;
    private _objectURL: string | null = null;
    private _bitmap: ImageBitmap | null = null;

    constructor(blob: Blob, name: string) {
        this._blob = blob;
        this._name = name;
    }

    get name(): string { return this._name; }

    /**
     * The raw Blob data.
     * Required by `R49File.save()` to serialize the image data into the ZIP file.
     * Also useful if consumers need to upload the raw image.
     */
    get blob(): Blob { return this._blob; }
    
    get objectURL(): string {
        if (!this._objectURL) {
            this._objectURL = URL.createObjectURL(this._blob);
        }
        return this._objectURL;
    }

    get bitmap(): Promise<ImageBitmap> {
        if (!this._bitmap) {
             return createImageBitmap(this._blob).then(bm => {
                 this._bitmap = bm;
                 return bm;
             });
        }
        return Promise.resolve(this._bitmap);
    }

    /**
     * Cleans up valid browser resources.
     * 
     * WHY MANUAL DISPOSAL?
     * 1. objectURL: Created via `URL.createObjectURL()`. This tells the browser to keep
     *    a reference to the Blob in memory, accessible via the returned string.
     *    CRITICAL: This reference exists until the document is unloaded or `revokeObjectURL`
     *    is explicitly called. Even if the `<img>` tag in `rr-layout-editor` switches to
     *    a new src, or the `R49Image` JS object is garbage collected, the BROWSER still
     *    holds the Blob in memory because the string URL is theoretically still valid.
     *    We must manually sever this link to free the memory.
     * 2. bitmap: ImageBitmap objects hold GPU/heavy memory. Explicit closing is
     *    recommended to prevent memory pressure in heavy applications.
     */
    dispose() {
        if (this._objectURL) {
            URL.revokeObjectURL(this._objectURL);
            this._objectURL = null;
        }
        if (this._bitmap) {
            this._bitmap.close();
            this._bitmap = null;
        }
    }
}
