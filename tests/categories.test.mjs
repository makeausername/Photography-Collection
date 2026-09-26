import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedCategories } from '../public/categories.js';

test('题材入口顺序固定，保留旧分类，地点不成为分类', () => {
  assert.deepEqual(orderedCategories([
    { category: '人像写真', location: '四川 · 牛背山' },
    { category: '旧专题', location: '云南 · 大理' },
    { category: '旧专题' },
  ]), ['山川湖海', '星空银河', '朝霞晚霞', '云海雾景', '人像写真', '旧专题']);
});
