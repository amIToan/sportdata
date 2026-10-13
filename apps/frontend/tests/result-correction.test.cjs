const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const source = readFileSync(resolve(__dirname, '../src/lib/result-correction.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
new Function('exports', code)(exportsObject);
const { pointsWinnerSide } = exportsObject;

test('changing 2–7 to 10–7 changes the points winner', () => {
  assert.equal(pointsWinnerSide({ athlete1Score: 2, athlete2Score: 7 }), 2);
  assert.equal(pointsWinnerSide({ athlete1Score: 10, athlete2Score: 7 }), 1);
});
test('ties use advantages then fewer penalties; a complete tie needs a referee decision', () => {
  const tied = { athlete1Score: 7, athlete2Score: 7 };
  assert.equal(pointsWinnerSide({ ...tied, athlete1Advantages: 2, athlete2Advantages: 1 }), 1);
  assert.equal(pointsWinnerSide({ ...tied, athlete1Penalties: 2, athlete2Penalties: 1 }), 2);
  assert.equal(pointsWinnerSide(tied), null);
  assert.equal(pointsWinnerSide({ athlete1Score: null, athlete2Score: 7 }), null);
});
