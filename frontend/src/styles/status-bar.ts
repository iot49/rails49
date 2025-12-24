import { css } from 'lit';

export const statusBarStyles = css`
  .status-bar {
    display: flex;
    gap: 1rem;
    align-items: center; 
    color: var(--sl-color-neutral-0);
    font-family: var(--sl-font-sans);
    font-size: var(--sl-font-size-small);
    font-weight: var(--sl-font-weight-normal);
    line-height: var(--sl-line-height-normal);
    height: var(--sl-input-height-medium);
  }
  
  .status-bar span {
    display: inline-flex;
    align-items: center;
  }
`;
