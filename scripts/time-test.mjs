import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// 直接复用 src/lib/time.ts，避免测试里复制一份实现导致两端漂移。
const directory = mkdtempSync(join(tmpdir(), 'oa-time-test-'));
const source = readFileSync(new URL('../src/lib/time.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const modulePath = join(directory, 'time.mjs');
writeFileSync(modulePath, outputText);
const { todayInBizTZ, formatInBizTZ, formatDateInBizTZ, todayStampInBizTZ, addDaysInBizTZ } = await import(pathToFileURL(modulePath).href);
rmSync(directory, { recursive: true, force: true });

const at = (iso) => new Date(iso);

test('业务日期在北京时区 00:00 / 07:59 / 08:00 边界正确', () => {
  // 北京 2026-11-25 23:59:59（UTC 15:59:59）仍是 25 日。
  assert.equal(todayInBizTZ(at('2026-11-25T15:59:59.999Z')), '2026-11-25');
  // 北京 2026-11-26 00:00:00（UTC 16:00:00）进入 26 日。
  assert.equal(todayInBizTZ(at('2026-11-25T16:00:00.000Z')), '2026-11-26');
  // 北京 2026-11-26 07:59:59（UTC 23:59:59）仍是 26 日。
  assert.equal(todayInBizTZ(at('2026-11-25T23:59:59.999Z')), '2026-11-26');
  // 北京 2026-11-26 08:00:00（UTC 00:00:00）仍是 26 日。
  assert.equal(todayInBizTZ(at('2026-11-26T00:00:00.000Z')), '2026-11-26');
});

test('UTC 19:00 等于北京次日 03:00，不能退回前一天', () => {
  assert.equal(todayInBizTZ(at('2026-11-25T19:00:00.000Z')), '2026-11-26');
});

test('时间戳展示时转换为北京时间', () => {
  assert.equal(formatInBizTZ('2026-11-26T02:54:38.093Z'), '2026-11-26 10:54:38');
  assert.equal(formatInBizTZ('2026-11-25T16:00:00.000Z'), '2026-11-26 00:00:00');
  assert.equal(formatDateInBizTZ('2026-11-25T16:00:00.000Z'), '2026-11-26');
  assert.equal(formatInBizTZ(''), '');
  assert.equal(formatInBizTZ('not-a-date'), '');
  assert.equal(formatDateInBizTZ(undefined), '');
});

test('导出日期戳与跨月跨年加减天数正确', () => {
  assert.equal(todayStampInBizTZ(at('2026-11-25T16:00:00.000Z')), '20261126');
  assert.equal(addDaysInBizTZ('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysInBizTZ('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysInBizTZ('2026-03-01', -1), '2026-02-28');
});
