// SvelteKit 3 renames `$app/environment` to `$app/env`, and the old module re-exports the new one.
export { browser, building, dev, version } from './env.ts';
