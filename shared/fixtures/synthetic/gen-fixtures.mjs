// Generates synthetic fixtures for Ctrl+F++. Usage: node gen-fixtures.mjs <outDir>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
const O = 'https://canvas.wisc.edu';
const C = `${O}/courses/12345`;

// ---------- course.json: SourceDoc[] ----------
let pid = 0;
const dom = (url, texts, base = '/html[1]/body[1]/div[1]/main[1]/div[1]') =>
  texts.map((text, i) => ({ id: `s${pid++}`, url, text, locator: { kind: 'dom', xpath: `${base}/p[${i + 1}]`, start: 0, end: text.length } }));
const pdfPassages = (url, pages) =>
  pages.flatMap((texts, pi) => {
    let off = 0;
    return texts.map((text) => {
      const p = { id: `s${pid++}`, url, text, locator: { kind: 'pdf', url, page: pi + 1, start: off, end: off + text.length } };
      off += text.length + 1;
      return p;
    });
  });
const link = (url, text, context) => ({ url, text, context });

const pdfUrl = `${C}/files/777/download`;
const labPdf = `${C}/files/778/download`;
const course = [
  {
    url: C, title: 'CS 999: Intro to Digging', kind: 'canvas',
    passages: dom(C, ['Welcome to CS 999! Start with the syllabus and the Week 1 module.', 'Lecture recordings are posted within a day of each class.']),
    links: [
      link(`${C}/assignments/syllabus`, 'Syllabus', 'syllabus course policies grading late work'),
      link(`${C}/modules`, 'Modules', 'modules weekly materials'),
      link(`${C}/announcements`, 'Announcements', 'announcements news updates'),
    ],
  },
  {
    url: `${C}/assignments/syllabus`, title: 'Course Syllabus', kind: 'canvas',
    passages: dom(`${C}/assignments/syllabus`, [
      'Assignments submitted after the deadline lose 10% per day. Nothing is accepted more than five days after the due date.',
      'Each student has three free extension days for the semester that can be used on any homework without asking first.',
      'Both midterms are in class. Rules about allowed materials for each exam are in the Exam Policies PDF under Week 1 in Modules.',
      'Office hours are held Wednesdays from 3 to 5 PM in Room 4310, or by appointment over email.',
    ]),
    links: [link(pdfUrl, 'Exam Policies (PDF)', 'Exams: rules about allowed materials for each exam syllabus')],
  },
  {
    url: `${C}/modules`, title: 'Modules', kind: 'canvas',
    passages: [],
    links: [
      link(`${C}/modules/1`, 'Week 1: Getting started', 'module week 1 getting started exam policies'),
      link(`${C}/modules/2`, 'Week 2: Crawling', 'module week 2 crawling lab'),
      link(`${C}/modules/3`, 'Week 3: Ranking', 'module week 3 ranking'),
    ],
  },
  {
    url: `${C}/modules/1`, title: 'Week 1: Getting started', kind: 'canvas',
    passages: [],
    links: [
      link(pdfUrl, 'Exam Policies.pdf', 'Week 1 file exam policies pdf'),
      link(`${C}/pages/how-to-get-help`, 'How to get help', 'Week 1 page help office hours piazza'),
    ],
  },
  {
    url: `${C}/modules/2`, title: 'Week 2: Crawling', kind: 'canvas',
    passages: [],
    links: [link(labPdf, 'Lab 1 handout.pdf', 'Week 2 file lab handout crawling'), link(`${C}/pages/project-guidelines`, 'Final project guidelines', 'Week 2 page final project')],
  },
  {
    url: `${C}/pages/how-to-get-help`, title: 'How to get help', kind: 'canvas',
    passages: dom(`${C}/pages/how-to-get-help`, [
      'Post questions on Piazza first; TAs answer within one business day.',
      'For anything personal, such as grades or accommodations, email the instructor directly instead of posting.',
    ]),
    links: [],
  },
  {
    url: `${C}/pages/project-guidelines`, title: 'Final project guidelines', kind: 'canvas',
    passages: dom(`${C}/pages/project-guidelines`, [
      'Teams can have two to four people. Solo projects need instructor approval by week 6.',
      'The final presentation is ten minutes, followed by five minutes of questions from the class.',
    ]),
    links: [],
  },
  {
    url: pdfUrl, title: 'Exam Policies.pdf', kind: 'pdf',
    passages: pdfPassages(pdfUrl, [
      ['CS 999 Exam Policies. This document covers both midterms and the final project presentation.', 'Exams start at the beginning of lecture. Arriving more than 15 minutes late means you cannot start the exam.'],
      [
        'A basic four-function or scientific calculator is permitted on both midterms. Graphing calculators and phones are not.',
        'You may bring one double-sided 8.5 by 11 inch sheet of handwritten notes to each midterm.',
        'Regrade requests must be submitted within one week of exams being returned.',
      ],
    ]),
    links: [],
  },
  {
    url: labPdf, title: 'Lab 1 handout.pdf', kind: 'pdf',
    passages: pdfPassages(labPdf, [['Lab 1: write a crawler that only issues GET requests and respects a page budget.', 'Labs are due Friday at 11:59 PM and are graded on completion.']]),
    links: [],
  },
];
writeFileSync(join(out, 'course.json'), JSON.stringify(course, null, 2) + '\n');

