# Teammate D: real data, Databricks, and the story

You don't need Claude Code for any of this. Everything happens in your browser: Canvas, github.com, and Databricks. Your work decides whether the demo uses real data, whether we win the Databricks track, and how the pitch lands. Start on Part 1 right now. Teammates A and B need your Canvas data in the first hour.

**How to add files on GitHub:** open the repo on github.com, go to the folder, click "Add file," then "Upload files" (or "Create new file"). Commit straight to main with a message starting with [D]. To edit a file, open it and click the pencil icon.

**Keep the repo private.** It will contain course material.

## Part 1: real Canvas data (first hour, most urgent)

1. **Pick the demo course with Neil.** You want one with lots of modules, a syllabus, announcements and several PDFs.
2. **Find the course ID.** It's the number in the course URL: canvas.wisc.edu/courses/**123456**.
3. **Capture the API responses.** While logged into Canvas, open each of these URLs in your browser (swap in the course ID) and save each page as a .json file. You can copy the text into a file or use Save As.
   - https://canvas.wisc.edu/api/v1/courses/ID?include[]=syllabus_body
   - https://canvas.wisc.edu/api/v1/courses/ID/modules?include[]=items&per_page=100
   - https://canvas.wisc.edu/api/v1/courses/ID/pages?per_page=100
   - https://canvas.wisc.edu/api/v1/announcements?context_codes[]=course_ID&per_page=100
   - https://canvas.wisc.edu/api/v1/courses/ID/assignments?per_page=100
   - For 3 or 4 content pages from the pages list: https://canvas.wisc.edu/api/v1/courses/ID/pages/PAGE-URL
4. **Download 3 to 5 PDFs** from the course (syllabus, lab handouts, exam policies, anything with real rules or dates in it).
5. **Scrub them.** Remove any student names. Instructor names are fine. Don't capture discussion replies, grades, submissions or people lists.
6. **Upload** the JSON files to shared/fixtures/canvas/ and the PDFs to shared/fixtures/canvas/pdfs/. Commit message: `[D] real Canvas captures`.
7. Tell A and B they're up. Write it in docs/status/teammate-d.md too.

## Part 2: the test question set (right after Part 1)

This is how the team knows if the product actually works, and the best 3 questions become the demo. Create shared/fixtures/queries.json with 12 questions in this format:

```json
[
  {
    "id": "q1",
    "question": "can I turn stuff in late",
    "answerText": "Assignments submitted after the deadline lose 10% per day.",
    "url": "https://canvas.wisc.edu/courses/ID/assignments/syllabus",
    "pdfPage": null,
    "depth": 0,
    "phase": 1,
    "demo": false
  }
]
```

- **question:** how a student would actually ask it, sharing as few words as possible with the answer. That's the whole point of the product.
- **answerText:** the exact sentence copied from the source.
- **url:** where it lives. **pdfPage:** the page number if it's in a PDF, otherwise null.
- **depth:** how many clicks from the course home page.
- **The mix:**
  - 4 questions answered on the same page (phase 1, depth 0)
  - 8 questions that need digging (phase 2, depth 2 or more)
  - at least 3 of the deep ones answered inside a PDF
- Mark your 3 best deep questions `"demo": true`. Pick ones a judge immediately gets ("Can I use a calculator on the midterm?").

Commit: `[D] test question set`.

## Part 3: Databricks track (you lead it)

1. **Go to the Databricks workshop at 2 PM.** Ask the Databricks reps what they want to see from a track entry.
2. **Sign up for Databricks Free Edition:** databricks.com/learn/free-edition.
3. **Load the data.** Start with shared/fixtures/synthetic/diglogs-sample.json (fake dig logs A creates in Task 0). Download it from GitHub, upload it into Databricks, and save it as a Delta table named dig_logs. Later you'll swap in real logs from the extension's "Export dig logs" button.
4. **Build a notebook** that:
   - trains a logistic regression predicting whether a link leads to a hit (outcome == 'hit') from relevance, depth, isPdf, isSyllabus and keywordHits
   - prints its accuracy
   - exports the weights as JSON in exactly this format:
     `{ "version": "db-1", "bias": 0, "relevance": 0, "depth": 0, "isPdf": 0, "isSyllabus": 0, "keywordHits": 0, "minScore": 0.35, "hitScore": 0.6 }`
     The numbers come from the model, except minScore and hitScore, which stay as shown unless B says otherwise.

   Use the Databricks Assistant built into notebooks to write the code. Describe what you want in plain English.
5. **Upload the results** to databricks/link-weights.json, plus an export of the notebook into databricks/. Commit: `[D] learned link weights`. Tell B.
6. **Build the dashboard "Where students get lost"** with 4 tiles:
   - most-asked questions
   - average depth to an answer
   - pages that are most often dead ends
   - PDFs that hold the most hits
7. **Sunday morning:** after the team has done 20 or more real digs, export the real logs, retrain, and work with B on the before-and-after (pages visited before the first hit, default vs. learned weights). That number goes in the pitch.

## Part 4: testing (from the 6 PM checkpoint on)

- Get the built extension from A (a zipped dist folder works), then load it: chrome://extensions, turn on Developer mode, Load unpacked.
- Run all 12 questions. Write pass or fail per question in docs/status/teammate-d.md, with screenshots of failures. Open GitHub Issues for bugs, tagged with who owns the broken part (see the ownership table in CLAUDE.md).
- Re-test after each checkpoint (midnight, 6 AM).

## Part 5: the story

- **Go to Salesforce's "Storytelling for Impact" workshop at 3 PM.**
- **Draft docs/devpost.md:**
  - the problem: answers buried in PDFs and modules, and Canvas's own search skips files
  - what Ctrl+F++ does, in both phases
  - how it's built: on-device model, Rust/WASM, best-first crawl, Databricks-trained link scorer
  - what's next
- **Draft docs/pitch.md:**
  - the 30-second science-fair version
  - a 2-minute finals version built around the 3 demo questions
  - a theme tie-in: the dean's essay "Time to dig"
- **Sunday 9 AM:** screen-record the backup demo video using the 3 demo questions.
- **Sunday by 11 AM:** submit on Devpost (madhacks.io/devpost), in the Databricks track. The deadline is 12:00 PM sharp.
