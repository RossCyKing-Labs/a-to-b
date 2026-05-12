/**
 * Minimal PDF content-stream tokenizer.
 *
 * Content streams are sequences of post-fix operations:
 *
 *     a b c d e f cm    -- concatenate matrix
 *     q                  -- save graphics state
 *     /Im0 Do            -- draw XObject named /Im0
 *     Q                  -- restore graphics state
 *
 * For the compress pipeline we only care about a handful of operators:
 *   q   (gsave)            -- push CTM
 *   Q   (grestore)         -- pop CTM
 *   cm  (concat matrix)    -- apply matrix to CTM
 *   Do  (draw XObject)     -- references an XObject by name
 *
 * Everything else (text, paths, colors, shadings) we step over without
 * caring. The parser is tolerant: strings, dicts, arrays, and unknown
 * operators are skipped without raising.
 *
 * We don't ship a general-purpose PDF parser here — we ship the smallest
 * tokenizer that can answer "where, in CTM space, does each image get
 * drawn?".
 */

export type ContentOp =
  | { op: 'q' }
  | { op: 'Q' }
  | { op: 'cm'; args: [number, number, number, number, number, number] }
  | { op: 'Do'; name: string };

const WS = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c, 0x00]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isWs(b: number): boolean {
  return WS.has(b);
}

function isDelim(b: number): boolean {
  return DELIM.has(b);
}

/**
 * Walk a content-stream byte buffer and yield ops we care about.
 * Numbers and names are accumulated into a small stack; when an operator
 * keyword (q/Q/cm/Do) closes them out, we emit a typed op.
 *
 * Defensive limits: we cap total iterations and abort if the parser
 * fails to advance the cursor on any iteration. Either condition
 * indicates a malformed content stream or a parser bug, and we'd rather
 * lose the analysis pass for a single page than wedge the entire UI.
 */
