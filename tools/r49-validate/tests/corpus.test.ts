import { describe, it, expect } from 'vitest';
import { checkPath, handleOf, scopeOf } from '../src/corpus.ts';

const codes = (findings: readonly { code: string }[]) => findings.map(f => f.code);

describe('corpus paths', () => {
  describe('scope', () => {
    it('recognises a submission and a fixture', () => {
      expect(scopeOf('archives/alice/west-yard.r49')).toBe('archives');
      expect(scopeOf('fixtures/cars-0-10.r49')).toBe('fixtures');
    });

    it('refuses depths the layout does not define', () => {
      // No flat submissions, and no per-layout directory: an .r49 is already a
      // self-contained zip, so a directory holding exactly one file buys a
      // level of nesting for nothing.
      expect(scopeOf('archives/west-yard.r49')).toBe('unknown');
      expect(scopeOf('archives/alice/yard/west.r49')).toBe('unknown');
      expect(scopeOf('fixtures/old/cars.r49')).toBe('unknown');
      expect(scopeOf('west-yard.r49')).toBe('unknown');
    });

    it('names the contributor directory only for a real submission', () => {
      expect(handleOf('archives/alice/west-yard.r49')).toBe('alice');
      expect(handleOf('fixtures/cars-0-10.r49')).toBeNull();
    });
  });

  describe('the rules', () => {
    it('accepts a well-formed submission from its own author', () => {
      expect(checkPath('archives/alice/west-yard.r49', 'alice')).toEqual([]);
    });

    it('rejects a filename that is not a slug', () => {
      // The concrete hazard: `git diff --name-only` piped into a shell loop
      // splits on the spaces.
      expect(codes(checkPath('archives/alice/cars 0-10.r49', 'alice'))).toEqual(['path/slug']);
      expect(codes(checkPath('archives/alice/West_Yard.r49', 'alice'))).toEqual(['path/slug']);
      expect(codes(checkPath('archives/alice/-west.r49', 'alice'))).toEqual(['path/slug']);
      expect(codes(checkPath('archives/alice/west--yard.r49', 'alice'))).toEqual(['path/slug']);
    });

    it('rejects a submission under somebody else’s handle', () => {
      const findings = checkPath('archives/bob/west-yard.r49', 'alice');
      expect(codes(findings)).toEqual(['path/owner']);
      expect(findings[0].message).toContain('archives/alice/');
    });

    it('skips only the ownership rule when the author is unknown', () => {
      // A contributor running this locally has no pull request to read a
      // handle from; refusing to run would make the tool useless to them.
      expect(checkPath('archives/bob/west-yard.r49', null)).toEqual([]);
      expect(codes(checkPath('archives/bob/cars 0-10.r49', null))).toEqual(['path/slug']);
    });

    it('does not apply the ownership rule to fixtures', () => {
      expect(checkPath('fixtures/cars-0-10.r49', 'alice')).toEqual([]);
    });

    it('reports one shape error, not a pile, for a path the layout has no place for', () => {
      const findings = checkPath('west-yard.r49', 'alice');
      expect(codes(findings)).toEqual(['path/shape']);
    });

    it('tolerates backslashes, which a Windows contributor’s tooling produces', () => {
      expect(checkPath('archives\\alice\\west-yard.r49', 'alice')).toEqual([]);
    });
  });
});
