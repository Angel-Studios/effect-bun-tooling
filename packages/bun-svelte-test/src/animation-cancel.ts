import Animation from 'happy-dom/lib/animation/Animation.js';

const ignoreRejection = (): void => {};

let installed = false;

// The Web Animations standard rejects the `finished` promise of a canceled animation, and it
// sets [[PromiseIsHandled]] on that promise. happy-dom 21 omits that step. So a `cancel()` with
// no reader of `finished` gives an unhandled rejection, and bun fails the running test.
// https://www.w3.org/TR/web-animations-1/#canceling-an-animation-section
export const installAnimationCancelSupport = (): void => {
  if (installed) return;
  installed = true;

  const original = Animation.prototype.cancel;

  Animation.prototype.cancel = function patchedCancel(this: Animation): void {
    this.finished.catch(ignoreRejection);
    original.call(this);
  };
};
