declare module 'opencv.js' {
  export interface OpenCV {
    onRuntimeInitialized?: () => void;
    imread: (imageElement: HTMLImageElement | HTMLCanvasElement | string) => Mat;
    imshow: (canvasElement: HTMLCanvasElement, mat: Mat) => void;
    matFromArray: (rows: number, cols: number, type: number, array: number[]) => Mat;
    getPerspectiveTransform: (src: Mat, dst: Mat) => Mat;
    warpPerspective: (
      src: Mat,
      dst: Mat,
      M: Mat,
      dsize: Size,
      flags?: number,
      borderMode?: number,
      borderValue?: Scalar,
    ) => void;
    resize: (
      src: Mat,
      dst: Mat,
      dsize: Size,
      fx?: number,
      fy?: number,
      interpolation?: number,
    ) => void;

    // Constants
    CV_32FC2: number;
    INTER_LINEAR: number;
    BORDER_CONSTANT: number;

    // Classes
    Mat: new () => Mat;
    Size: new (width: number, height: number) => Size;
    Scalar: new (...values: number[]) => Scalar;
  }

  export interface Mat {
    delete(): void;
  }

  export interface Size {
    width: number;
    height: number;
  }

  export interface Scalar {
    // Scalar properties/methods if needed
  }

  const cv: OpenCV;
  export default cv;
}

declare global {
  const cv: import('opencv.js').OpenCV;
}
