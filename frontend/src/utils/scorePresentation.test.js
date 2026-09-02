import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCORE_PALETTE,
  getFillPercent,
  getGPA,
  getScoreColor,
} from '../utils.js';


test('percentage colors use 85 as the saturated yellow pivot', () => {
  assert.equal(getScoreColor(59, 'Percentage'), SCORE_PALETTE.deepRed);
  assert.equal(getScoreColor(60, 'Percentage'), 'rgb(214, 59, 77)');
  assert.equal(getScoreColor(85, 'Percentage'), 'rgb(199, 182, 0)');
  assert.equal(getScoreColor(99, 'Percentage'), 'rgb(34, 157, 91)');
  assert.equal(getScoreColor(100, 'Percentage'), 'rainbow');
});

test('grade colors follow recommendation-score equivalents without creating GPA', () => {
  const equivalents = {
    'A+': 97,
    'A': 95,
    'A-': 90,
    'B+': 85,
    'B': 80,
    'B-': 77,
    'C+': 73,
    'C': 70,
    'C-': 67,
    'D+': 63,
    'D': 60,
    'F': 0,
  };

  Object.entries(equivalents).forEach(([grade, score]) => {
    assert.equal(getScoreColor(grade, 'Grade'), getScoreColor(score, 'Percentage'));
    assert.equal(getGPA(grade, 'Grade'), null);
  });
});

test('grade fill is linear from A+ 100 to D 20 while F is full warning', () => {
  const expected = {
    'A+': 100,
    'A': 92,
    'A-': 84,
    'B+': 76,
    'B': 68,
    'B-': 60,
    'C+': 52,
    'C': 44,
    'C-': 36,
    'D+': 28,
    'D': 20,
    'F': 100,
  };

  Object.entries(expected).forEach(([grade, fill]) => {
    assert.equal(getFillPercent(grade, 'Grade'), fill);
  });
});

test('P and NP presentation takes precedence over declared score type', () => {
  ['Percentage', 'Grade', 'P/NP'].forEach(scoreType => {
    assert.equal(getScoreColor('P', scoreType), SCORE_PALETTE.blue);
    assert.equal(getScoreColor('NP', scoreType), SCORE_PALETTE.deepRed);
    assert.equal(getFillPercent('P', scoreType), 100);
    assert.equal(getFillPercent('NP', scoreType), 100);
    assert.equal(getGPA('P', scoreType), null);
    assert.equal(getGPA('NP', scoreType), null);
  });
});
