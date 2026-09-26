/** Synthetic fixtures only; no transcript data. */

import { describe, it, expect } from 'vitest';
import { detectCorrection, PREVIOUS_TURN_WINDOW } from '../src/correction-detect.js';

const DELETE_PLAN = "I'll delete the old migrations folder.";

describe('detectCorrection', () => {
  it('flags the prereg dry-run correction with an instruction', () => {
    const result = detectCorrection("no, don't delete it, archive it instead", DELETE_PLAN);
    expect(result.isCorrection).toBe(true);
    expect(result.rule).toBe('no-opener');
    expect(result.instruction).toBe("no, don't delete it, archive it instead");
  });

  it('does not flag agreement', () => {
    expect(detectCorrection('yes, go ahead', DELETE_PLAN)).toEqual({ isCorrection: false, confidence: 0 });
  });

  it.each([
    ['no-opener', 'no, that is not the file I meant', 0.9],
    ['negative-imperative', 'stop editing that file', 0.9],
    ['wrong-claim', "that's wrong, the folder is still in use", 0.85],
    ['i-said', 'i told you to keep the migrations folder', 0.85],
    ['we-are-not', "we're not deleting anything today", 0.85],
    ['why-did-you', 'why did you delete the tests?', 0.85],
    ['stop-doing', 'please stop asking me to confirm', 0.85],
    ['wait-what', 'wait, what? that folder holds live data', 0.85],
    ['frustration', 'dude, keep the folder', 0.8],
    ['quality-complaint', 'you keep deleting things I need', 0.8],
    ['you-failed', 'you forgot to back up the folder first', 0.8],
    ['revert', 'undo that change please', 0.8],
    ['use-x-not-y', 'use pnpm, not npm.', 0.8],
    ['instead-of', 'archive it instead of deleting it', 0.7],
  ])('rule %s fires', (rule, message, confidence) => {
    const result = detectCorrection(message, DELETE_PLAN);
    expect(result).toMatchObject({ isCorrection: true, rule, confidence });
  });

  it('fills correctedClaim with the rejected option', () => {
    expect(detectCorrection('use pnpm, not npm.', DELETE_PLAN).correctedClaim).toBe('npm');
    expect(detectCorrection('archive it instead of deleting it', DELETE_PLAN).correctedClaim).toBe('deleting it');
  });

  it('takes the first rule in table order when several match', () => {
    const result = detectCorrection("no, that's wrong, use pnpm not npm", DELETE_PLAN);
    expect(result.rule).toBe('no-opener');
    expect(result.correctedClaim).toBeUndefined();
  });

  it('a why-question fires only on the listed rebuke shapes', () => {
    expect(detectCorrection('why did you delete the tests?', DELETE_PLAN).isCorrection).toBe(true);
    expect(detectCorrection('why does the build take so long?', DELETE_PLAN).isCorrection).toBe(false);
  });

  it.each([
    ['bare no', 'no'],
    ['short follow-up question after no', 'no tests?'],
    ["don't worry", "don't worry about it, continue"],
    ['plain new task', 'add a dark mode toggle to settings'],
    ['empty message', '   '],
    ['over 600 chars', "don't " + 'x'.repeat(600)],
  ])('abstains on %s', (_name, message) => {
    expect(detectCorrection(message, DELETE_PLAN).isCorrection).toBe(false);
  });

  it('abstains when there is no previous assistant turn', () => {
    expect(detectCorrection("don't use npm", '').isCorrection).toBe(false);
    expect(detectCorrection("don't use npm", '  \n ').isCorrection).toBe(false);
  });

  it('reads only the last PREVIOUS_TURN_WINDOW chars of the previous turn', () => {
    const blankTail = 'I ran it.' + ' '.repeat(PREVIOUS_TURN_WINDOW);
    expect(detectCorrection("don't use npm", blankTail).isCorrection).toBe(false);
  });

  it('matches curly apostrophes', () => {
    expect(detectCorrection('don’t delete that folder', DELETE_PLAN).isCorrection).toBe(true);
  });

  it('only matches the first 300 chars', () => {
    const late = 'a'.repeat(310) + ' dude';
    expect(detectCorrection(late, DELETE_PLAN).isCorrection).toBe(false);
  });
});