// ---------- tree-events.json: a ~20 s dig, all six states ----------
const calcPassage = course[7].passages[2];
const ev = [];
const add = (t, nodeId, parentId, url, title, state, score, extra = {}) => ev.push({ nodeId, parentId, url, title, state, score, t, ...extra });
add(0, 'n0', null, C, 'CS 999: Intro to Digging', 'digging', 0.1);
add(600, 'n1', 'n0', `${C}/assignments/syllabus`, 'Syllabus', 'queued', 0.62);
add(600, 'n2', 'n0', `${C}/modules`, 'Modules', 'queued', 0.55);
add(600, 'n3', 'n0', `${C}/announcements`, 'Announcements', 'queued', 0.4);
add(650, 'n4', 'n0', `${C}/grades`, 'Grades', 'skipped', 0.05);
add(650, 'n5', 'n0', `${C}/calendar`, 'Calendar', 'skipped', 0.12);
add(1200, 'n0', null, C, 'CS 999: Intro to Digging', 'dead', 0.1);
add(1300, 'n1', 'n0', `${C}/assignments/syllabus`, 'Syllabus', 'digging', 0.62);
add(1300, 'n2', 'n0', `${C}/modules`, 'Modules', 'digging', 0.55);
add(2600, 'n1', 'n0', `${C}/assignments/syllabus`, 'Syllabus', 'relevant', 0.48, {
  snippet: 'Rules about allowed materials for each exam are in the Exam Policies PDF.',
  hit: { passageId: course[1].passages[2].id, url: course[1].url, score: 0.48, text: course[1].passages[2].text, locator: course[1].passages[2].locator },
});
add(2700, 'n6', 'n1', pdfUrl, 'Exam Policies (PDF)', 'queued', 0.81);
add(3100, 'n2', 'n0', `${C}/modules`, 'Modules', 'dead', 0.2);
add(3200, 'n7', 'n2', `${C}/modules/1`, 'Week 1: Getting started', 'queued', 0.58);
add(3200, 'n8', 'n2', `${C}/modules/2`, 'Week 2: Crawling', 'queued', 0.37);
add(3200, 'n9', 'n2', `${C}/modules/3`, 'Week 3: Ranking', 'skipped', 0.22);
add(3400, 'n6', 'n1', pdfUrl, 'Exam Policies (PDF)', 'digging', 0.81);
add(3400, 'n7', 'n2', `${C}/modules/1`, 'Week 1: Getting started', 'digging', 0.58);
add(3400, 'n3', 'n0', `${C}/announcements`, 'Announcements', 'digging', 0.4);
add(5200, 'n3', 'n0', `${C}/announcements`, 'Announcements', 'dead', 0.15);
add(6000, 'n7', 'n2', `${C}/modules/1`, 'Week 1: Getting started', 'dead', 0.25);
add(6100, 'n10', 'n7', `${C}/pages/how-to-get-help`, 'How to get help', 'queued', 0.39);
add(7400, 'n6', 'n1', pdfUrl, 'Exam Policies (PDF)', 'hit', 0.86, {
  snippet: 'A basic four-function or scientific calculator is permitted on both midterms.',
  hit: { passageId: calcPassage.id, url: pdfUrl, score: 0.86, text: calcPassage.text, locator: calcPassage.locator },
});
add(7600, 'n8', 'n2', `${C}/modules/2`, 'Week 2: Crawling', 'digging', 0.37);
add(7600, 'n10', 'n7', `${C}/pages/how-to-get-help`, 'How to get help', 'digging', 0.39);
add(9800, 'n10', 'n7', `${C}/pages/how-to-get-help`, 'How to get help', 'dead', 0.18);
add(10400, 'n8', 'n2', `${C}/modules/2`, 'Week 2: Crawling', 'dead', 0.2);
add(10500, 'n11', 'n8', labPdf, 'Lab 1 handout.pdf', 'queued', 0.42);
add(10500, 'n12', 'n8', `${C}/pages/project-guidelines`, 'Final project guidelines', 'queued', 0.36);
add(11000, 'n11', 'n8', labPdf, 'Lab 1 handout.pdf', 'digging', 0.42);
add(11000, 'n12', 'n8', `${C}/pages/project-guidelines`, 'Final project guidelines', 'digging', 0.36);
add(14300, 'n11', 'n8', labPdf, 'Lab 1 handout.pdf', 'dead', 0.12);
add(16200, 'n12', 'n8', `${C}/pages/project-guidelines`, 'Final project guidelines', 'relevant', 0.41, {
  snippet: 'The final presentation is ten minutes, followed by five minutes of questions.',
  hit: { passageId: course[6].passages[1].id, url: course[6].url, score: 0.41, text: course[6].passages[1].text, locator: course[6].passages[1].locator },
});
add(16400, 'n13', 'n12', `${C}/pages/rubric`, 'Rubric', 'skipped', 0.18);
add(17000, 'n14', 'n6', `${C}/files/779/download`, 'Practice midterm.pdf', 'queued', 0.66);
add(17200, 'n14', 'n6', `${C}/files/779/download`, 'Practice midterm.pdf', 'digging', 0.66);
add(19800, 'n14', 'n6', `${C}/files/779/download`, 'Practice midterm.pdf', 'dead', 0.22);
writeFileSync(join(out, 'tree-events.json'), JSON.stringify(ev, null, 2) + '\n');

