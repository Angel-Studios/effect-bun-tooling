import { describe, expect, it } from 'bun:test';
import * as Result from 'effect/Result';
import { CARRIER_NAMES } from '../src/carrier.ts';
import {
  basenameOf,
  type Classification,
  carried,
  carrierForExtension,
  classifyPath,
  DEFAULT_EXCLUSION_POLICY,
  decodeExclusionPolicy,
  directorySegmentsOf,
  EXCLUSION_PRECEDENCE,
  EXCLUSION_REASONS,
  type ExclusionPolicy,
  ExclusionPolicySchema,
  type ExclusionReason,
  excluded,
  extensionOf,
  pathSegments,
  posixPath,
} from '../src/exclude.ts';
import { readFrontMatter } from '../src/parse.ts';
import { CARRIED_PATHS, EXCLUDED_PATHS } from './fixtures/provenance.ts';
import { failureOf, fixtureText, successOf } from './support.ts';

const reasonOf = (path: string, policy?: ExclusionPolicy): string => {
  const classification = classifyPath(path, policy ?? DEFAULT_EXCLUSION_POLICY);
  return classification._tag === 'Excluded' ? classification.reason : `Carried:${classification.carrier}`;
};

const policyOf = (input: unknown): ExclusionPolicy => successOf(decodeExclusionPolicy(input));

const acceptsPolicy = (input: unknown): boolean => Result.isSuccess(decodeExclusionPolicy(input));

const POLICY_WITH_AN_UNOWNED_JSON: ExclusionPolicy = {
  ...DEFAULT_EXCLUSION_POLICY,
  unownedBasenames: [...DEFAULT_EXCLUSION_POLICY.unownedBasenames, 'thing.json'],
};

const PRECEDENCE_PROBE_POLICY: ExclusionPolicy = {
  ...DEFAULT_EXCLUSION_POLICY,
  unownedBasenames: [...DEFAULT_EXCLUSION_POLICY.unownedBasenames, 'thing.xml'],
  commentIncapableExtensions: [...DEFAULT_EXCLUSION_POLICY.commentIncapableExtensions, '.xml'],
};

const PRECEDENCE_PROBES: readonly (readonly [string, ExclusionPolicy])[] = [
  ['vendor/dist/thing.xml', PRECEDENCE_PROBE_POLICY],
  ['dist/thing.xml', PRECEDENCE_PROBE_POLICY],
  ['thing.xml', PRECEDENCE_PROBE_POLICY],
  ['other.xml', PRECEDENCE_PROBE_POLICY],
  ['other.xml', DEFAULT_EXCLUSION_POLICY],
];

describe('an exclusion is a typed terminal, never a failure', () => {
  it('returns a success carrying the reason even when the file text would be a loud error', () => {
    const malformed = fixtureText('cases/toml-syntax.kt.fixture');
    const generated = successOf(readFrontMatter('dist/main/kotlin/TomlSyntax.kt', malformed));
    const owned = failureOf(readFrontMatter('src/main/kotlin/TomlSyntax.kt', malformed));
    expect(generated).toEqual(excluded('generated'));
    expect(owned).toMatchObject({ _tag: 'TomlSyntax' });
  });

  it('parses a carried file rather than short-circuiting it', () => {
    const carriedText = fixtureText('cases/carried.xml.fixture');
    const outcome = successOf(readFrontMatter('components/carried.html', carriedText));
    expect(outcome).toMatchObject({ _tag: 'FrontMatter', carrier: 'xml' });
  });

  it('names a reason drawn from the closed list for every exclusion it can produce', () => {
    const observed = new Set(EXCLUDED_PATHS.map((expectation) => reasonOf(expectation.path)));
    for (const reason of EXCLUSION_REASONS) expect(observed.has(reason)).toBe(true);
    expect(observed.size).toBe(EXCLUSION_REASONS.length);
  });
});

describe('the pinned corpus of paths classifies as the record claims', () => {
  for (const expectation of EXCLUDED_PATHS) {
    it(`excludes ${expectation.path} as ${expectation.reason}`, () => {
      expect(classifyPath(expectation.path)).toEqual(excluded(expectation.reason));
    });
  }

  for (const expectation of CARRIED_PATHS) {
    it(`carries ${expectation.path} on the ${expectation.carrier} carrier`, () => {
      expect(classifyPath(expectation.path)).toEqual(carried(expectation.carrier));
    });
  }
});

