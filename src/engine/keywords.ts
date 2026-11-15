// Keyword half of the hybrid score. Numbers must match exactly:
// "midterm 2" never matches "midterm 1".

const STOP = new Set(
  ('a an and are as at be by can do does for from get has have how i in info information is it its me my ' +
    'of on or tell the their there this to was what when where which who why will with about any find ' +
    'show give need know due').split(' '),
);

const ORDINALS: Record<string, string> = {
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8',
  ninth: '9', tenth: '10', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10',
};
const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9' };

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

interface Tok { word: string; num: string | null }

/** "midterm2" -> "midterm 2", "2nd" -> 2, "second" -> 2, "ii" after a word -> 2. */
function tokens(text: string): Tok[] {
  const raw = text.toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').match(/[a-z]+|\d+(?:st|nd|rd|th)?/g) ?? [];
  const out: Tok[] = [];
  for (const r of raw) {
    const digits = r.match(/^\d+/);
    if (digits) out.push({ word: '', num: String(Number(digits[0])) });
    else if (ORDINALS[r]) out.push({ word: '', num: ORDINALS[r] });
    else if (ROMAN[r] && out.length && out[out.length - 1].word) out.push({ word: '', num: ROMAN[r] });
    else out.push({ word: stem(r), num: null });
  }
  return out;
}

/** word -> numbers next to it ("midterm 2", "2nd midterm", "chapter #7"). */
function numberPairs(toks: Tok[]): Map<string, Set<string>> {
  const pairs = new Map<string, Set<string>>();
  const add = (w: string, n: string): void => {
    if (!pairs.has(w)) pairs.set(w, new Set());
    pairs.get(w)!.add(n);
  };
  toks.forEach((t, i) => {
    if (!t.num) return;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (prev?.word && !STOP.has(prev.word)) add(prev.word, t.num);
    if (next?.word && !STOP.has(next.word)) add(next.word, t.num);
  });
  return pairs;
}

export interface QueryTerms {
  words: string[];
  pairs: Map<string, Set<string>>;
  loneNums: string[];
}

export function parseQuery(q: string): QueryTerms {
  const toks = tokens(q);
  const pairs = numberPairs(toks);
  const paired = new Set([...pairs.values()].flatMap((s) => [...s]));
  return {
    words: [...new Set(toks.filter((t) => t.word && !STOP.has(t.word)).map((t) => t.word))],
    pairs,
    loneNums: toks.filter((t) => t.num && !paired.has(t.num)).map((t) => t.num!),
  };
}

/** Returns kw in [0,1] and whether a number contradicts the query (e.g. "midterm 1" for "midterm 2"). */
export function keywordScore(q: QueryTerms, passage: string): { kw: number; conflict: boolean } {
  const toks = tokens(passage);
  const words = new Set(toks.map((t) => t.word).filter(Boolean));
  const nums = new Set(toks.map((t) => t.num).filter((n): n is string => !!n));
  const ppairs = numberPairs(toks);

  let hit = 0;
  let total = 0;
  let conflict = false;
  for (const w of q.words) {
    total++;
    if (words.has(w)) hit++;
  }
  for (const [w, qnums] of q.pairs) {
    for (const n of qnums) {
      total++;
      const pn = ppairs.get(w);
      if (pn?.has(n)) hit++;
      else if (pn && pn.size) conflict = true; // same word, different number
    }
  }
  for (const n of q.loneNums) {
    total++;
    if (nums.has(n)) hit++;
  }
  return { kw: total ? hit / total : 0, conflict };
}
