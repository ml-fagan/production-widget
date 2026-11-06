import { streamsOf, onStream, editKey, scheduleFieldFor } from "./lib/board.js";

/**
 * Which board a job appears on — the rule that decides what Duncan sees.
 *
 * It exists twice on purpose: here, and as `streamsOf` in the handover app's
 * lib/handoverSchema.ts. The two have to agree, because this copy decides
 * which rows are drawn and that copy decides which writes are allowed — and
 * the failure when they drift is a job being built on a line nobody can see,
 * or a date saved against a board the job isn't on.
 *
 * The asymmetry is the whole thing. Until 5 November 2026 `fibreCement` meant
 * "on the FC board INSTEAD of the standard one", so on every record written
 * before that date the ABSENCE of `standardProduction` is a positive statement
 * about standard production, not a missing field. Read it as a plain boolean
 * and forty-odd live fibre cement jobs appear on the standard board overnight.
 *
 *   node test-streams.mjs
 */

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The two shapes every record written before 5 Nov 2026 has.
check(
  "a legacy FC job is on the fibre cement board only",
  same(streamsOf({ fibreCement: true }), ["fc"]),
  JSON.stringify(streamsOf({ fibreCement: true }))
);
check(
  "a legacy standard job is on the standard board only",
  same(streamsOf({ fibreCement: false }), ["standard"])
);
check(
  "a record with neither field is standard",
  same(streamsOf({}), ["standard"])
);

// What the new ticks mean.
check(
  "ticked for both is on both",
  same(streamsOf({ fibreCement: true, standardProduction: true }), ["standard", "fc"])
);
check(
  "ticked for standard only",
  same(streamsOf({ fibreCement: false, standardProduction: true }), ["standard"])
);
check(
  "ticked for fibre cement only",
  same(streamsOf({ fibreCement: true, standardProduction: false }), ["fc"])
);

/**
 * Neither ticked is not a board a job can be on.
 *
 * The form will not let you get there — the last tick is disabled — but a
 * record could still arrive this way, and a job on no board is a job that
 * vanishes off the schedule rather than showing up anywhere as a problem.
 */
check(
  "neither ticked falls back to standard rather than nowhere",
  same(streamsOf({ fibreCement: false, standardProduction: false }), ["standard"])
);

check("onStream agrees with streamsOf", onStream({ fibreCement: true }, "fc") && !onStream({ fibreCement: true }, "standard"));

// A pending edit belongs to one board, not to the job.
check("an edit key names the board", editKey("23296-3", "fc") === "23296-3|fc");
check("and defaults to standard", editKey("23296-3") === "23296-3|standard");
check(
  "the two boards' edits never share a key",
  editKey("23296-3", "fc") !== editKey("23296-3", "standard")
);

/**
 * Where a line's dates actually live.
 *
 * This is the one that got shipped wrong. `fcSchedule` reads like "the fibre
 * cement line's dates" and is not: it is the SECOND line's dates, and only
 * exists for a job running on both. Every fibre cement job's dates are in
 * `schedule`, because `schedule` was the only one there was — so pointing the
 * board at `fcSchedule` emptied twenty-four rows on Duncan's screen while the
 * dates sat untouched in the database.
 */
check(
  "a fibre-cement-only job keeps its dates in `schedule`",
  scheduleFieldFor({ fibreCement: true }, "fc") === "schedule",
  scheduleFieldFor({ fibreCement: true }, "fc")
);
check(
  "...including one written since the flags arrived",
  scheduleFieldFor({ fibreCement: true, standardProduction: false }, "fc") === "schedule"
);
check(
  "a standard-only job uses `schedule`",
  scheduleFieldFor({ fibreCement: false }, "standard") === "schedule"
);
check(
  "a job on both splits: standard keeps `schedule`",
  scheduleFieldFor({ fibreCement: true, standardProduction: true }, "standard") === "schedule"
);
check(
  "and fibre cement gets `fcSchedule`",
  scheduleFieldFor({ fibreCement: true, standardProduction: true }, "fc") === "fcSchedule"
);

console.log(failures ? `\n${failures} FAILED` : "\nall checks pass");
process.exit(failures ? 1 : 0);
