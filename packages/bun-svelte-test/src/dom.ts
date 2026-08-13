import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { installCheckedPseudoSupport } from './checked-pseudo';

export const DEFAULT_TEST_URL = 'http://localhost:3000/';

type ResetHook = () => void;

const resetHooks = new Set<ResetHook>();
const teardownHooks = new Set<ResetHook>();

export const registerResetHook = (hook: ResetHook): void => {
  resetHooks.add(hook);
};

export const registerTeardownHook = (hook: ResetHook): void => {
  teardownHooks.add(hook);
};

export const registerDom = (): void => {
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register({ url: DEFAULT_TEST_URL });
  }
  installCheckedPseudoSupport();
};

type HappyDomControl = { readonly setURL: (url: string) => void };

const happyDomControl = (): HappyDomControl | undefined =>
  (globalThis as { happyDOM?: HappyDomControl }).happyDOM;

export const resetDom = (): void => {
  if (!GlobalRegistrator.isRegistered) return;

  for (const hook of teardownHooks) hook();

  const active = document.activeElement as HTMLElement | null;
  if (active !== null && active !== document.body && typeof active.blur === 'function') {
    active.blur();
  }

  document.body.innerHTML = '';
  for (const name of [...document.body.getAttributeNames()]) {
    document.body.removeAttribute(name);
  }

  for (const child of [...document.head.children]) {
    if (child.tagName !== 'STYLE') child.remove();
  }

  localStorage.clear();
  sessionStorage.clear();

  happyDomControl()?.setURL(DEFAULT_TEST_URL);

  for (const hook of resetHooks) hook();
};
