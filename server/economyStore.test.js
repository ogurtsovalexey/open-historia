import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countMonthlyTicks, parseCalendarDate } from "./economyStore.js";

describe("economy calendar boundaries", () => {
  it("counts one and several crossed month boundaries without rounding days", () => {
    assert.equal(countMonthlyTicks("1900-01-31", "1900-02-01"), 1);
    assert.equal(countMonthlyTicks("1900-01-15", "1900-04-14"), 3);
    assert.equal(countMonthlyTicks("1900-01-01", "1900-01-31"), 0);
  });

  it("handles year ends and leap-day dates", () => {
    assert.equal(countMonthlyTicks("1999-12-31", "2000-01-01"), 1);
    assert.deepEqual(parseCalendarDate("2000-02-29"), { text: "2000-02-29", year: 2000, month: 2, day: 29 });
    assert.throws(() => parseCalendarDate("1900-02-29"), /valid Gregorian/);
  });

  it("rejects backwards movement and jumps beyond 120 months", () => {
    assert.throws(() => countMonthlyTicks("1900-02-01", "1900-01-31"), /backwards/);
    assert.equal(countMonthlyTicks("1900-01-01", "1910-01-01"), 120);
    assert.throws(() => countMonthlyTicks("1900-01-01", "1910-02-01"), /120/);
  });
});
