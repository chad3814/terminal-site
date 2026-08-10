import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

if (!("PointerEvent" in window)) {
  Object.defineProperty(window, "PointerEvent", {
    value: PointerEventPolyfill,
    writable: true,
    configurable: true,
  });
}

if (Element.prototype.setPointerCapture === undefined) {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {};
}

afterEach(() => {
  cleanup();
});
