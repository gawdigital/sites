import { expect, test } from 'bun:test';

import { place } from './hatch.ts';

test('a group keeps its shape and is put back where the design has it', () => {
  const group = place([[200, 985, 1215], [285, 955, 1265], [370, 1005, 1195]], 48);
  expect(group.pills).toEqual([[0, 30, 260], [85, 0, 310], [170, 50, 240]]);
  expect(group.style).toBe('left:200px;top:955px;width:218px;height:310px');
});

test('a pill may start left of the frame', () => {
  expect(place([[-20, 10, 20]], 48).style).toBe('left:-20px;top:10px;width:48px;height:10px');
});
