/**
 * jsdom gaps that Radix popper/menus/tooltips touch. Import at the top of a test file:
 *   import '@/components/ui/test-polyfills';
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const g = globalThis as unknown as Record<string, unknown>;
if (!g.ResizeObserver) g.ResizeObserver = ResizeObserverStub;

if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};

  // floating-ui (Radix popper) probes `el.matches(':popover-open')` / `':modal'` on every
  // ancestor for every position update. jsdom's selector engine throws on those pseudo-classes,
  // and the throw is slow enough that opening one menu blocks the event loop for seconds.
  // Answer them directly (nothing is in the top layer in jsdom).
  const flag = '__rcFastTopLayer';
  if (!proto[flag]) {
    const original = Element.prototype.matches;
    Element.prototype.matches = function matches(this: Element, selector: string) {
      if (selector === ':popover-open' || selector === ':modal') return false;
      return original.call(this, selector);
    };
    proto[flag] = true;
  }
}

export {};
