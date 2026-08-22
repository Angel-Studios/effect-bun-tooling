import { describe, expect, it } from 'bun:test';
import { Option } from 'effect';
import { checkValue, GRAMMAR_NAME, LCD_IDENTIFIER, RESERVED_WORDS } from '../src/grammar';
import { classify } from '../src/parse';
import { summarize, testConfig } from './fixtures/corpus';

const RUST_KEYWORD_FLOOR = [
  'as',
  'async',
  'await',
  'break',
  'const',
  'continue',
  'crate',
  'dyn',
  'else',
  'enum',
  'extern',
  'false',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'pub',
  'ref',
  'return',
  'self',
  'Self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'type',
  'unsafe',
  'use',
  'where',
  'while',
  'abstract',
  'become',
  'box',
  'do',
  'final',
  'macro',
  'override',
  'priv',
  'try',
  'typeof',
  'unsized',
  'virtual',
  'yield',
  'gen',
];

const RESERVED_COLLISION_VALUES = [
  'match',
  'type',
  'use',
  'mod',
  'impl',
  'crate',
  'self',
  'super',
  'where',
  'fn',
  'ref',
  'move',
];

const RESERVED_FOR_FUTURE_VALUES = ['become', 'priv', 'typeof'];

const DELIBERATELY_ABSENT_WORDS = ['union', 'raw', 'safe', 'macro_rules'];

const contextPath = (value: string): string => `packages/bc_${value}/lang_typescript/src/x.ts`;

const reasonFor = (value: string): string | undefined => Option.getOrUndefined(checkValue(value));

const isLegal = (value: string): boolean => Option.isNone(checkValue(value));

const nextSeed = (seed: number): number => {
  let bits = seed | 0;
  bits ^= bits << 13;
  bits ^= bits >>> 17;
  bits ^= bits << 5;
  return bits >>> 0;
};

const SAMPLE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789__-.';

const generatedSample = (count: number): readonly string[] => {
  const names: string[] = [];
  let seed = 20260822;
  for (let index = 0; index < count; index += 1) {
    seed = nextSeed(seed);
    const length = 1 + (seed % 9);
    let name = '';
    for (let position = 0; position < length; position += 1) {
      seed = nextSeed(seed);
      name += SAMPLE_ALPHABET.charAt(seed % SAMPLE_ALPHABET.length);
    }
    names.push(name);
  }
  return names;
};

const SAMPLE = generatedSample(4000);

describe('the lowest-common-denominator rule set', () => {
  it('exposes LCD_IDENTIFIER and GRAMMAR_NAME as NON-global regexes, so .test carries no lastIndex state', () => {
    expect({ lcdGlobal: LCD_IDENTIFIER.global, grammarGlobal: GRAMMAR_NAME.global }).toEqual({
      lcdGlobal: false,
      grammarGlobal: false,
    });
  });

  it('accepts the charset the reference specifies and refuses the delimiters it names', () => {
    expect({
      underscoreDelimited: LCD_IDENTIFIER.test('billing_engine'),
      hyphen: LCD_IDENTIFIER.test('billing-engine'),
      dot: LCD_IDENTIFIER.test('l.domain'),
      leadingDigit: LCD_IDENTIFIER.test('2fa'),
      uppercase: LCD_IDENTIFIER.test('Billing'),
    }).toEqual({
      underscoreDelimited: true,
      hyphen: false,
      dot: false,
      leadingDigit: false,
      uppercase: false,
    });
  });

  it('imposes a STRICTER name shape than the LCD charset — no leading, trailing or doubled underscore', () => {
    expect({
      leading: GRAMMAR_NAME.test('_billing'),
      trailing: GRAMMAR_NAME.test('billing_'),
      doubled: GRAMMAR_NAME.test('billing__engine'),
      plain: GRAMMAR_NAME.test('billing_engine'),
    }).toEqual({ leading: false, trailing: false, doubled: false, plain: true });
  });

  it('contains GRAMMAR_NAME inside LCD_IDENTIFIER over a generated sample, rather than leaving it to inspection', () => {
    const escapees = SAMPLE.filter((name) => GRAMMAR_NAME.test(name) && !LCD_IDENTIFIER.test(name));
    expect({ sampleSize: SAMPLE.length, escapees }).toEqual({ sampleSize: 4000, escapees: [] });
  });
});

