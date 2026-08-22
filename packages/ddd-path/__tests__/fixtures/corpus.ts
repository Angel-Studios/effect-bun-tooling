import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import type { GrammarConfig } from '../../src/config';
import { parseGrammarToml } from '../../src/config';
import type { PathClass } from '../../src/parse';

export const repoRoot = resolve(import.meta.dir, '../../../..');

export const grammarTomlPath = resolve(import.meta.dir, 'grammar.toml');

export const grammarTomlSource = readFileSync(grammarTomlPath, 'utf8');

export const testConfig: GrammarConfig = Effect.runSync(parseGrammarToml(grammarTomlSource));

export type ClassSummary = {
  readonly tag: string;
  readonly context?: string | undefined;
  readonly language?: string | undefined;
  readonly kind?: string | undefined;
  readonly shellRole?: string | undefined;
  readonly reason?: string | undefined;
  readonly segment?: string | undefined;
};

export const summarize = (cls: PathClass): ClassSummary => ({
  tag: cls._tag,
  context: 'context' in cls ? cls.context : undefined,
  language: 'language' in cls ? cls.language : undefined,
  kind: 'kind' in cls ? cls.kind : undefined,
  shellRole: 'shellRole' in cls ? cls.shellRole : undefined,
  reason: 'reason' in cls ? cls.reason : undefined,
  segment: 'segment' in cls ? cls.segment : undefined,
});

export const resolvedSummary = (
  cls: PathClass,
): {
  readonly resolved: boolean;
  readonly context?: string | undefined;
  readonly language?: string | undefined;
} => ({
  resolved: cls._tag === 'Graded' || cls._tag === 'Test',
  context: 'context' in cls ? cls.context : undefined,
  language: 'language' in cls ? cls.language : undefined,
});

export const KMP_SOURCE_SETS = [
  'commonMain',
  'commonTest',
  'androidMain',
  'androidHostTest',
  'iosMain',
  'iosTest',
  'iosArm64Main',
  'iosSimulatorArm64Main',
  'jsMain',
  'jsTest',
  'jvmMain',
  'jvmTest',
  'wasmJsMain',
  'wasmJsTest',
  'webMain',
] as const;

export const XAVIER_FLAVOR_SOURCE_SETS = [
  'main',
  'test',
  'xavierDebug',
  'xavierRelease',
  'testXavierDebug',
] as const;

export const kmpPath = (sourceSet: string): string =>
  `modules/bc_shared/lang_kotlin/src/${sourceSet}/kotlin/day/harvest/traditions/MapHost.kt`;

export const xavierFlavorPath = (sourceSet: string): string =>
  `packages/bc_nav_protocol/lang_kotlin/src/${sourceSet}/java/com/angel/xavier/api/NavCoord.kt`;

export type CorpusRow = {
  readonly real: string;
  readonly migrated: string;
  readonly tailBelowShell: string;
  readonly expected: ClassSummary;
};
