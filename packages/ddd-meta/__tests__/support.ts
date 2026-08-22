import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Result from 'effect/Result';
import type { CarrierName } from '../src/carrier.ts';
import type { FrontMatter } from '../src/schema.ts';

export const FIXTURE_ROOT = join(import.meta.dir, 'fixtures');

export const PACKAGE_ROOT = join(import.meta.dir, '..');

export const fixtureText = (relative: string): string => readFileSync(join(FIXTURE_ROOT, relative), 'utf8');

export const successOf = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error(`expected a success, received the failure ${JSON.stringify(result.failure)}`);
  }
  return result.success;
};

export const failureOf = <A, E>(result: Result.Result<A, E>): E => {
  if (Result.isSuccess(result)) {
    throw new Error(`expected a failure, received the success ${JSON.stringify(result.success)}`);
  }
  return result.failure;
};

export const CANONICAL_PAYLOAD: FrontMatter = {
  l: 'domain',
  p: 'aggregate_root',
  subdomain: 'core',
  tags: ['alpha', 'beta'],
  owner: 'platform_tooling',
  tier: 'tier_one',
  data: ['pci', 'pii'],
  deprecated: '2026-01-31',
  links: { adr: 'https://example.test/adr/0001', runbook: 'https://example.test/runbook' },
  review: '2026-08-01',
  oncall: 'platform_oncall',
};

export const SECOND_PAYLOAD: FrontMatter = {
  l: 'application',
  owner: 'other_team',
};

export const ROUND_TRIP_FIXTURE_OF: Readonly<Record<CarrierName, string>> = {
  block: 'block/sweep.ts.fixture',
  hash: 'hash/bunfig.toml.fixture',
  apostrophe: 'apostrophe/AttachButton.brs.fixture',
  xml: 'xml/LoginModalComponent.xml.fixture',
};

export const threwOf = (thunk: () => unknown): boolean => {
  try {
    thunk();
    return false;
  } catch {
    return true;
  }
};