describe('the reserved-word floor', () => {
  it('pins RESERVED_WORDS to the Rust keyword set verbatim, as a literal set written out in the test', () => {
    expect([...RESERVED_WORDS].sort()).toEqual([...RUST_KEYWORD_FLOOR].sort());
  });

  it('carries exactly the fifty-two words of the floor, the 2024-edition gen included', () => {
    expect({ exported: RESERVED_WORDS.size, pinned: RUST_KEYWORD_FLOOR.length }).toEqual({
      exported: 52,
      pinned: 52,
    });
  });

  it('RESERVES gen, because mod gen does not compile in Rust 2024 and a minted bc_gen would be illegal', () => {
    expect({ reserved: RESERVED_WORDS.has('gen'), reason: reasonFor('gen') }).toEqual({
      reserved: true,
      reason: 'reserved_word',
    });
  });

  it('refuses bc_gen at the path level, not only in the word set', () => {
    expect(summarize(classify(contextPath('gen'), testConfig)).reason).toBe('reserved_word');
  });

  it('keeps the weak and contextual keywords ABSENT, since they are not reserved in any edition', () => {
    const present = DELIBERATELY_ABSENT_WORDS.filter((word) => RESERVED_WORDS.has(word));
    expect({ deliberatelyAbsent: DELIBERATELY_ABSENT_WORDS, present }).toEqual({
      deliberatelyAbsent: ['union', 'raw', 'safe', 'macro_rules'],
      present: [],
    });
  });

  it('keeps gen_server LEGAL, so widening the floor did not widen it to compounds', () => {
    expect({
      legal: isLegal('gen_server'),
      context: summarize(classify(contextPath('gen_server'), testConfig)).context,
    }).toEqual({
      legal: true,
      context: 'gen_server',
    });
  });

  for (const word of RESERVED_COLLISION_VALUES) {
    it(`refuses bc_${word} with reason reserved_word, not as a style problem`, () => {
      expect({ value: word, reason: summarize(classify(contextPath(word), testConfig)).reason }).toEqual({
        value: word,
        reason: 'reserved_word',
      });
    });
  }

  for (const word of RESERVED_FOR_FUTURE_VALUES) {
    it(`refuses the reserved-for-future word bc_${word} on the same floor`, () => {
      expect({ value: word, reason: summarize(classify(contextPath(word), testConfig)).reason }).toEqual({
        value: word,
        reason: 'reserved_word',
      });
    });
  }

  it('refuses every collision value through checkValue as well as through classify', () => {
    const wrong = [...RESERVED_COLLISION_VALUES, ...RESERVED_FOR_FUTURE_VALUES].filter(
      (word) => reasonFor(word) !== 'reserved_word',
    );
    expect(wrong).toEqual([]);
  });

  it('applies the floor to the WHOLE value and not to each component — bc_match_engine is LEGAL', () => {
    expect(summarize(classify(contextPath('match_engine'), testConfig))).toEqual({
      tag: 'Graded',
      context: 'match_engine',
      language: 'typescript',
      shellRole: 'source',
    });
  });

  it('keeps every compound containing a keyword component legal, so the stricter reading stays overturned', () => {
    const compounds = ['match_engine', 'type_registry', 'use_case', 'mod_loader', 'self_service'];
    const refused = compounds.filter((value) => !isLegal(value));
    expect({ compounds, refused }).toEqual({ compounds, refused: [] });
  });
});

