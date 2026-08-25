const QUILL_VERSION = '2.0.2';
const QUILL_BASE_URL = `https://cdn.jsdelivr.net/npm/quill@${QUILL_VERSION}/dist`;

let quillStylePromise;
let quillScriptPromise;
let quillLoadPromise;

function loadStylesheet() {
  if (quillStylePromise) return quillStylePromise;
  quillStylePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('link[data-quill-loader]');
    const link = existing || document.createElement('link');
    if (link.dataset.quillLoaded === 'true') {
      resolve();
      return;
    }
    const onLoad = () => {
      link.dataset.quillLoaded = 'true';
      resolve();
    };
    const onError = () => {
      link.remove();
      quillStylePromise = undefined;
      reject(new Error('Quill 스타일시트를 불러오지 못했습니다.'));
    };
    link.addEventListener('load', onLoad, { once: true });
    link.addEventListener('error', onError, { once: true });
    if (existing) return;
    link.rel = 'stylesheet';
    link.href = `${QUILL_BASE_URL}/quill.snow.css`;
    link.dataset.quillLoader = 'true';
    document.head.appendChild(link);
  });
  return quillStylePromise;
}

function loadScript() {
  if (window.Quill) return Promise.resolve(window.Quill);
  if (quillScriptPromise) return quillScriptPromise;
  quillScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-quill-loader]');
    const script = existing || document.createElement('script');
    const onLoad = () => {
      if (window.Quill) {
        resolve(window.Quill);
        return;
      }
      script.remove();
      quillScriptPromise = undefined;
      reject(new Error('Quill 전역 객체를 찾을 수 없습니다.'));
    };
    const onError = () => {
      script.remove();
      quillScriptPromise = undefined;
      reject(new Error('Quill 편집기를 불러오지 못했습니다.'));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = `${QUILL_BASE_URL}/quill.js`;
      script.dataset.quillLoader = 'true';
      document.head.appendChild(script);
    }
  });
  return quillScriptPromise;
}

export function ensureQuill() {
  if (!quillLoadPromise) {
    quillLoadPromise = Promise.all([loadStylesheet(), loadScript()])
      .then(([, Quill]) => Quill)
      .catch(error => {
        quillLoadPromise = undefined;
        throw error;
      });
  }
  return quillLoadPromise;
}
