import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const treePath = new URL('../tool/tree/tree.html', import.meta.url);
const wasmPath = new URL('../tool/tree/vendor/brotli_wasm_bg.wasm', import.meta.url);
const treeHtml = await readFile(treePath, 'utf8');

let wasmBytes;
const embedded = treeHtml.match(/const _WASM_B64 = '([^']+)'/);
if (embedded) {
  wasmBytes = Buffer.from(embedded[1], 'base64');
} else {
  wasmBytes = await readFile(wasmPath);
  assert.ok(!treeHtml.includes('_WASM_B64'), 'tree.html still contains _WASM_B64');
}

const hash = createHash('sha256').update(wasmBytes).digest('hex');
assert.equal(wasmBytes.length, 1_397_203, 'WASM byte length changed');
assert.equal(hash, '3bf0ac4f99b4d5c5304f2697e59654a5995f8b07d059613b4a0b0f68f7117a6c', 'WASM SHA-256 changed');

async function createCompressor(bytes) {
  const heap = new Array(128).fill(undefined);
  heap.push(undefined, null, true, false);
  let heapNext = heap.length;
  function addHeapObject(object) {
    if (heapNext === heap.length) heap.push(heap.length + 1);
    const index = heapNext;
    heapNext = heap[index];
    heap[index] = object;
    return index;
  }
  function dropHeapObject(index) {
    if (index < 132) return;
    heap[index] = heapNext;
    heapNext = index;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let exports;
  const u8 = () => new Uint8Array(exports.memory.buffer);
  const i32 = () => new Int32Array(exports.memory.buffer);
  const imports = { './brotli_wasm_bg.js': {
    __wbindgen_string_new(pointer, length) {
      return addHeapObject(decoder.decode(u8().subarray(pointer, pointer + length)));
    },
    __wbg_stack_0ddaca5d1abfb52f(resultPointer, errorIndex) {
      const stack = heap[errorIndex]?.stack || '';
      const encoded = encoder.encode(stack);
      const pointer = exports.__wbindgen_malloc(encoded.length);
      u8().set(encoded, pointer);
      i32()[resultPointer / 4] = pointer;
      i32()[resultPointer / 4 + 1] = encoded.length;
    },
    __wbg_new_693216e109162396() { return addHeapObject(new Error()); },
    __wbg_error_09919627ac0992f5() {},
    __wbindgen_object_drop_ref(index) { dropHeapObject(index); },
    __wbindgen_rethrow(index) { throw heap[index]; },
    __wbindgen_is_undefined(index) { return heap[index] === undefined; },
    __wbindgen_is_object(index) {
      const value = heap[index];
      return typeof value === 'object' && value !== null;
    },
    __wbindgen_json_serialize(resultPointer, index) {
      const encoded = encoder.encode(JSON.stringify(heap[index]));
      const pointer = exports.__wbindgen_malloc(encoded.length);
      u8().set(encoded, pointer);
      i32()[resultPointer / 4] = pointer;
      i32()[resultPointer / 4 + 1] = encoded.length;
    },
    __wbindgen_throw(pointer, length) {
      throw new Error(decoder.decode(u8().subarray(pointer, pointer + length)));
    },
  } };

  const result = await WebAssembly.instantiate(bytes, imports);
  exports = result.instance.exports;
  return data => {
    const stackPointer = exports.__wbindgen_add_to_stack_pointer(-16);
    try {
      const inputPointer = exports.__wbindgen_malloc(data.length);
      u8().set(data, inputPointer);
      exports.compress(stackPointer, inputPointer, data.length, 11);
      const outputPointer = i32()[stackPointer / 4];
      const outputLength = i32()[stackPointer / 4 + 1];
      const output = u8().subarray(outputPointer, outputPointer + outputLength).slice();
      exports.__wbindgen_free(outputPointer, outputLength);
      return output;
    } finally {
      exports.__wbindgen_add_to_stack_pointer(16);
    }
  };
}

function layerNodes(layer) {
  const center = 8;
  const nodes = [];
  const row0 = center - layer;
  const row1 = center + layer;
  const column0 = center - layer;
  const column1 = center + layer;
  for (let column = center; column <= column1; column++) nodes.push([row0, column]);
  for (let row = row0 + 1; row <= row1; row++) nodes.push([row, column1]);
  for (let column = column1 - 1; column >= column0; column--) nodes.push([row1, column]);
  for (let row = row1 - 1; row >= row0 + 1; row--) nodes.push([row, column0]);
  for (let column = column0; column < center; column++) nodes.push([row0, column]);
  return nodes;
}

const indexMap = new Map();
let nodeIndex = 0;
for (let layer = 1; layer <= 8; layer++) {
  for (const [row, column] of layerNodes(layer)) {
    indexMap.set(`${row},${column}`, nodeIndex++);
  }
}

const compressor = await createCompressor(wasmBytes);
function encodeUid(activeNodes) {
  const bitmap = new Uint8Array(36);
  for (const key of activeNodes) {
    if (key === '8,8') continue;
    const index = indexMap.get(key);
    if (index !== undefined) bitmap[index >> 3] |= 1 << (index & 7);
  }
  return `*TT*${Buffer.from(compressor(bitmap)).toString('base64')}*`;
}

const cases = [
  { name: 'center-only', nodes: ['8,8'] },
  { name: 'inner-path', nodes: ['8,8', '7,8', '7,9', '8,9'] },
  { name: 'mixed-layers', nodes: ['8,8', '7,8', '6,8', '6,10', '8,11', '12,12', '0,8', '16,0'] },
];

const expected = new Map([
  ['center-only', '*TT*GyMA+CcAoowAQA==*'],
  ['inner-path', '*TT*GyMA+KcADqKNACAB*'],
  ['mixed-layers', '*TT*GyMA+I/URjUWtyVAAEQVAEVHUcAiBgCAAA==*'],
]);

for (const fixture of cases) {
  const uid = encodeUid(fixture.nodes);
  assert.equal(uid, expected.get(fixture.name), `${fixture.name} UID changed`);
  console.log(`${fixture.name}: ${uid}`);
}
console.log(`wasm-bytes: ${wasmBytes.length}`);
console.log(`wasm-sha256: ${hash}`);
