export interface Ranking { query: string; expected: string[]; split: string; kind: string; pages: { id: string; score: number }[] }

export function metrics(rows: Ranking[], threshold: number) {
  let answered = 0, hit1 = 0, hit3 = 0, reciprocal = 0, absent = 0, rejected = 0;
  for (const row of rows) {
    const visible = row.pages.filter((page) => page.score >= threshold);
    if (!row.expected.length) { absent++; if (!visible.length) rejected++; continue; }
    answered++;
    const rank = visible.findIndex((page) => row.expected.includes(page.id));
    if (rank === 0) hit1++;
    if (rank >= 0 && rank < 3) hit3++;
    if (rank >= 0) reciprocal += 1 / (rank + 1);
  }
  return { queries: rows.length, answerable: answered, noAnswer: absent,
    hitAt1: answered ? hit1 / answered : 0, hitAt3: answered ? hit3 / answered : 0,
    mrr: answered ? reciprocal / answered : 0, noAnswerAccuracy: absent ? rejected / absent : 0 };
}
