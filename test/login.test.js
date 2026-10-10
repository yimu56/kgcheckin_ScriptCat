/**
 * 登录入口 / 手机号登录流程测试（离线）
 *
 * 覆盖两件容易出事的事：
 *   1. 菜单注册 —— 有 CAT_registerMenuInput 时手机号/验证码直接在弹出层输入；
 *      没有时退回普通菜单（改从配置读）。两条路都要能用。
 *   2. 失败时的报错 —— 服务端把原因放在 data 字段（例如 "验证码过期"），
 *      这个信息不能被日志脱敏函数吞掉，否则用户只看到一串错误码。
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

/** 假的 xhr：按 URL 返回预设的响应 */
function stubXhr(responder) {
  return (options) => {
    setTimeout(() => {
      const body = responder(options) || { status: 1 };
      options.onload &&
        options.onload({
          status: 200,
          responseHeaders: 'content-type: application/json',
          responseText: typeof body === 'string' ? body : JSON.stringify(body),
        });
    }, 0);
  };
}

(async function main() {
  console.log('登录流程测试\n');

  /* ---------- 1. 菜单注册：新版脚本猫（带输入框） ---------- */

  console.log('1) 菜单注册 —— 有 CAT_registerMenuInput 时');
  {
    const { api, menus } = loadScript({ silent: true, menuInput: true });
    api.registerMenus();

    check('注册了 6 个菜单', menus.length, 6);

    // 只有需要用户输入的 ②③ 走带输入框的 API，其余 4 个走普通菜单
    const inputMenus = menus.filter((m) => m.api === 'CAT_registerMenuInput');
    const plainMenus = menus.filter((m) => m.api === 'GM_registerMenuCommand');
    check('2 个菜单带输入框', inputMenus.length, 2);
    check('其余 4 个走普通菜单', plainMenus.length, 4);
    check('带输入框的正好是发短信和登录', inputMenus.every((m) => /发送短信|手机号登录/.test(m.name)), true);

    const sms = menus.find((m) => m.name.includes('发送短信验证码'));
    check('发短信菜单能输入手机号', sms.options.inputType, 'text');
    check('发短信菜单有输入提示', sms.options.inputLabel, '手机号');

    const login = menus.find((m) => m.name.includes('手机号登录'));
    check('登录菜单能输入验证码', login.options.inputType, 'text');
    check('登录菜单有输入提示', login.options.inputLabel, '短信验证码');

    check('每个菜单都带了稳定 id', menus.every((m) => Boolean(m.options.id)), true);
    check('id 不重复', new Set(menus.map((m) => m.options.id)).size, menus.length);
  }

  /* ---------- 2. 菜单注册：老版本 / 其它管理器 ---------- */

  console.log('\n2) 菜单注册 —— 没有 CAT_registerMenuInput 时退回普通菜单');
  {
    const { api, menus } = loadScript({ silent: true, menuInput: false });
    api.registerMenus();

    check('注册了 6 个菜单', menus.length, 6);
    check('全部走普通 GM_registerMenuCommand', menus.every((m) => m.api === 'GM_registerMenuCommand'), true);
    check('菜单名说明用配置里的值', menus.some((m) => m.name.includes('用配置里的手机号')), true);
    check('菜单名说明用配置里的值(验证码)', menus.some((m) => m.name.includes('用配置里的验证码')), true);
  }

  /* ---------- 3. 发短信：参数校验 ---------- */

  console.log('\n3) 发送短信验证码的参数校验');
  {
    const { api } = loadScript({ silent: true });
    await api.sendSmsCode('').then(
      () => check('空手机号应报错', 'no-throw', 'throw'),
      (e) => check('空手机号提示可操作', /没填手机号/.test(e.message), true)
    );
    await api.sendSmsCode('1234').then(
      () => check('短手机号应报错', 'no-throw', 'throw'),
      (e) => check('短手机号提示格式', /手机号格式不对/.test(e.message), true)
    );
  }

  /* ---------- 4. 发短信：成功后记住手机号 ---------- */

  console.log('\n4) 验证码发送成功后记住手机号');
  {
    const { api, store, logs } = loadScript({ silent: true, xhr: stubXhr(() => ({ status: 1 })) });
    await api.sendSmsCode('13800000000');
    check('手机号被记住（下一步不用再填）', store.get(api.KEY_PHONE), '13800000000');
    check('不去改动用户的脚本配置', store.has('登录.KG_PHONE'), false);
    check('脱敏格式只露前 2 后 2', api.maskPhone('13800000000'), '13*******00');
    check('日志里手机号已脱敏', logs.some((l) => /验证码已发送到 13\*{7}00/.test(l)), true);
    check('日志说明手机号来源', logs.some((l) => /来源：菜单输入框/.test(l)), true);
    check('日志没有出现完整手机号', !logs.join('\n').includes('13800000000'), true);
  }

  /* ---------- 4b. 手机号来源优先级（这次就是这里出的问题） ---------- */

  console.log('\n4b) 手机号从哪来：输入框 > 上次用过 > 脚本配置');
  {
    // 只填了脚本配置 —— 老式菜单点击（listener 收不到输入）也必须能发出去
    const { api, logs } = loadScript({
      silent: true,
      store: { '登录.KG_PHONE': '13900000001' },
      xhr: stubXhr(() => ({ status: 1 })),
    });
    await api.sendSmsCode(undefined);
    check('配置里有手机号就能发', logs.some((l) => /来源：脚本配置/.test(l)), true);
    check('用的就是配置里那个号', logs.some((l) => /13\*{7}01/.test(l)), true);
  }
  {
    // 记忆值优先于配置
    const { api, logs } = loadScript({
      silent: true,
      store: { 'kg_phone': '13800000002', '登录.KG_PHONE': '13900000009' },
      xhr: stubXhr(() => ({ status: 1 })),
    });
    await api.sendSmsCode(undefined);
    check('记忆值优先于配置', logs.some((l) => /来源：上次用过的手机号/.test(l) && /13\*{7}02/.test(l)), true);
  }
  {
    // 输入框优先于一切
    const { api, logs } = loadScript({
      silent: true,
      store: { 'kg_phone': '13800000008', '登录.KG_PHONE': '13900000009' },
      xhr: stubXhr(() => ({ status: 1 })),
    });
    await api.sendSmsCode('13700000003');
    check('输入框优先于一切', logs.some((l) => /来源：菜单输入框/.test(l) && /13\*{7}03/.test(l)), true);
  }
  {
    // 三处都没有 → 报错要把两种填法都说清楚
    const { api } = loadScript({ silent: true });
    await api.sendSmsCode(undefined).then(
      () => check('三处都没填应报错', 'no-throw', 'throw'),
      (e) => check('报错里给出两种填法', /输入框/.test(e.message) && /脚本配置/.test(e.message), true)
    );
  }

  /* ---------- 5. 登录：直接用输入框里的验证码 + 记住的手机号 ---------- */

  console.log('\n5) 用记住的手机号 + 弹框输入的验证码登录');
  {
    let sentBody = null;
    const { api, store } = loadScript({
      silent: true,
      store: { 'kg_phone': '13800000000' },
      xhr: stubXhr((options) => {
        sentBody = JSON.parse(options.data);
        return { status: 1, data: { userid: '999', token: 'tok-abc' } };
      }),
    });
    await api.phoneLogin('123456');
    check('账号已写入配置', /"userid": *"999"/.test(store.get('账号.USERINFO')), true);
    check('token 已写入配置', /"token": *"tok-abc"/.test(store.get('账号.USERINFO')), true);

    // 顺带把登录请求的结构钉死（服务端已确认接受这套字段）
    check('请求发到了登录接口', sentBody !== null, true);
    check('手机号取自记忆值（打码后提交）', sentBody.mobile, '13*****0');
    check('plat = 1', sentBody.plat, 1);
    check('support_multi = 1', sentBody.support_multi, 1);
    check('带上了 AES 密文 params', /^[0-9a-f]{32,}$/.test(sentBody.params), true);
    check('带上了 RSA 密文 pk（大写 hex）', /^[0-9A-F]{256}$/.test(sentBody.pk), true);
    check('带上了 t3 占位', sentBody.t3, 'MCwwLDAsMCwwLDAsMCwwLDA=');
    check('带上了 signParamsKey', /^[0-9a-f]{32}$/.test(sentBody.key), true);
  }

  /* ---------- 6. 登录：没验证码 / 没手机号 ---------- */

  console.log('\n6) 登录参数缺失时的提示');
  {
    const { api } = loadScript({ silent: true, store: { 'kg_phone': '13800000000' } });
    await api.phoneLogin('').then(
      () => check('空验证码应报错', 'no-throw', 'throw'),
      (e) => check('空验证码提示可操作', /没填验证码/.test(e.message), true)
    );

    const { api: api2 } = loadScript({ silent: true });
    await api2.phoneLogin('123456').then(
      () => check('没手机号应报错', 'no-throw', 'throw'),
      (e) => check('没手机号提示可操作', /不知道用哪个手机号/.test(e.message), true)
    );
  }

  /* ---------- 7. 失败原因要说人话 ---------- */

  console.log('\n7) 服务端失败原因要能被识别出来');
  {
    const { api, logs } = loadScript({ silent: true });
    check('20020 → 验证码过期提示', /验证码错误或已过期/.test(api.errorTextOf({ error_code: 20020 })), true);
    check('34175 → 多账号提示', /绑定了多个账号/.test(api.errorTextOf({ error_code: 34175 })), true);
    check('未知错误码回落到 data 文本', api.errorTextOf({ error_code: 9, data: '服务端说的一句话' }), '服务端说的一句话');
    // 关键回归点：data 是字符串时不能被脱敏函数丢掉
    check(
      'summarizeResponse 保留 data 文本',
      api.summarizeResponse({ status: 0, error_code: 20020, data: '验证码过期' }).data,
      '验证码过期'
    );

    const { api: api3, logs: logs3 } = loadScript({
      silent: true,
      store: { 'kg_phone': '13800000000' },
      xhr: stubXhr(() => ({ status: 0, error_code: 20020, data: '验证码过期' })),
    });
    await api3.phoneLogin('000000').catch((e) => {
      check('登录失败时提示带上原因', /验证码错误或已过期/.test(e.message), true);
    });
    check('日志里也带上了原因', logs3.some((l) => /验证码过期/.test(l)), true);
  }

  console.log(`\n登录流程：${pass} 项通过，${fail} 项失败`);
  if (fail) process.exitCode = 1;
})().catch((e) => {
  console.error('测试异常：', (e && e.message) || e);
  process.exitCode = 1;
});
