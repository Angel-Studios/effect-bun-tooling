import { describe, expect, it } from 'bun:test';
import * as Effect from 'effect/Effect';
import { flushSync } from 'svelte';
import { browser, building, dev, version } from '$app/environment';
import { goto, invalidateAll, pushState, resetNavigation } from '$app/navigation';
import { navigating, page, resetPage, setNavigating, setPage } from '$app/state';
import * as environmentDirect from '../src/app-doubles/environment';
import * as navigationDirect from '../src/app-doubles/navigation';
import * as stateDirect from '../src/app-doubles/state';
import { DEFAULT_TEST_URL } from '../src/dom';
import { mountComponent } from '../src/mount';
import Page from './fixtures/+page.svelte';

describe('$app specifier resolution', () => {
  it('$app/state is the same module instance as the double', () => {
    expect(page).toBe(stateDirect.page);
    expect(navigating).toBe(stateDirect.navigating);
    expect(setPage).toBe(stateDirect.setPage);
  });

  it('$app/navigation is the same module instance as the double', () => {
    expect(goto).toBe(navigationDirect.goto);
    expect(pushState).toBe(navigationDirect.pushState);
    expect(resetNavigation).toBe(navigationDirect.resetNavigation);
  });

  it('$app/environment is the same module instance as the double', () => {
    expect(browser).toBe(environmentDirect.browser);
    expect(browser).toBe(true);
    expect(dev).toBe(false);
    expect(building).toBe(false);
    expect(version).toBe('0');
  });
});

describe('$app/navigation captures calls', () => {
  it('goto() records its arguments', () => {
    expect(goto.mock.calls).toHaveLength(0);

    goto('/lab/devices', { replaceState: true });

    expect(goto.mock.calls).toHaveLength(1);
    expect(goto.mock.calls[0]).toEqual(['/lab/devices', { replaceState: true }]);
  });

  it('each captured function is independent', () => {
    goto('/a');
    invalidateAll();
    pushState('/b', { modal: true });

    expect(goto.mock.calls).toHaveLength(1);
    expect(invalidateAll.mock.calls).toHaveLength(1);
    expect(pushState.mock.calls[0]).toEqual(['/b', { modal: true }]);
  });

  it('resetNavigation() clears captured calls — and the probe can see the opposite', () => {
    goto('/before-reset');

    expect(goto.mock.calls).toHaveLength(1);

    resetNavigation();

    expect(goto.mock.calls).toHaveLength(0);
  });

  // Declared outside the test's Effect: it is a `$app/navigation` double, so it
  // runs at bun's promise boundary rather than under the test's services.
  const rejectingGoto = (): Promise<void> => Effect.runPromise(Effect.die(new Error('per-test override')));

  it('resetNavigation() also restores the stub implementation', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        goto.mockImplementation(rejectingGoto);

        expect(goto('/x')).rejects.toThrow('per-test override');

        resetNavigation();

        yield* Effect.promise(() => goto('/y'));
        expect(goto.mock.calls).toHaveLength(1);
      }),
    ));

  it('the automatic afterEach cleared the previous test`s calls', () => {
    expect(goto.mock.calls).toHaveLength(0);
  });
});

describe('$app/state mutation and reset', () => {
  it('setPage() mutates the page object in place', () => {
    const before = page.url.pathname;

    setPage({ url: '/lab/devices/42', params: { id: '42' }, data: { flavour: 'strawberry' } });

    expect(before).toBe('/');
    expect(page.url.pathname).toBe('/lab/devices/42');
    expect(page.params).toEqual({ id: '42' });
    expect(page.data).toEqual({ flavour: 'strawberry' });
  });

  it('setPage() accepts a URL instance as well as a string', () => {
    setPage({ url: new URL('https://example.test/deep/path?q=1') });

    expect(page.url.host).toBe('example.test');
    expect(page.url.pathname).toBe('/deep/path');
    expect(page.url.searchParams.get('q')).toBe('1');
  });

  it('setNavigating() mutates the navigating object in place', () => {
    setNavigating({ type: 'link', to: { url: new URL('/next', DEFAULT_TEST_URL), params: {} } });

    expect(navigating.type).toBe('link');
    expect(navigating.to?.url.pathname).toBe('/next');
  });

  it('resetPage() restores defaults — and the probe can see the opposite', () => {
    setPage({ url: '/dirty', status: 500, data: { dirty: true } });
    setNavigating({ type: 'goto' });

    expect(page.status).toBe(500);
    expect(page.url.pathname).toBe('/dirty');
    expect(navigating.type).toBe('goto');

    resetPage();

    expect(page.url.href).toBe(DEFAULT_TEST_URL);
    expect(page.status).toBe(200);
    expect(page.data).toEqual({});
    expect(page.params).toEqual({});
    expect(page.route).toEqual({ id: null });
    expect(navigating.type).toBeNull();
  });

  it('the automatic afterEach reset the previous test`s page', () => {
    expect(page.url.href).toBe(DEFAULT_TEST_URL);
    expect(page.status).toBe(200);
  });
});

describe('$app resolution from inside a compiled component', () => {
  it('a compiled +page.svelte reads the SAME page double the test wrote', () => {
    setPage({
      url: '/lab/devices/42?tab=logs',
      route: { id: '/lab/devices/[id]' },
      data: { flavour: 'strawberry' },
      status: 201,
    });

    const mounted = mountComponent(Page, {});
    const text = (testId: string): string =>
      mounted.container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';

    expect(text('pathname')).toBe('/lab/devices/42');
    expect(text('route-id')).toBe('/lab/devices/[id]');
    expect(text('flavour')).toBe('strawberry');
    expect(text('status')).toBe('201');

    mounted.unmount();
  });

  it('a compiled component reads the default page when the test writes nothing', () => {
    const mounted = mountComponent(Page, {});
    const text = (testId: string): string =>
      mounted.container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';

    expect(text('pathname')).toBe('/');
    expect(text('route-id')).toBe('no-route');
    expect(text('flavour')).toBe('none');

    mounted.unmount();
  });

  it('the page double is NOT reactive: setPage() after mount does not re-render', () => {
    const mounted = mountComponent(Page, {});
    const pathname = (): string =>
      mounted.container.querySelector('[data-testid="pathname"]')?.textContent ?? '';

    expect(pathname()).toBe('/');

    setPage({ url: '/changed-after-mount' });
    flushSync();

    expect(page.url.pathname).toBe('/changed-after-mount');

    expect(pathname()).toBe('/');

    mounted.unmount();
  });
});
