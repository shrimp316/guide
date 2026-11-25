import { run } from './engine.js';
self.onmessage = async (e) => {
  try {
    const r = await run(e.data, (f, p) => self.postMessage({ type: 'progress', f, p }));
    self.postMessage({ type: 'done', r });
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
self.postMessage({ type: 'ready' });
