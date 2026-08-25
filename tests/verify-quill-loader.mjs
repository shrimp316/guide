import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../js/quill-loader.js', import.meta.url), 'utf8'))
  .replace('export function ensureQuill()', 'function ensureQuill()')
  + '\nglobalThis.__ensureQuill = ensureQuill;';

const elements = [];
function createElement(tagName) {
  const listeners = new Map();
  const element = {
    tagName,
    dataset: {},
    removed: false,
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    dispatch(type) {
      for (const callback of listeners.get(type) || []) callback();
    },
    remove() {
      element.removed = true;
    },
  };
  elements.push(element);
  return element;
}

const document = {
  createElement,
  querySelector(selector) {
    const tagName = selector.startsWith('link') ? 'link' : 'script';
    return elements.find(element => element.tagName === tagName
      && element.dataset.quillLoader === 'true' && !element.removed) || null;
  },
  head: { appendChild() {} },
};
const context = vm.createContext({ document, window: {} });
vm.runInContext(source, context);

const firstLoad = context.__ensureQuill();
const firstLink = elements.find(element => element.tagName === 'link');
const firstScript = elements.find(element => element.tagName === 'script');
assert.ok(firstLink && firstScript, 'first load did not create Quill resources');

firstScript.dispatch('error');
await assert.rejects(firstLoad, /Quill 편집기/);

const retryLoad = context.__ensureQuill();
const activeLinks = elements.filter(element => element.tagName === 'link' && !element.removed);
const activeScripts = elements.filter(element => element.tagName === 'script' && !element.removed);
assert.equal(activeLinks.length, 1, 'retry duplicated the pending stylesheet');
assert.equal(activeScripts.length, 1, 'retry did not replace the failed script');

context.window.Quill = function Quill() {};
activeScripts[0].dispatch('load');
let retrySettled = false;
retryLoad.finally(() => { retrySettled = true; });
await Promise.resolve();
assert.equal(retrySettled, false, 'Quill resolved before the pending stylesheet loaded');

firstLink.dispatch('load');
assert.equal(await retryLoad, context.window.Quill, 'retry did not return the Quill constructor');

console.log('quill loader: pending CSS and failed script retry passed');
