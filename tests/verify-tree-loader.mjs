import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const treeHtml = await readFile(new URL('../tool/tree/tree.html', import.meta.url), 'utf8');
const wasmBytes = await readFile(new URL('../tool/tree/vendor/brotli_wasm_bg.wasm', import.meta.url));
const loaderStart = treeHtml.indexOf("const _WASM_URL='./vendor/brotli_wasm_bg.wasm';");
const loaderEnd = treeHtml.indexOf('// ── 인게임 UID 인코딩', loaderStart);
assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, 'brotli loader was not found in tree.html');
const loaderSource = treeHtml.slice(loaderStart, loaderEnd)
  + '\nglobalThis.__treeLoader={init:_initWasm};';

function response(contentType = 'application/wasm') {
  const fallback = { arrayBuffer: async () => new ArrayBuffer(8) };
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    clone: () => fallback,
  };
}

function createContext(fetch, instantiateStreaming, instantiate) {
  const context = vm.createContext({
    console: { error() {} },
    fetch,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Int32Array,
    ArrayBuffer,
    WebAssembly: {
      instantiateStreaming,
      instantiate,
      CompileError: WebAssembly.CompileError,
      LinkError: WebAssembly.LinkError,
      RuntimeError: WebAssembly.RuntimeError,
    },
  });
  vm.runInContext(loaderSource, context);
  return context;
}

{
  let fetches = 0;
  let streamingCalls = 0;
  const instance = { instance: { exports: {} } };
  const context = createContext(
    async () => { fetches++; return response(); },
    async () => { streamingCalls++; return instance; },
    async () => { throw new Error('unexpected arrayBuffer fallback'); },
  );
  const first = context.__treeLoader.init();
  const second = context.__treeLoader.init();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(fetches, 1, 'concurrent initialization fetched WASM more than once');
  assert.equal(streamingCalls, 1, 'concurrent initialization instantiated WASM more than once');
  assert.equal(firstResult, secondResult, 'concurrent callers did not share the instance');
}

{
  let fetches = 0;
  const context = createContext(
    async () => {
      fetches++;
      if (fetches === 1) throw new Error('temporary network failure');
      return response();
    },
    async () => ({ instance: { exports: {} } }),
    async () => { throw new Error('unexpected arrayBuffer fallback'); },
  );
  await assert.rejects(context.__treeLoader.init(), /temporary network failure/);
  await context.__treeLoader.init();
  assert.equal(fetches, 2, 'failed initialization was not retryable');
}

{
  let fallbackCalls = 0;
  const context = createContext(
    async () => response('application/wasm; charset=binary'),
    null,
    async () => { fallbackCalls++; return { instance: { exports: {} } }; },
  );
  vm.runInContext("WebAssembly.instantiateStreaming=async()=>{throw new TypeError('bad MIME')}", context);
  await context.__treeLoader.init();
  assert.equal(fallbackCalls, 1, 'streaming TypeError did not use arrayBuffer fallback');
}

for (const errorName of ['CompileError', 'LinkError', 'RuntimeError']) {
  let fallbackCalls = 0;
  const context = createContext(
    async () => response('application/wasm'),
    null,
    async () => { fallbackCalls++; return { instance: { exports: {} } }; },
  );
  vm.runInContext(`WebAssembly.instantiateStreaming=async()=>{throw new WebAssembly.${errorName}('invalid WASM')}`, context);
  await assert.rejects(context.__treeLoader.init(), error => error.name === errorName);
  assert.equal(fallbackCalls, 0, `${errorName} incorrectly used arrayBuffer fallback`);
}

{
  let streamingCalls = 0;
  let fallbackCalls = 0;
  const context = createContext(
    async () => response('application/octet-stream'),
    async () => { streamingCalls++; return { instance: { exports: {} } }; },
    async () => { fallbackCalls++; return { instance: { exports: {} } }; },
  );
  await context.__treeLoader.init();
  assert.equal(streamingCalls, 0, 'wrong MIME should bypass streaming initialization');
  assert.equal(fallbackCalls, 1, 'wrong MIME did not use arrayBuffer initialization');
}

{
  let fetches = 0;
  const context = vm.createContext({
    console,
    fetch: async url => {
      fetches++;
      assert.equal(url, './vendor/brotli_wasm_bg.wasm');
      return new Response(wasmBytes, { headers: { 'Content-Type': 'application/wasm' } });
    },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Int32Array,
    ArrayBuffer,
    WebAssembly,
  });
  vm.runInContext(loaderSource, context);
  const compressor = await context.__treeLoader.init();
  const uid = `*TT*${Buffer.from(compressor.compress(new Uint8Array(36), 11)).toString('base64')}*`;
  assert.equal(uid, '*TT*GyMA+CcAoowAQA==*', 'real streaming loader changed UID output');
  assert.equal(fetches, 1, 'real streaming loader fetched WASM more than once');
}

console.log('tree loader: 8 scenarios passed');
