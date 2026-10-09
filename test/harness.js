/**
 * 测试台：把 kgcheckin.user.js 装进一个"假 GM 环境"里跑。
 *
 * 脚本源码顶层是 `return (...)`（ScriptCat 后台脚本约定），
 * 所以这里用 `(function(){ ... })()` 包一层再丢进 vm，才能拿到它返回的 Promise。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const https = require('node:https');

const SCRIPT_PATH = path.join(__dirname, '..', 'kgcheckin.user.js');

/** 用 Node 内置模块顶掉 GM_xmlhttpRequest */
function nodeXhr(options) {
  let target;
  try {
    target = new URL(options.url);
  } catch (e) {
    options.onerror && options.onerror({ error: 'bad url' });
    return;
  }
  const lib = target.protocol === 'https:' ? https : http;
  const req = lib.request(
    target,
    { method: String(options.method || 'GET').toUpperCase(), headers: options.headers || {} },
    (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        options.onload &&
          options.onload({
            status: res.statusCode,
            responseHeaders: Object.entries(res.headers)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
              .join('\r\n'),
            responseText: Buffer.concat(chunks).toString('utf8'),
          });
      });
      res.on('error', () => options.onerror && options.onerror({ error: 'response error' }));
    }
  );
  req.setTimeout(options.timeout || 15000, () => {
    req.destroy();
    options.ontimeout && options.ontimeout();
  });
  req.on('error', () => options.onerror && options.onerror({ error: 'network error' }));
  if (options.data !== undefined && options.data !== null) req.write(options.data);
  req.end();
}

/**
 * @param {object} [opts]
 * @param {Record<string,any>} [opts.store] 预置的 GM 存储
 * @param {boolean} [opts.verbose] 是否打印脚本日志
 * @param {boolean} [opts.silent] 是否屏蔽脚本侧日志
 * @param {Function} [opts.xhr] 自定义 GM_xmlhttpRequest 实现
 * @param {boolean} [opts.injectAsScope] 模拟脚本猫的真实注入方式：
 *   GM_* 只存在于脚本的作用域里，不挂在 globalThis 上（这正是脚本里那个坑）。
 */
function loadScript(opts = {}) {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  let api = null;
  const store = new Map(Object.entries(opts.store || {}));
  const logs = [];
  const xhr = opts.xhr || nodeXhr;

  const gmLog = (m) => {
    logs.push(String(m));
    if (opts.verbose) console.log('  · ' + m);
  };

  const sandbox = {
    console: opts.silent ? { log() {}, error() {}, warn() {} } : console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Promise,
    Math,
    JSON,
    Date,
    Number,
    String,
    Object,
    Array,
    Error,
    RegExp,
    Map,
    Set,
    Infinity,
    __KG_TEST_HOOK__: (a) => {
      api = a;
    },
  };

  let wrapped;
  if (opts.injectAsScope) {
    // 把 GM_* 定义成"脚本作用域里的局部变量"，并刻意不放进 globalThis。
    sandbox.__store__ = store;
    sandbox.__xhr__ = xhr;
    sandbox.__gmLog__ = gmLog;
    const prelude = [
      'const GM_log = globalThis.__gmLog__;',
      'const GM_getValue = (k, d) => (globalThis.__store__.has(k) ? globalThis.__store__.get(k) : d);',
      'const GM_setValue = (k, v) => { globalThis.__store__.set(k, v); };',
      'const GM_deleteValue = (k) => { globalThis.__store__.delete(k); };',
      'const GM_notification = () => {};',
      'const GM_registerMenuCommand = () => {};',
      'const GM_openInTab = () => {};',
      'const GM_xmlhttpRequest = globalThis.__xhr__;',
      '',
    ].join('\n');
    wrapped = `(function(){\n${prelude}${src}\n})()`;
  } else {
    sandbox.GM_log = gmLog;
    sandbox.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
    sandbox.GM_setValue = (k, v) => {
      store.set(k, v);
    };
    sandbox.GM_deleteValue = (k) => {
      store.delete(k);
    };
    sandbox.GM_notification = () => {};
    sandbox.GM_registerMenuCommand = () => {};
    sandbox.GM_openInTab = () => {};
    sandbox.GM_xmlhttpRequest = xhr;
    wrapped = `(function(){\n${src}\n})()`;
  }

  const context = vm.createContext(sandbox);
  const promise = vm.runInContext(wrapped, context, { filename: 'kgcheckin.user.js' });

  if (!api) throw new Error('脚本没有导出测试钩子（__KG_TEST_HOOK__ 未生效）');
  return { api, promise, store, logs, sandbox, context };
}

module.exports = { loadScript, SCRIPT_PATH, nodeXhr };
