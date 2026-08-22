import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARRIER_NAMES, HOST_COMMENT_END_SEQUENCES } from '../src/carrier.ts';
import { FRONT_MATTER_ERROR_TAGS, WRITE_ERROR_TAGS } from '../src/errors.ts';
import { CARRIER_NOT_EXPRESSIBLE_RULE, carried, EXCLUSION_REASONS, excluded } from '../src/exclude.ts';
import { NO_FRONT_MATTER, parseFrontMatter } from '../src/parse.ts';
import {
  DIRECTIVE_SCOPES,
  MACHINE_READ_DIRECTIVES,
  PREAMBLE_SCOPE_RULE,
  YAML_FENCE_RULE,
} from '../src/sentinel.ts';
import { EMPTY_VOCABULARY, gradeFrontMatter } from '../src/vocabulary.ts';
import { HOST_COMMENT_NEUTRALISATION_RULE, WRITE_TOTALITY_RULE } from '../src/write.ts';
import { PACKAGE_ROOT, repoRoot, successOf } from './support.ts';

const carriedBlockTag = (): string => {
  const outcome = successOf(parseFrontMatter('/* ---uv\nl = "domain"\n--- */\n', 'block'));
  return outcome._tag;
};

const FORMAT_README = readFileSync(join(repoRoot(), 'docs', 'frontmatter', 'README.md'), 'utf8');

const PACKAGE_README = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf8');

const PUBLISHED_DOCUMENTS: readonly (readonly [string, string])[] = [
  ['docs/frontmatter/README.md', FORMAT_README],
  ['packages/ddd-meta/README.md', PACKAGE_README],
];

const TAG_IN_DOCS = /\|\s*`([A-Z][A-Za-z]+)`\s*\|/g;

const CAPITALISED_IN_DOCS = /`([A-Z][A-Za-z]+)`/g;

const NOT_A_TAG: readonly string[] = [
  'ExclusionPolicySchema',
  'FrontMatterError',
  'FrontMatterWriteError',
  'LICENSE',
  'NOTICE',
  'ParseOutcome',
  'Pods',
  'Result',
  'Vocabulary',
];

const DECLARED_TAGS: readonly string[] = [
  ...FRONT_MATTER_ERROR_TAGS,
  ...WRITE_ERROR_TAGS,
  NO_FRONT_MATTER._tag,
  carriedBlockTag(),
  carried('block')._tag,
  excluded('generated')._tag,
  ...gradeFrontMatter({ l: 'domain' }, EMPTY_VOCABULARY).map((finding) => finding._tag),
  ...gradeFrontMatter({ l: 'domain' }, { ...EMPTY_VOCABULARY, layer: ['application'] }).map(
    (finding) => finding._tag,
  ),
];

const capitalisedTokensIn = (text: string): readonly string[] => {
  const found = new Set<string>();
  for (const match of text.matchAll(CAPITALISED_IN_DOCS)) found.add(match[1]);
  return [...found].sort();
};

const namesAll = (text: string, members: readonly string[]): readonly string[] =>
  members.filter((member) => !text.includes(member));

const documentedTags = (): readonly string[] => {
  const found = new Set<string>();
  for (const match of FORMAT_README.matchAll(TAG_IN_DOCS)) found.add(match[1]);
  return [...found].sort();
};

const undeclaredTagsIn = (text: string): readonly string[] =>
  capitalisedTokensIn(text).filter((token) => !DECLARED_TAGS.includes(token) && !NOT_A_TAG.includes(token));

describe('the published error table names every tag the package declares, and none it does not', () => {
  it('documents every read error tag', () => {
    expect(namesAll(FORMAT_README, FRONT_MATTER_ERROR_TAGS)).toEqual([]);
  });

  it('documents every write error tag', () => {
    expect(namesAll(FORMAT_README, WRITE_ERROR_TAGS)).toEqual([]);
  });

  it('documents no tag the package does not declare', () => {
    const declared = [...FRONT_MATTER_ERROR_TAGS, ...WRITE_ERROR_TAGS].sort();
    expect(documentedTags()).toEqual(declared);
  });

  it('is armed: a tag missing from the document is reported by the same check', () => {
    const withoutOne = FORMAT_README.replaceAll('PayloadMovesHostCommentEnd', 'Redacted');
    expect(namesAll(withoutOne, FRONT_MATTER_ERROR_TAGS)).toEqual(['PayloadMovesHostCommentEnd']);
  });
});

