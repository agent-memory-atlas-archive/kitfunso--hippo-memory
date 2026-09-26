/** Rule-based detector for a user correction of the previous assistant turn (ROADMAP Z3). */

const MAX_MESSAGE_LEN = 600;
const MATCH_WINDOW = 300;

/** Characters of the previous assistant turn the detector reads; the eval unit used the same window. */
export const PREVIOUS_TURN_WINDOW = 2000;

/** Result of {@link detectCorrection}. */
export interface CorrectionDetection {
  isCorrection: boolean;
  /** Name of the rule that fired; per-rule precision is in the Z3 result doc. */
  rule?: string;
  /** What the user says was wrong, when the message names it (the Y in "use X not Y"). */
  correctedClaim?: string;
  /** The user's directive clause, trimmed (e.g. "don't delete it, archive it instead"). */
  instruction?: string;
  /** The fired rule's fixed weight in 0..1, not a calibrated probability; 0 when isCorrection is false. */
  confidence: number;
}

interface CorrectionRule {
  name: string;
  pattern: RegExp;
  confidence: number;
}

// One row per rule so confidence and pattern can be tuned on a single line each.
const RULES: readonly CorrectionRule[] = [
  // Two words after "no" so a short follow-up question ("no tests?") does not fire.
  { name: 'no-opener', pattern: /^(no|nope|nah)[,.!\s]+\S+\s+\S/i, confidence: 0.9 },
  { name: 'negative-imperative', pattern: /^(don't|dont|do not|never|stop|quit)\b(?! worry)/i, confidence: 0.9 },
  { name: 'wrong-claim', pattern: /\b(that's|thats|that is|this is|it's|its|you're|you are) (wrong|incorrect|not right|not correct|not what i)/i, confidence: 0.85 },
  { name: 'i-said', pattern: /\bi (said|told you|have said|already said|asked for|meant)\b/i, confidence: 0.85 },
  { name: 'we-are-not', pattern: /\bwe(?: are|'re) not\b/i, confidence: 0.85 },
  { name: 'why-did-you', pattern: /\bwhy (haven't|havn't|didn't|did|would|are|do) you\b/i, confidence: 0.85 },
  { name: 'stop-doing', pattern: /\bstop \w+ing\b/i, confidence: 0.85 },
  { name: 'wait-what', pattern: /\bwait,? what\b/i, confidence: 0.85 },
  { name: 'frustration', pattern: /\b(dude|what the fuck)\b/i, confidence: 0.8 },
  { name: 'quality-complaint', pattern: /\b(so ugly|not good enough|you keep)\b/i, confidence: 0.8 },
  { name: 'you-failed', pattern: /\byou (forgot|missed|ignored|broke|should have)\b/i, confidence: 0.8 },
  { name: 'revert', pattern: /\b(revert|undo|roll back) (that|this|it|those|these|the)\b/i, confidence: 0.8 },
  { name: 'use-x-not-y', pattern: /\buse (.+?),? not (.+?)([.!?,;]|$)/i, confidence: 0.8 },
  { name: 'instead-of', pattern: /\binstead of (.+?)([.!?,;]|$)/i, confidence: 0.7 },
];

// Curly apostrophes show up in pasted/autocorrected text; normalize before matching.
function normalize(text: string): string {
  return text.replace(/’/g, "'");
}

// Sentence around the match, trimmed to 200 chars, for the `instruction` field.
function extractSentence(text: string, matchIndex: number): string {
  const before = text.lastIndexOf('.', matchIndex - 1);
  const start = before === -1 ? 0 : before + 1;
  const after = text.indexOf('.', matchIndex);
  const end = after === -1 ? text.length : after + 1;
  return text.slice(start, end).trim().slice(0, 200);
}

/** Precision-first: abstains unless a correction phrasing leads a message that follows a non-empty assistant turn. */
export function detectCorrection(userMessage: string, previousAssistantText: string): CorrectionDetection {
  const none: CorrectionDetection = { isCorrection: false, confidence: 0 };
  const message = userMessage.trim();
  if (previousAssistantText.slice(-PREVIOUS_TURN_WINDOW).trim().length === 0) return none;
  if (message.length === 0 || message.length > MAX_MESSAGE_LEN) return none;

  const window = normalize(message.slice(0, MATCH_WINDOW));

  for (const rule of RULES) {
    const match = window.match(rule.pattern);
    if (!match) continue;

    const instruction = extractSentence(window, match.index ?? 0);
    const correctedClaim =
      rule.name === 'use-x-not-y' || rule.name === 'instead-of' ? match[rule.name === 'use-x-not-y' ? 2 : 1]?.trim() : undefined;

    return {
      isCorrection: true,
      rule: rule.name,
      confidence: rule.confidence,
      instruction: instruction || undefined,
      correctedClaim,
    };
  }

  return none;
}
