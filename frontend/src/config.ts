export const TITLE = 'RR Labeler';

export const DEFAULT_MODEL = 'resnet18';
export const DEFAULT_PRECISION = 'fp32';

export const MODEL_LIST = [
  'resnet18',
  'mobilenetV2',
];

export const PRECISION_OPTIONS = [
  'fp32',
  'fp16', 
  'int8',
];

export const STANDARD_GAUGE = 1435; // spacing of standard railroad tracks (in Switzerland) [mm]
export const DEFAULT_SCALE = 87;  // HO scale

export const MARKER_SIZE_PX = 36;
export const LIVE_MARKER_SIZE = 80;

// Drag handle configuration
export const DRAG_HANDLE_VISUAL_RADIUS = 0.1; // Visible size
export const DRAG_HANDLE_INTERACTION_RADIUS = 2; // Larger interaction area

export const WIDTH_COLOR = 'red';
export const HEIGHT_COLOR = 'blue';

export const CAMERA_PARAMS = {
  facingMode: 'environment',
  width: { ideal: 4096 },
  height: { ideal: 2160 },
}
