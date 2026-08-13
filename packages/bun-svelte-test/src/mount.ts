import { type Component, flushSync, mount, unmount } from 'svelte';
import { registerTeardownHook } from './dom';

export type MountedComponent = {
  readonly container: HTMLElement;

  readonly unmount: () => void;
};

const liveTeardowns = new Set<() => void>();

export const unmountAll = (): void => {
  for (const teardown of [...liveTeardowns]) teardown();
};

registerTeardownHook(unmountAll);

export const mountComponent = <Props extends Record<string, unknown>>(
  component: Component<Props, Record<string, unknown>>,
  props?: Props,
): MountedComponent => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const instance = mount(component, {
    target: container,
    props: (props ?? {}) as Props,
  });

  flushSync();

  const teardown = (): void => {
    if (!liveTeardowns.has(teardown)) return;
    liveTeardowns.delete(teardown);

    unmount(instance);
    flushSync();
    container.remove();
  };

  liveTeardowns.add(teardown);

  return { container, unmount: teardown };
};
