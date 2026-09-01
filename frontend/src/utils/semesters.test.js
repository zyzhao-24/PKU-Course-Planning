import test from 'node:test';
import assert from 'node:assert/strict';
import { sortSemestersDescending } from './semesters.js';

test('semesters are ordered by academic year and term descending', () => {
  assert.deepEqual(
    sortSemestersDescending(['25-26-1', '26-27-1', '25-26-3', '25-26-2']),
    ['26-27-1', '25-26-3', '25-26-2', '25-26-1'],
  );
});

test('invalid historical labels are kept after valid semesters', () => {
  assert.deepEqual(
    sortSemestersDescending(['历史学期', '26-27-1', '其他']),
    ['26-27-1', '其他', '历史学期'],
  );
});