// ---------- diglogs-sample.json: ~300 rows, outcome depends on features ----------
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const queries = ['can I use a calculator on the midterm', 'when are office hours', 'how late can I turn in homework', 'how big can project teams be', 'what happens if I miss an exam', 'is the lab graded', 'can I bring notes to the exam', 'how do I ask for a regrade'];
const paths = ['assignments/syllabus', 'modules', 'modules/1', 'modules/2', 'modules/3', 'announcements', 'pages/how-to-get-help', 'pages/project-guidelines', 'files/777/download', 'files/778/download', 'files/779/download', 'pages/rubric'];
const rows = [];
for (let i = 0; i < 300; i++) {
  const path = paths[Math.floor(rnd() * paths.length)];
  const isPdf = path.startsWith('files/');
  const isSyllabus = path.includes('syllabus');
  const depth = isSyllabus ? 1 : path.includes('/') && !isPdf ? 2 : isPdf ? 3 : 1;
  const relevance = Math.round(Math.min(1, Math.max(0, rnd() * 0.7 + (isPdf ? 0.15 : 0) + (isSyllabus ? 0.1 : 0))) * 1000) / 1000;
  const keywordHits = Math.floor(rnd() * (relevance > 0.5 ? 4 : 2));
  const z = -4 + 6 * relevance + 0.9 * isPdf + 0.5 * isSyllabus + 0.4 * keywordHits - 0.2 * depth + (rnd() - 0.5) * 1.5;
  const p = 1 / (1 + Math.exp(-z));
  const outcome = p > 0.6 ? 'hit' : p > 0.35 ? 'relevant' : 'dead';
  rows.push({ query: queries[Math.floor(rnd() * queries.length)], url: `${C}/${path}`, depth, relevance, isPdf, isSyllabus, keywordHits, outcome });
}
writeFileSync(join(out, 'diglogs-sample.json'), JSON.stringify(rows, null, 1) + '\n');
console.log('course docs', course.length, 'events', ev.length, 'diglogs', rows.length, 'hits', rows.filter((r) => r.outcome === 'hit').length);
