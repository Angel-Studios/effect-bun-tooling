import { afterAll } from 'bun:test';
import { type FixtureRoot, makeFixtureRoot } from './fixture-root.ts';

export const suiteFixtureRoot = (suite: string): FixtureRoot => {
  const root = makeFixtureRoot(suite);
  afterAll(() => {
    root.dispose();
  });
  return root;
};
