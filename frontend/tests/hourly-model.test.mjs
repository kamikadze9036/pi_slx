import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

// The view model is pure TypeScript; use the project's compiler to run it with Node's test runner.
const module = { exports: {} };
const source = readFileSync(new URL('../src/hourly-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
new Function('module', 'exports', compiled.outputText)(module, module.exports);
const { buildOverviewHours, buildOverviewTotal, hourDetailSummary } = module.exports;

function recordedData() {
  return {
    server_time: '2026-10-06T07:30:00+02:00',
    shift: { start: '2026-10-06T06:00:00+02:00', end: '2026-10-06T09:00:00+02:00' },
    live_shift: {
      hours: [{ start: '2026-10-06T06:00:00+02:00', end: '2026-10-06T07:00:00+02:00', elapsed_seconds: 3600, cycle_count: 20, stop_seconds: 300, stop_count: 1 },
        { start: '2026-10-06T07:00:00+02:00', end: '2026-10-06T08:00:00+02:00', elapsed_seconds: 1800, cycle_count: 10, stop_seconds: 600, stop_count: 1 }],
      downtime_events: [{ start: '2026-10-06T06:55:00+02:00', end: '2026-10-06T07:10:00+02:00', reason: 'Material', comment: 'Feed blocked' }],
      scrap_declarations: [
        { time: '2026-10-06T07:20:00+02:00', quantity: 2, reason: 'Burn', cavity_no: 1 },
        { time: '2026-10-06T07:20:00+02:00', quantity: 3, reason: 'Burn', cavity_no: 1 },
      ],
      summary: { cycle_count: 30, observed_stop_count: 1, observed_stop_seconds: 900 },
    },
  };
}

test('server hours and boundary-crossing stops match the original view; future hours are not invented', () => {
  const data = recordedData();
  const rows = buildOverviewHours(data, 'minutes');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].details[0].amount, '5 min');
  assert.equal(rows[1].details[0].amount, '10 min');
  assert.equal(rows[1].details[0].comment, 'Feed blocked');
  assert.equal(rows[1].current, true);
  assert.equal(rows[1].elapsed, 1800);
  assert.equal(rows[1].segments.find(item => item.key === 'future').value, 30);
  assert.deepEqual(rows.map(row => [row.count, row.stopCount, row.stopSeconds, row.scrap]), [[20, 1, 300, 0], [10, 1, 600, 5]]);
  const total = buildOverviewTotal(data, rows);
  assert.equal(total.count, 30);
  assert.equal(total.scrap, 5);
  assert.equal(total.oee, null);
  assert.equal(total.estimated, null);
  assert.equal(total.stopCount, 1); // One stop spans two hours; don't double-count it in the total.
  assert.equal(total.stopSeconds, 900);
  assert.equal(total.segments.reduce((sum, segment) => sum + segment.value, 0), 120);
  assert.equal(hourDetailSummary(total, true, 'minutes').find(item => item.reason === 'Material').amount, '15 min');
});

test('identical scrap timestamps retain every declaration and comments are not merged away', () => {
  const data = recordedData();
  data.live_shift.scrap_declarations[0].comment = 'Operator A';
  data.live_shift.scrap_declarations[1].comment = 'Operator B';
  const hour = buildOverviewHours(data, 'minutes')[1];
  assert.equal(hour.scrap, 5);
  assert.equal(hourDetailSummary(hour, true, 'minutes').filter(item => item.key === 'scrap').length, 2);
});

test('unavailable recording remains unavailable and does not imply production or running', () => {
  const data = recordedData();
  data.live_shift.hours = [{ ...data.live_shift.hours[0], cycle_count: null, stop_count: null, stop_seconds: null }];
  data.live_shift.downtime_events = [];
  data.live_shift.scrap_declarations = null;
  const hour = buildOverviewHours(data, 'minutes')[0];
  assert.equal(hour.count, null);
  assert.equal(hour.scrap, null);
  assert.equal(hour.stopCount, null);
  assert.equal(hour.stopSeconds, null);
  assert.deepEqual(hour.segments, [{ key: 'unknown', label: 'Unverified time', value: 60 }]);
  data.live_shift.hours = [];
  assert.deepEqual(buildOverviewHours(data, 'minutes'), []);
});

test('overnight shift retains both server-provided repeated autumn DST hours', () => {
  const start = Date.parse('2026-10-24T22:00:00+02:00');
  const hours = Array.from({length: 9}, (_, index) => ({start: new Date(start+index*3600000).toISOString(),
    end: new Date(start+(index+1)*3600000).toISOString(), elapsed_seconds: 3600}));
  const rows = buildOverviewHours({ server_time: '2026-10-25T07:00:00+01:00',
    shift: { start: '2026-10-24T22:00:00+02:00', end: '2026-10-25T06:00:00+01:00' }, hours }, 'minutes');
  assert.equal(rows.length, 9);
  assert.equal(new Set(rows.map(row => row.id)).size, 9);
  assert.equal(rows.reduce((sum, row) => sum + row.elapsed, 0), 9 * 3600);
});

test('elapsed time and stop totals remain the exact API values even when display time differs', () => {
  const data = recordedData();
  data.server_time = '2026-10-06T07:59:00+02:00';
  data.live_shift.hours[1].stop_seconds = 1801.25;
  const row = buildOverviewHours(data, 'minutes')[1];
  assert.equal(row.elapsed, 1800);
  assert.equal(row.stopSeconds, 1801.25);
  assert.equal(row.count, 10);
});