describe('a path rule beats an extension rule, in the declared precedence order', () => {
  it('derives the precedence order from behaviour and finds the declared order', () => {
    const observed = PRECEDENCE_PROBES.map((probe) => reasonOf(probe[0], probe[1]));
    expect(observed).toEqual([...EXCLUSION_PRECEDENCE]);
  });

  it('excludes a generated TypeScript file even though .ts has a carrier', () => {
    expect(classifyPath('src/a.ts')).toEqual(carried('block'));
    expect(classifyPath('dist/a.ts')).toEqual(excluded('generated'));
    expect(classifyPath('packages/x/node_modules/a.ts')).toEqual(excluded('generated'));
  });

  it('excludes a vendored TypeScript file even though .ts has a carrier', () => {
    expect(classifyPath('vendor/a.ts')).toEqual(excluded('vendored'));
    expect(classifyPath('apps/ios/Pods/Alamofire/a.swift')).toEqual(excluded('vendored'));
  });

  it('lets a generated basename beat a comment-incapable extension', () => {
    expect(classifyPath('package.json')).toEqual(excluded('comment_incapable'));
    expect(classifyPath('package-lock.json')).toEqual(excluded('generated'));
  });

  it('lets an unowned basename beat a comment-incapable extension', () => {
    expect(classifyPath('thing.json', POLICY_WITH_AN_UNOWNED_JSON)).toEqual(excluded('unowned'));
    expect(classifyPath('thing.json')).toEqual(excluded('comment_incapable'));
  });
});

describe('segment matching is full-segment, over directory segments only', () => {
  for (const path of ['distribution/release.ts', 'outdist/release.ts', 'dist-tarballs/release.ts']) {
    it(`does not read ${path} as living under a dist segment`, () => {
      expect(classifyPath(path)).toEqual(carried('block'));
    });
  }

  it('does not match a segment rule against the basename', () => {
    expect(classifyPath('src/dist.ts')).toEqual(carried('block'));
    expect(classifyPath('packages/outer/src/build-tools.rs')).toEqual(carried('block'));
    expect(directorySegmentsOf('packages/outer/src/build-tools.rs')).toEqual(['packages', 'outer', 'src']);
  });

  it('matches a segment rule on a windows-shaped path, after normalising the separator', () => {
    expect(classifyPath('packages\\x\\dist\\a.ts')).toEqual(excluded('generated'));
    expect(posixPath('a\\b')).toBe('a/b');
  });
});

