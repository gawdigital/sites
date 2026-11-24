import { expect, test } from 'bun:test';

import { hang } from './hatch.ts';

test('a group keeps its shape', () => {
  const group = hang([[200, 985, 1215], [285, 955, 1265], [370, 1005, 1195]], 48, ['bottom', 985], ['right', 374]);
  expect(group.pills).toEqual([[0, 30, 260], [85, 0, 310], [170, 50, 240]]);
});

test('a group hangs from its box’s bottom edge and keeps its distance from the box’s right side', () => {
  expect(hang([[200, 985, 1215], [285, 955, 1265], [370, 1005, 1195]], 48, ['bottom', 985], ['right', 374]).style).toBe(
    'right:-44px;top:calc(100% - 30px);width:218px;height:310px',
  );
});

test('a group may hang below the bottom edge', () => {
  expect(hang([[0, 1000, 1100]], 48, ['bottom', 985], ['left', 16]).style).toBe(
    'left:-16px;top:calc(100% + 15px);width:48px;height:100px',
  );
});

test('a group may hang from the top edge and start left of the box', () => {
  expect(hang([[-20, 10, 20]], 48, ['top', 150], ['left', 16]).style).toBe(
    'left:-36px;top:-140px;width:48px;height:10px',
  );
});