describe('every published document names only tags the package declares', () => {
  it('derives the tag vocabulary from the code, and keeps the not-a-tag list disjoint from it', () => {
    for (const tag of ['FrontMatter', 'NoFrontMatter', 'Carried', 'Excluded']) {
      expect(DECLARED_TAGS).toContain(tag);
    }
    for (const tag of ['VocabularyUndeclared', 'OutsideVocabulary']) expect(DECLARED_TAGS).toContain(tag);
    for (const token of NOT_A_TAG) expect(DECLARED_TAGS).not.toContain(token);
  });

  for (const [label, text] of PUBLISHED_DOCUMENTS) {
    it(`names no undeclared tag in ${label}`, () => {
      expect(`${label}: ${undeclaredTagsIn(text).join(', ')}`).toBe(`${label}: `);
    });
  }

  it('is armed: a renamed tag in either document is reported by the same check', () => {
    const renamed = PACKAGE_README.replaceAll('MisplacedFrontMatter', 'MisplacedFrontMatterBlock');
    expect(undeclaredTagsIn(renamed)).toEqual(['MisplacedFrontMatterBlock']);
  });
});

describe('the shipped package README documents the API the package actually has', () => {
  it('shows the Result form rather than a bare string', () => {
    expect(PACKAGE_README).toContain('Result<string, FrontMatterWriteError>');
    expect(PACKAGE_README).toContain('Result.isFailure(written)');
  });

  it('names all five refusals, and no longer states them as a closed list of three', () => {
    const positional = ['MisplacedFrontMatter', 'DuplicateFrontMatter', 'UnterminatedBlock'];
    expect(namesAll(PACKAGE_README, WRITE_ERROR_TAGS)).toEqual([]);
    expect(namesAll(PACKAGE_README, positional)).toEqual([]);
    expect(PACKAGE_README).not.toContain('misplaced, duplicated or unterminated');
  });

  it('states the next-line directives that stop the preamble rather than claiming it consumes them', () => {
    const nextLine = DIRECTIVE_SCOPES.filter((entry) => entry[1] === 'next_line').map((entry) => entry[0]);
    const named = nextLine.filter((token) => !token.startsWith('eslint'));
    expect(namesAll(PACKAGE_README, named)).toEqual([]);
    expect(PACKAGE_README).not.toContain('preserves the preamble above the block (shebang');
  });

  it('names both sentinel exports on the subpath table', () => {
    expect(namesAll(PACKAGE_README, ['MACHINE_READ_DIRECTIVES', 'DIRECTIVE_SCOPES'])).toEqual([]);
  });
});

describe('the published policy tables name every member the code declares', () => {
  it('documents every exclusion reason', () => {
    expect(namesAll(FORMAT_README, EXCLUSION_REASONS)).toEqual([]);
  });

  it('documents every machine-read directive and every scope the preamble rule reads', () => {
    expect(namesAll(FORMAT_README, MACHINE_READ_DIRECTIVES)).toEqual([]);
    expect(
      namesAll(
        FORMAT_README,
        DIRECTIVE_SCOPES.map((entry) => entry[0]),
      ),
    ).toEqual([]);
  });

  it('documents every carrier and every neutralised sequence', () => {
    expect(namesAll(FORMAT_README, CARRIER_NAMES)).toEqual([]);
    expect(namesAll(FORMAT_README, HOST_COMMENT_END_SEQUENCES)).toEqual([]);
  });
});

describe('a rule carried as an exported constant is pinned, so it can go red', () => {
  it('names every neutralised sequence, and names the one deliberately excluded', () => {
    expect(namesAll(HOST_COMMENT_NEUTRALISATION_RULE, HOST_COMMENT_END_SEQUENCES)).toEqual([]);
    expect(HOST_COMMENT_NEUTRALISATION_RULE).toContain('<!-- is NOT neutralised');
  });

  it('is armed: a rule that dropped a member is reported by the same check', () => {
    const withoutOpen = HOST_COMMENT_NEUTRALISATION_RULE.replaceAll('/*', 'REDACTED');
    expect(namesAll(withoutOpen, HOST_COMMENT_END_SEQUENCES)).toEqual(['/*']);
  });

  it('retracts the claim that every rendered string passes through the escape', () => {
    expect(HOST_COMMENT_NEUTRALISATION_RULE).not.toContain('rendered string necessarily passes');
    expect(HOST_COMMENT_NEUTRALISATION_RULE).toContain('rendered VALUE necessarily passes');
    expect(HOST_COMMENT_NEUTRALISATION_RULE).toContain('inline-table KEY');
  });

  it('names both write refusals in the write totality rule', () => {
    expect(namesAll(WRITE_TOTALITY_RULE, WRITE_ERROR_TAGS)).toEqual([]);
  });

  it('names both disambiguating spellings in the preamble scope rule', () => {
    expect(namesAll(PREAMBLE_SCOPE_RULE, ['biome-ignore-all', 'eslint-disable-next-line'])).toEqual([]);
  });

  it('names the closing-fence guard in the yaml fence rule', () => {
    expect(YAML_FENCE_RULE).toContain('only a fence when it CLOSES');
  });

  it('names both excluded extensions in the expressibility rule', () => {
    expect(namesAll(CARRIER_NOT_EXPRESSIBLE_RULE, ['.xml', '.svg', '<?uv'])).toEqual([]);
  });
});
