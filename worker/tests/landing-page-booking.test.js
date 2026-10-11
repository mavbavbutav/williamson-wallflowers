import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

// Exercise the helpers used by both the calendar and direct inquiry form.
function bookingRules(now = '2026-10-11T17:00:00Z', bookings = []) {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const context = vm.createContext({ Date: Clock, bookedDates: bookings });
  for (const name of ['parseDateKey', 'todayKey', 'isPastDate', 'isBooked', 'formatDate', 'dateProblem']) {
    const source = html.match(new RegExp(`    function ${name}\\([\\s\\S]*?\\n    }`));
    assert.ok(source, `Missing landing page helper: ${name}`);
    vm.runInContext(source[0], context);
  }
  return context;
}

test('past dates are rejected for inquiries even without a chosen wall', () => {
  const rules = bookingRules();
  assert.match(rules.dateProblem('', '2026-10-10'), /future event date/);
  assert.match(rules.dateProblem('The Secret Garden', '2026-10-10'), /future event date/);
});

test('today, future dates and general inquiries remain allowed', () => {
  const rules = bookingRules();
  assert.equal(rules.dateProblem('The Secret Garden', '2026-10-11'), '');
  assert.equal(rules.dateProblem('The Secret Garden', '2026-11-02'), '');
  assert.equal(rules.dateProblem('', ''), '');
});

test('date cutoff uses Central time rather than the UTC calendar day', () => {
  const rules = bookingRules('2026-10-11T04:30:00Z');
  assert.equal(rules.todayKey(), '2026-10-10');
  assert.equal(rules.isPastDate('2026-10-10'), false);
  assert.equal(rules.isPastDate('2026-10-09'), true);
});

for (const wall of ['The Timeless Bloom', 'The Love Language', 'Wild Bloom', 'The Secret Garden']) {
  test(`${wall} permits Friday, Saturday and Sunday requests without a specific booking`, () => {
    const rules = bookingRules();
    for (const date of ['2026-11-06', '2026-11-07', '2026-11-08']) {
      assert.equal(rules.dateProblem(wall, date), '');
    }
  });
}

test('specific bookings block only the matching wall and date', () => {
  const rules = bookingRules(undefined, [{ wall: 'The Timeless Bloom', date: '2026-11-07' }]);
  assert.match(rules.dateProblem('The Timeless Bloom', '2026-11-07'), /already booked/);
  assert.equal(rules.dateProblem('The Love Language', '2026-11-07'), '');
  assert.equal(rules.dateProblem('The Timeless Bloom', '2026-11-08'), '');
});
