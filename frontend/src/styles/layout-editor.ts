import { css } from 'lit';

export const layoutEditorStyles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      overflow: hidden;
      min-height: 0;
    }

    .container {
      display: flex;
      flex-grow: 1;
    }

    nav {
      width: 60px; /* Adjust as needed for toolbar width */
      background-color: var(--sl-color-success-800);
      padding: 1em;
      box-shadow: 2px 0 4px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start; /* Align toolbar items to the top */
      gap: 1em; /* Space between groups */
    }

    .toolbar-group {
      display: flex;
      flex-direction: column;
      gap: 0.5em; /* Space between buttons in a group */
      padding: 0.5em;
      border-radius: var(--sl-border-radius-medium);
      background-color: var(--sl-color-success-700); /* Slightly darker background for grouping */
    }

    .active-tool {
      border: 2px solid var(--sl-color-warning-500); /* Highlight active tool */
      border-radius: var(--sl-border-radius-medium);
    }

    main {
      flex-grow: 1;
      padding: 0;
      display: flex;
      flex-direction: column;
      overflow: auto;
      min-height: 0;
      position: relative;
    }

    /* Thumbnail bar styles */
    .thumbnails {
      height: 70px;
      display: flex;
      align-items: center;
      padding: 0 0.5em;
      gap: 0.5em;
      overflow-x: auto;
      background-color: var(--sl-color-neutral-100);
      border-bottom: 1px solid var(--sl-color-neutral-200);
      flex-shrink: 0;
    }

    .thumbnail-wrapper {
      position: relative;
      display: inline-block;
    }

    .thumbnail {
      width: 60px;
      height: 60px;
      border: 2px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      object-fit: contain;
      background-color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .thumbnail.active {
      border-color: var(--sl-color-primary-600);
    }

    .delete-btn {
      position: absolute;
      top: -5px;
      right: -5px;
      width: 20px;
      height: 20px;
      background-color: var(--sl-color-danger-600);
      color: white;
      border-radius: 50%;
      display: none; /* Hidden by default */
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 12px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .thumbnail-wrapper:hover .delete-btn {
      display: flex; /* Show on hover */
    }

    .add-image-btn {
      width: 60px;
      height: 60px;
      border: 2px dashed var(--sl-color-neutral-400);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--sl-color-neutral-400);
      font-size: 2em;
    }

    .add-image-btn:hover {
      border-color: var(--sl-color-primary-600);
      color: var(--sl-color-primary-600);
    }

    .main-content {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      overflow: hidden;
      min-height: 0;
    }

    rr-label {
      display: block;
    }
`;
