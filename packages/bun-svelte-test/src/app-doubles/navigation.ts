import { mock } from 'bun:test';

type NavigationTarget = { readonly url: URL; readonly params: Record<string, string> | null };
type BeforeNavigateCallback = (navigation: unknown) => void;
type AfterNavigateCallback = (navigation: unknown) => void;
type OnNavigateCallback = (navigation: unknown) => void | Promise<void>;

const gotoImpl = async (_url: string | URL, _options?: Record<string, unknown>): Promise<void> => {};
const invalidateImpl = async (_resource: string | URL | ((url: URL) => boolean)): Promise<void> => {};
const invalidateAllImpl = async (): Promise<void> => {};
const preloadDataImpl = async (
  _href: string,
): Promise<{ type: 'loaded'; status: number; data: Record<string, unknown> }> => ({
  type: 'loaded',
  status: 200,
  data: {},
});
const preloadCodeImpl = async (..._pathnames: string[]): Promise<void> => {};
const pushStateImpl = (_url: string | URL, _state: Record<string, unknown>): void => {};
const replaceStateImpl = (_url: string | URL, _state: Record<string, unknown>): void => {};
const beforeNavigateImpl = (_callback: BeforeNavigateCallback): void => {};
const afterNavigateImpl = (_callback: AfterNavigateCallback): void => {};
const onNavigateImpl = (_callback: OnNavigateCallback): void => {};

export const goto = mock(gotoImpl);
export const invalidate = mock(invalidateImpl);
export const invalidateAll = mock(invalidateAllImpl);
export const preloadData = mock(preloadDataImpl);
export const preloadCode = mock(preloadCodeImpl);
export const pushState = mock(pushStateImpl);
export const replaceState = mock(replaceStateImpl);
export const beforeNavigate = mock(beforeNavigateImpl);
export const afterNavigate = mock(afterNavigateImpl);
export const onNavigate = mock(onNavigateImpl);

export type NavigationTargetDouble = NavigationTarget;

const stubs = [
  [goto, gotoImpl],
  [invalidate, invalidateImpl],
  [invalidateAll, invalidateAllImpl],
  [preloadData, preloadDataImpl],
  [preloadCode, preloadCodeImpl],
  [pushState, pushStateImpl],
  [replaceState, replaceStateImpl],
  [beforeNavigate, beforeNavigateImpl],
  [afterNavigate, afterNavigateImpl],
  [onNavigate, onNavigateImpl],
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous mock signatures in one table
] as ReadonlyArray<readonly [{ mockClear: () => void; mockImplementation: (fn: any) => void }, any]>;

export const capturedNavigationCalls = (): Record<string, readonly unknown[][]> => ({
  goto: goto.mock.calls,
  invalidate: invalidate.mock.calls,
  invalidateAll: invalidateAll.mock.calls,
  preloadData: preloadData.mock.calls,
  preloadCode: preloadCode.mock.calls,
  pushState: pushState.mock.calls,
  replaceState: replaceState.mock.calls,
  beforeNavigate: beforeNavigate.mock.calls,
  afterNavigate: afterNavigate.mock.calls,
  onNavigate: onNavigate.mock.calls,
});

export const resetNavigation = (): void => {
  for (const [mocked, implementation] of stubs) {
    mocked.mockClear();
    mocked.mockImplementation(implementation);
  }
};