export function* parseContentOps(bytes: Uint8Array): Generator<ContentOp> {
  const len = bytes.length;
  let i = 0;
  const stack: (number | string)[] = [];
  // Reused decoder; only used for short token slices.
  const decoder = new TextDecoder('latin1');
  // Cap iterations at ~10 ops per byte — plenty for any real content
  // stream (typical streams have ~1 op per 5 bytes). If we somehow blow
  // past this, something is wrong and we should bail.
  const maxIterations = bytes.length * 10 + 1000;
  let iterations = 0;

  while (i < len) {
    if (++iterations > maxIterations) {
      // Defensive bail-out — a content stream really shouldn't take this
      // many iterations to tokenize. Better to give up the page analysis
      // and continue than to lock the UI thread.
      console.warn('[contentStreamParser] iteration limit exceeded, bailing out');
      return;
    }
    const beforeIndex = i;
    const b = bytes[i];

    if (isWs(b)) {
      i++;
      continue;
    }

    // Comment to end of line
    if (b === 0x25 /* % */) {
      while (i < len && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }

    // Literal string (...) — skip, but track nesting and escape sequences
    if (b === 0x28 /* ( */) {
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        const c = bytes[i];
        if (c === 0x5c /* \ */) {
          i += 2;
        } else if (c === 0x28) {
          depth++;
          i++;
        } else if (c === 0x29) {
          depth--;
          i++;
        } else {
          i++;
        }
      }
      stack.push('<string>');
      continue;
    }

    // Dict << ... >> or hex string < ... >
    if (b === 0x3c /* < */) {
      if (bytes[i + 1] === 0x3c) {
        let depth = 1;
        i += 2;
        while (i < len && depth > 0) {
          if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
            depth++;
            i += 2;
          } else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
            depth--;
            i += 2;
          } else {
            i++;
          }
        }
        stack.push('<dict>');
      } else {
        i++;
        while (i < len && bytes[i] !== 0x3e) i++;
        if (i < len) i++; // consume >
        stack.push('<hex>');
      }
      continue;
    }

    // Array [...] — skip whole array (we don't need its contents)
    if (b === 0x5b /* [ */) {
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        if (bytes[i] === 0x5b) {
          depth++;
          i++;
        } else if (bytes[i] === 0x5d) {
          depth--;
          i++;
        } else if (bytes[i] === 0x28) {
          // String inside array — skip with the same rules
          let sd = 1;
          i++;
          while (i < len && sd > 0) {
            const c = bytes[i];
            if (c === 0x5c) i += 2;
            else if (c === 0x28) {
              sd++;
              i++;
            } else if (c === 0x29) {
              sd--;
              i++;
            } else i++;
          }
        } else {
          i++;
        }
      }
      stack.push('<array>');
      continue;
    }

    // Inline image BI ... ID ... EI — pdf-lib content streams rarely use
    // these but we accept them gracefully by skipping until "EI".
    // (Detected when the stack ends in "BI" and we see "ID". Easier: just
    // tokenize normally; "BI"/"EI" become unknown ops and clear the stack.)

    // Name token starts with /
    if (b === 0x2f /* / */) {
      const start = i;
      i++;
      while (i < len && !isWs(bytes[i]) && !isDelim(bytes[i])) i++;
      const name = decoder.decode(bytes.slice(start, i));
      stack.push(name);
      continue;
    }

    // Otherwise: number or keyword. Accumulate until WS/delimiter.
    const start = i;
    while (i < len && !isWs(bytes[i]) && !isDelim(bytes[i])) i++;
    // Stray closing delimiter or some byte we don't handle explicitly
    // above — skip a single byte to make progress. Without this guard,
    // a malformed content stream would wedge the parser in an infinite
    // loop and freeze the UI thread.
    if (i === start) {
      i++;
      continue;
    }
    const token = decoder.decode(bytes.slice(start, i));

    // Is it a number?
    if (token.length > 0 && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(token)) {
      stack.push(Number(token));
      continue;
    }

    // Operator keyword
    switch (token) {
      case 'q':
        yield { op: 'q' };
        stack.length = 0;
        break;
      case 'Q':
        yield { op: 'Q' };
        stack.length = 0;
        break;
      case 'cm': {
        if (stack.length >= 6) {
          const [a, b1, c, d, e, f] = stack.slice(stack.length - 6) as number[];
          if (
            typeof a === 'number' &&
            typeof b1 === 'number' &&
            typeof c === 'number' &&
            typeof d === 'number' &&
            typeof e === 'number' &&
            typeof f === 'number'
          ) {
            yield { op: 'cm', args: [a, b1, c, d, e, f] };
          }
        }
        stack.length = 0;
        break;
      }
      case 'Do': {
        const top = stack[stack.length - 1];
        if (typeof top === 'string' && top.startsWith('/')) {
          yield { op: 'Do', name: top };
        }
        stack.length = 0;
        break;
      }
      default:
        // Some other operator (Tj, S, m, l, …). Clear the stack so its
        // numeric arguments don't leak into the next operator.
        stack.length = 0;
        break;
    }

    // Absolute safeguard against parser bugs: if no branch above
    // advanced the cursor, force progress by one byte so we can't
    // wedge the main thread.
    if (i === beforeIndex) {
      i++;
    }
  }
}

/**
 * Multiply two 2D affine matrices in column-major (PDF) form.
 * Matrix layout: [a, b, c, d, e, f] represents
 *
 *     | a c e |
 *     | b d f |
 *     | 0 0 1 |
 *
 * which transforms a point (x, y) to (a*x + c*y + e, b*x + d*y + f).
 *
 * In a content stream, `a b c d e f cm` concatenates matrix M_new onto
 * the current CTM: CTM' = M_new × CTM.
 */
export function multiplyCTM(
  m: [number, number, number, number, number, number],
  n: [number, number, number, number, number, number],
): [number, number, number, number, number, number] {
  // m × n
  const [a1, b1, c1, d1, e1, f1] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * Given the current CTM, return the width and height (in PDF user-space
 * units, usually points) that a unit-square XObject would render at.
 *
 * An image drawn by `Do` is rendered in a 1x1 box positioned at the
 * origin; the CTM scales/rotates it to the actual page footprint.
 * Width = |first column|, Height = |second column|.
 */
export function unitBoxDimensions(
  ctm: [number, number, number, number, number, number],
): { width: number; height: number } {
  return {
    width: Math.hypot(ctm[0], ctm[1]),
    height: Math.hypot(ctm[2], ctm[3]),
  };
}
