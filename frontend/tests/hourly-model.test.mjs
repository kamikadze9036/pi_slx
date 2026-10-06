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
      hours: [{ start: '2026-10-06T06:00:00+02:00', cycle_count: 20, stop_seconds: 300 },
        { start: '2026-10-06T07:00:00+02:00', cycle_count: 10, stop_seconds: 600 }],
      downtime_events: [{ start: '2026-10-06T06:55:00+02:00', end: '2026-10-06T07:10:00+02:00', reason: 'Material', comment: 'Feed blocked' }],
      scrap_declarations: [
        { time: '2026-10-06T07:20:00+02:00', quantity: 2, reason: 'Burn', cavity_no: 1 },
        { time: '2026-10-06T07:20:00+02:00', quantity: 3, reason: 'Burn', cavity_no: 1 },
      ],
      summary: { cycle_count: 30 },
    },
  };
}

test('boundary-crossing stops split correctly, with current and future capacity kept separate', () => {
  const data = recordedData();
  const rows = buildOverviewHours(data, 'minutes');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].details[0].amount, '5 min');
  assert.equal(rows[1].details[0].amount, '10 min');
  assert.equal(rows[1].details[0].comment, 'Feed blocked');
  assert.equal(rows[1].current, true);
  assert.equal(rows[1].elapsed, 1800);
  assert.equal(rows[1].segments.find(item => item.key === 'future').value, 30);
  assert.equal(rows[2].future, true);
  assert.equal(rows[2].count, null);
  assert.equal(rows[2].scrap, null);
  const total = buildOverviewTotal(data, rows);
  assert.equal(total.count, 30);
  assert.equal(total.scrap, 5);
  assert.equal(total.oee, null);
  assert.equal(total.estimated, null);
  assert.equal(total.segments.reduce((sum, segment) => sum + segment.value, 0), 180);
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
  data.live_shift.hours = [];
  data.live_shift.downtime_events = [];
  data.live_shift.scrap_declarations = null;
  const hour = buildOverviewHours(data, 'minutes')[0];
  assert.equal(hour.count, null);
  assert.equal(hour.scrap, null);
  assert.deepEqual(hour.segments, [{ key: 'unknown', label: 'Neověřený čas', value: 60 }]);
});

test('overnight shift includes both repeated autumn DST hours', () => {
  const rows = buildOverviewHours({ server_time: '2026-10-25T07:00:00+01:00',
    shift: { start: '2026-10-24T22:00:00+02:00', end: '2026-10-25T06:00:00+01:00' } }, 'minutes');
  assert.equal(rows.length, 9);
  assert.equal(new Set(rows.map(row => row.id)).size, 9);
  assert.equal(rows.reduce((sum, row) => sum + row.elapsed, 0), 9 * 3600);
});