describe('the case-collision property', () => {
  it('refuses bc_Billing with reason not_lowercase', () => {
    expect(summarize(classify(contextPath('Billing'), testConfig)).reason).toBe('not_lowercase');
  });

  it('refuses bc_BILLING with reason not_lowercase', () => {
    expect(summarize(classify(contextPath('BILLING'), testConfig)).reason).toBe('not_lowercase');
  });

  it('draws a non-empty legal sample, so the property below cannot hold vacuously', () => {
    const legal = SAMPLE.filter((name) => isLegal(name));
    expect(legal.length > 0).toBe(true);
  });

  it('closes the legal set under toLowerCase, so the collision class disappears rather than being managed', () => {
    const legal = SAMPLE.filter((name) => isLegal(name));
    const notClosed = legal.filter((name) => name !== name.toLowerCase());
    expect({ legalCount: legal.length > 0, notClosed }).toEqual({ legalCount: true, notClosed: [] });
  });

  it('admits no two DISTINCT legal names that collide on a case-insensitive filesystem', () => {
    const legal = [...new Set(SAMPLE.filter((name) => isLegal(name)))];
    const folded = new Set(legal.map((name) => name.toLowerCase()));
    expect({ distinct: legal.length, foldedDistinct: folded.size }).toEqual({
      distinct: legal.length,
      foldedDistinct: legal.length,
    });
  });
});

describe('refusal precedence — a diagnostic is stable when several rules are violated at once', () => {
  const PRECEDENCE_CASES = [
    { value: '', wins: 'bad_name_shape', over: 'the empty value is checked first of all' },
    { value: 'a__b', wins: 'tag_suffix_in_path', over: 'bad_name_shape from the doubled underscore' },
    { value: 'A__b', wins: 'tag_suffix_in_path', over: 'not_lowercase' },
    { value: '2A', wins: 'not_lowercase', over: 'leading_digit' },
    { value: 'A-b', wins: 'not_lowercase', over: 'bad_name_shape from the hyphen' },
    { value: 'Self', wins: 'not_lowercase', over: 'reserved_word, which Self would otherwise trigger' },
    { value: '2fa', wins: 'leading_digit', over: 'bad_name_shape from the LCD charset' },
    { value: '2_fa', wins: 'leading_digit', over: 'bad_name_shape from the name shape' },
    { value: '_foo', wins: 'bad_name_shape', over: 'nothing earlier applies' },
    { value: 'foo_', wins: 'bad_name_shape', over: 'nothing earlier applies' },
    { value: 'match', wins: 'reserved_word', over: 'nothing earlier applies' },
  ];

  for (const { value, wins, over } of PRECEDENCE_CASES) {
    it(`reports ${wins} for ${JSON.stringify(value)}, ahead of ${over}`, () => {
      expect({ value, reason: reasonFor(value) }).toEqual({ value, reason: wins });
    });
  }

  it('returns Option.none for a legal value, so a green is a real green', () => {
    expect({
      billing: Option.isNone(checkValue('billing')),
      billingEngine: Option.isNone(checkValue('billing_engine')),
      withDigits: Option.isNone(checkValue('av1rt_quality')),
    }).toEqual({ billing: true, billingEngine: true, withDigits: true });
  });

  it('defers the closed-literal-set check to LAST, behind every shape rule', () => {
    expect({
      unknownLanguage: summarize(classify('bc_x/lang_klingon/src/x.ts', testConfig)).reason,
      unknownTestKind: summarize(classify('bc_x/lang_typescript/t_smoke/src/x.ts', testConfig)).reason,
      shapeBeatsMembership: summarize(classify('bc_x/lang_Klingon/src/x.ts', testConfig)).reason,
    }).toEqual({
      unknownLanguage: 'unknown_language',
      unknownTestKind: 'unknown_test_kind',
      shapeBeatsMembership: 'not_lowercase',
    });
  });
});
