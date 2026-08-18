import * as Effect from 'effect/Effect';
import { DEFAULT_TEST_URL } from '../dom.ts';

export type PageDouble = {
  url: URL;
  params: Record<string, string>;
  route: { id: string | null };
  status: number;
  error: Error | null;
  data: Record<string, unknown>;
  form: unknown;
  state: Record<string, unknown>;
};

export type NavigatingDouble = {
  from: { url: URL; params: Record<string, string> } | null;
  to: { url: URL; params: Record<string, string> } | null;
  type: string | null;
  willUnload: boolean;
  delta: number | null;
  complete: Promise<void> | null;
};

export type UpdatedDouble = {
  current: boolean;
  check: () => Promise<boolean>;
};

const defaultPage = (): PageDouble => ({
  url: new URL(DEFAULT_TEST_URL),
  params: {},
  route: { id: null },
  status: 200,
  error: null,
  data: {},
  form: null,
  state: {},
});

const defaultNavigating = (): NavigatingDouble => ({
  from: null,
  to: null,
  type: null,
  willUnload: false,
  delta: null,
  complete: null,
});

// `$app/state`'s `updated.check()` returns a promise; the double never reports
// an update, so its Effect is a constant run at that boundary.
const defaultCheck = (): Promise<boolean> => Effect.runPromise(Effect.succeed(false));

export const page: PageDouble = defaultPage();
export const navigating: NavigatingDouble = defaultNavigating();
export const updated: UpdatedDouble = {
  current: false,
  check: defaultCheck,
};

export type SetPageInput = Omit<Partial<PageDouble>, 'url'> & { url?: URL | string };

export const setPage = (partial: SetPageInput): void => {
  const { url, ...rest } = partial;
  Object.assign(page, rest);
  if (url !== undefined) page.url = typeof url === 'string' ? new URL(url, DEFAULT_TEST_URL) : url;
};

export const setNavigating = (partial: Partial<NavigatingDouble>): void => {
  Object.assign(navigating, partial);
};

export const resetPage = (): void => {
  Object.assign(page, defaultPage());
  Object.assign(navigating, defaultNavigating());
  updated.current = false;
  updated.check = defaultCheck;
};
