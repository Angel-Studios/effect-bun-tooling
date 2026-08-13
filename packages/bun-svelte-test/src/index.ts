import * as environment from './app-doubles/environment';
import * as navigation from './app-doubles/navigation';
import * as state from './app-doubles/state';
import * as dom from './dom';
import * as mountModule from './mount';
import * as pluginModule from './plugin';

export type {
  NavigatingDouble,
  PageDouble,
  SetPageInput,
  UpdatedDouble,
} from './app-doubles/state';
export type { MountedComponent } from './mount';
export type { BrowserSubstitution } from './plugin';

export const mountComponent = mountModule.mountComponent;

export const registerDom = dom.registerDom;

export const resetDom = dom.resetDom;

export const registerResetHook = dom.registerResetHook;

export const DEFAULT_TEST_URL = dom.DEFAULT_TEST_URL;

export const sveltePlugin = pluginModule.sveltePlugin;

export const deriveBrowserSubstitutions = pluginModule.deriveBrowserSubstitutions;

export const SUBSTITUTION_ROOTS = pluginModule.SUBSTITUTION_ROOTS;

export const browser = environment.browser;
export const dev = environment.dev;
export const building = environment.building;
export const version = environment.version;

export const goto = navigation.goto;
export const invalidate = navigation.invalidate;
export const invalidateAll = navigation.invalidateAll;
export const preloadData = navigation.preloadData;
export const preloadCode = navigation.preloadCode;
export const pushState = navigation.pushState;
export const replaceState = navigation.replaceState;
export const beforeNavigate = navigation.beforeNavigate;
export const afterNavigate = navigation.afterNavigate;
export const onNavigate = navigation.onNavigate;

export const capturedNavigationCalls = navigation.capturedNavigationCalls;

export const resetNavigation = navigation.resetNavigation;

export const page = state.page;
export const navigating = state.navigating;
export const updated = state.updated;

export const setPage = state.setPage;

export const setNavigating = state.setNavigating;

export const resetPage = state.resetPage;