describe('the path primitives behave as the classifier assumes', () => {
  it('drops empty and dot segments', () => {
    expect(pathSegments('./a//b/c.ts')).toEqual(['a', 'b', 'c.ts']);
    expect(pathSegments('')).toEqual([]);
    expect(basenameOf('')).toBe('');
  });

  it('reports no extension for a dotfile, which is why an unowned basename must catch it', () => {
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('a/.npmrc')).toBe('');
    expect(classifyPath('.gitignore')).toEqual(excluded('unowned'));
  });

  it('lowercases the extension before looking a carrier up', () => {
    expect(extensionOf('A.TS')).toBe('.ts');
    expect(classifyPath('A.TS')).toEqual(carried('block'));
    expect(classifyPath('a.JSON')).toEqual(excluded('comment_incapable'));
  });

  it('reports an undeclared extension as having no carrier', () => {
    expect(carrierForExtension('.zzz', DEFAULT_EXCLUSION_POLICY)).toBeUndefined();
    expect(classifyPath('Makefile')).toEqual(excluded('no_carrier_declared'));
    expect(classifyPath('docs/notes')).toEqual(excluded('no_carrier_declared'));
  });

  it('assigns every carrier at least one declared extension', () => {
    for (const carrierName of CARRIER_NAMES) {
      const extensions = DEFAULT_EXCLUSION_POLICY.carrierExtensions[carrierName];
      expect(extensions.length).toBeGreaterThan(0);
      for (const extension of extensions) {
        expect(carrierForExtension(extension, DEFAULT_EXCLUSION_POLICY)).toBe(carrierName);
      }
    }
  });

  it('never gives one extension to two carriers', () => {
    const all = CARRIER_NAMES.flatMap(
      (carrierName) => DEFAULT_EXCLUSION_POLICY.carrierExtensions[carrierName],
    );
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('the exclusion policy is declared data decoded through Effect Schema', () => {
  it('pins every list in the shipped default by content, so no member can drift unnoticed', () => {
    expect(DEFAULT_EXCLUSION_POLICY).toEqual({
      carrierExtensions: {
        block: [
          '.ts',
          '.tsx',
          '.js',
          '.jsx',
          '.mjs',
          '.cjs',
          '.mts',
          '.cts',
          '.rs',
          '.swift',
          '.kt',
          '.kts',
          '.c',
          '.cc',
          '.cpp',
          '.h',
          '.hpp',
          '.css',
          '.scss',
        ],
        hash: ['.ex', '.exs', '.py', '.sh', '.bash', '.zsh', '.toml', '.yml', '.yaml'],
        apostrophe: ['.brs'],
        xml: ['.html', '.htm', '.md', '.svelte', '.vue'],
      },
      commentIncapableExtensions: [
        '.json',
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.ico',
        '.otf',
        '.ttf',
        '.woff',
        '.woff2',
        '.jar',
        '.class',
        '.pem',
        '.pbf',
        '.zip',
        '.tgz',
        '.bin',
        '.so',
        '.dylib',
        '.dll',
      ],
      commentIncapableBasenames: ['LICENSE', 'NOTICE'],
      carrierNotExpressibleExtensions: ['.xml', '.svg'],
      generatedBasenames: [
        'bun.lock',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'Cargo.lock',
        'gradle.lockfile',
      ],
      generatedSegments: [
        'dist',
        'build',
        'target',
        'out',
        'node_modules',
        '.svelte-kit',
        'generated',
        '__generated__',
      ],
      vendoredSegments: ['vendor', 'vendored', 'third_party', 'third-party', 'Pods', 'externals'],
      unownedBasenames: ['.gitignore', '.gitattributes', '.dockerignore', '.npmrc', '.editorconfig'],
    });
  });

  it('decodes the shipped default without changing it', () => {
    expect(policyOf(DEFAULT_EXCLUSION_POLICY)).toEqual(DEFAULT_EXCLUSION_POLICY);
  });

  it('refuses an unknown key rather than ignoring it', () => {
    const failed = failureOf(decodeExclusionPolicy({ ...DEFAULT_EXCLUSION_POLICY, zzz: [] }));
    expect(failed._tag).toBe('ExclusionPolicyDecode');
    expect(failed.message).toContain('zzz');
  });

  it('refuses a missing section and a mistyped section', () => {
    expect(acceptsPolicy({})).toBe(false);
    expect(acceptsPolicy({ ...DEFAULT_EXCLUSION_POLICY, vendoredSegments: 'vendor' })).toBe(false);
    expect(acceptsPolicy(null)).toBe(false);
  });

  it('names every policy section the classifier reads', () => {
    expect(Object.keys(ExclusionPolicySchema.fields)).toEqual(Object.keys(DEFAULT_EXCLUSION_POLICY));
  });

  it('accepts an injected policy, so the classifier holds no opinion of its own', () => {
    const empty: ExclusionPolicy = {
      carrierExtensions: { block: [], hash: [], apostrophe: [], xml: [] },
      commentIncapableExtensions: [],
      commentIncapableBasenames: [],
      carrierNotExpressibleExtensions: [],
      generatedBasenames: [],
      generatedSegments: [],
      vendoredSegments: [],
      unownedBasenames: [],
    };
    expect(classifyPath('dist/a.ts', policyOf(empty))).toEqual(excluded('no_carrier_declared'));
  });
});

describe('the classification constructors produce the declared shapes', () => {
  it('tags a carried file with its carrier and an excluded file with its reason', () => {
    const carriedValue: Classification = carried('hash');
    const excludedValue: Classification = excluded('vendored');
    expect(carriedValue).toEqual({ _tag: 'Carried', carrier: 'hash' });
    expect(excludedValue).toEqual({ _tag: 'Excluded', reason: 'vendored' });
  });

  it('declares a precedence list drawn from the reason list, minus the fallback', () => {
    const reasons: readonly ExclusionReason[] = EXCLUSION_REASONS;
    for (const reason of EXCLUSION_PRECEDENCE) expect(reasons).toContain(reason);
    expect(EXCLUSION_PRECEDENCE).not.toContain('no_carrier_declared');
    expect(EXCLUSION_REASONS.length - 1).toBe(EXCLUSION_PRECEDENCE.length);
  });
});
