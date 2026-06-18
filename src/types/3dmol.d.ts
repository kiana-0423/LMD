export {};

declare global {
  interface Window {
    $3Dmol?: {
      createViewer: (element: HTMLElement, options?: Record<string, unknown>) => any;
    };
  }
}
