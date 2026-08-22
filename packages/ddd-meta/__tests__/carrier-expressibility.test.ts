import { describe, expect, it } from 'bun:test';
import { CARRIER_NAMES, carrierOf } from '../src/carrier.ts';
import {
  carried,
  carrierForExtension,
  classifyPath,
  DEFAULT_EXCLUSION_POLICY,
  EXCLUSION_REASONS,
  excluded,
} from '../src/exclude.ts';

const NOT_EXPRESSIBLE_EXTENSIONS: readonly string[] = ['.xml', '.svg'];

const STILL_CARRIED_BY_XML: readonly string[] = ['.html', '.htm', '.md', '.svelte', '.vue'];

describe('a file whose host cannot express the ratified fence is an honest excluded terminal', () => {
  it('names the reason in the closed list', () => {
    expect(EXCLUSION_REASONS).toContain('carrier_not_expressible');
  });

  for (const extension of NOT_EXPRESSIBLE_EXTENSIONS) {
    it(`excludes a ${extension} path rather than carrying it`, () => {
      expect(classifyPath(`components/Login${extension}`)).toEqual(excluded('carrier_not_expressible'));
      expect(carrierForExtension(extension, DEFAULT_EXCLUSION_POLICY)).toBeUndefined();
    });
  }

  it('declares those extensions on no carrier at all', () => {
    for (const carrierName of CARRIER_NAMES) {
      for (const extension of NOT_EXPRESSIBLE_EXTENSIONS) {
        expect(DEFAULT_EXCLUSION_POLICY.carrierExtensions[carrierName]).not.toContain(extension);
      }
    }
  });

  it('pins the WHOLE carrier table by content, so no strict-XML extension can be added unnoticed', () => {
    expect(DEFAULT_EXCLUSION_POLICY.carrierExtensions).toEqual({
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
    });
  });

  it('pins the not-expressible list by content too, so neither side can drift alone', () => {
    expect(DEFAULT_EXCLUSION_POLICY.carrierNotExpressibleExtensions).toEqual(['.xml', '.svg']);
  });
});

describe('the exclusion is scoped to the hosts that reject a double hyphen, and no further', () => {
  for (const extension of STILL_CARRIED_BY_XML) {
    it(`keeps a ${extension} path on the xml carrier`, () => {
      expect(classifyPath(`docs/page${extension}`)).toEqual(carried('xml'));
    });
  }

  it('leaves the xml carrier reachable, so the carrier itself is not orphaned', () => {
    expect(DEFAULT_EXCLUSION_POLICY.carrierExtensions.xml.length).toBeGreaterThan(0);
    expect(carrierOf('xml').open).toBe('<!-- ---uv');
  });
});
