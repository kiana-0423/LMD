import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

if (typeof window !== "undefined") {
  /**
   * A 2D context that measures nothing and draws nothing.
   *
   * jsdom does not implement `getContext`, and every call prints a paragraph of "Not implemented"
   * to the test output. ECharts asks for one to measure text, Ketcher's renderer asks for one to
   * lay out bonds; neither is being tested here, and neither needs a real answer.
   *
   * This is a stub, not a suppression: it returns an object with the handful of methods those
   * libraries call, so the code under test takes its normal path instead of a `null`-context
   * error branch. A test that genuinely needs pixels would have to install a real canvas, and
   * would not be a jsdom test.
   */
  const noop = () => undefined;
  const stubContext = {
    canvas: null as unknown as HTMLCanvasElement,
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillText: noop,
    strokeText: noop,
    fillRect: noop,
    clearRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    save: noop,
    restore: noop,
    scale: noop,
    rotate: noop,
    translate: noop,
    transform: noop,
    setTransform: noop,
    drawImage: noop,
    setLineDash: noop,
    getLineDash: () => [] as number[],
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(Math.max(1, width * height * 4)),
      width,
      height
    }),
    putImageData: noop,
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(Math.max(1, width * height * 4)),
      width,
      height
    })
  };
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    return { ...stubContext, canvas: this };
  } as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,";

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });

  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => getComputedStyle(element);
}
