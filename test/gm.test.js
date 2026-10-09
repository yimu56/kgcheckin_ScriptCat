/**
 * GM 函数解析回归测试
 *
 * 背景：脚本猫（以及多数油猴兼容管理器）把 GM_* 注入到「脚本执行的作用域」里，
 * 而不是挂在 globalThis 上。之前脚本用 globalThis[name] 去取，导致
 * GM_log / GM_openInTab / GM_notification 等全部被判定成不存在，
 * 用户点「扫码登录」看不到日志、也弹不出二维码标签页。
 *
 * 这里用 injectAsScope 模式模拟脚本猫的真实注入方式，验证两种注入都能被正确解析。
 */

const assert = require('node:assert');
const { loadScript } = require('./harness');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}\n      期望 ${expected}\n      实际 ${actual}`);
  }
}

const GM_NAMES = [
  'GM_log',
  'GM_xmlhttpRequest',
  'GM_notification',
  'GM_getValue',
  'GM_setValue',
  'GM_registerMenuCommand',
  'GM_openInTab',
];

(async function main() {
  console.log('GM 函数解析回归测试\n');

  console.log('1) GM_* 挂在 globalThis 上（旧式注入）');
  {
    const { api } = loadScript({ silent: true });
    GM_NAMES.forEach((n) => check(`能解析到 ${n}`, typeof api.resolveGM(n), 'function'));
  }

  console.log('\n2) GM_* 只注入作用域、不挂 globalThis（模拟脚本猫）');
  {
    const { api, sandbox } = loadScript({ silent: true, injectAsScope: true });
    // 先确认 globalThis 上确实没有（否则测不出问题）
    check('globalThis.GM_openInTab 确实是 undefined', typeof sandbox.GM_openInTab, 'undefined');
    check('globalThis.GM_log 确实是 undefined', typeof sandbox.GM_log, 'undefined');

    GM_NAMES.forEach((n) => check(`作用域里能解析到 ${n}`, typeof api.resolveGM(n), 'function'));
  }

  console.log('\n3) 作用域注入下，日志真的能写进运行日志（而不是落到 console）');
  {
    // 用一个快速失败的假 xhr，避免真的联网
    const failingXhr = (options) => {
      setTimeout(() => options.onerror && options.onerror({ error: 'stub' }), 0);
    };
    const account = JSON.stringify([{ userid: '1', token: 'x' }]);
    const { api, logs } = loadScript({
      silent: true,
      injectAsScope: true,
      xhr: failingXhr,
      store: {
        '账号.USERINFO': account,
        'kg_userinfo_sync': account,
        '签到.KG_REFRESH_WEEKDAY': -1,
        '通知.KG_NOTIFY_SYSTEM': false,
      },
    });
    await api.runSign().catch(() => {});
    check('日志被 GM_log 收到', logs.some((l) => /共读取到 1 个账号/.test(l)), true);
    check('没有因为取不到 GM 函数而报错', logs.length > 0, true);
  }

  console.log(`\nGM 解析：${pass} 项通过，${fail} 项失败`);
  if (fail) process.exitCode = 1;
})().catch((e) => {
  console.error('测试异常：', (e && e.message) || e);
  process.exitCode = 1;
});
