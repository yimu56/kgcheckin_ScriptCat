/**
 * 签到主流程集成测试（需要联网）
 *
 * 用一个无效 token 跑完整的 runSign()，验证：
 *   · 账号读取 → 账号校验 → 通知 → 错误汇总 整条链路不会崩
 *   · token 失效时能给出明确的失败结论，而不是抛一堆看不懂的错
 *   · 没配账号时给出可操作的提示
 *
 * 不会领取任何东西、不会发任何真实通知（通知渠道都是空的）。
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

async function expectThrow(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

(async function main() {
  console.log('签到主流程集成测试\n');

  /* ---------- 1. 没配账号时 ---------- */

  console.log('1) 没配账号');
  {
    const { api } = loadScript({ silent: true });
    const err = await expectThrow(() => api.runSign());
    check('抛出异常', Boolean(err), true);
    check('提示语可操作', /未配置账号/.test(err.message), true);
  }

  /* ---------- 2. 账号列表 JSON 非法时 ---------- */

  console.log('\n2) 账号列表 JSON 非法');
  {
    const { api, logs } = loadScript({ silent: true, store: { '账号.USERINFO': '这不是 JSON' } });
    const err = await expectThrow(() => api.runSign());
    check('抛出「未配置账号」', /未配置账号/.test(err.message), true);
    check('日志里有配置解析提示', logs.some((l) => /不是合法 JSON/.test(l)), true);
  }

  /* ---------- 3. 无效 token 走完整流程 ---------- */

  console.log('\n3) 无效 token 跑完整签到流程');
  {
    const { api, logs } = loadScript({
      silent: true,
      store: {
        '账号.USERINFO': JSON.stringify([{ userid: '1', token: '0123456789abcdef' }]),
        'kg_userinfo_sync': JSON.stringify([{ userid: '1', token: '0123456789abcdef' }]),
        '签到.KG_REFRESH_WEEKDAY': -1, // 关掉续期，避免测试里做无意义的写操作
      },
    });
    const err = await expectThrow(() => api.runSign());
    check('抛出「领取异常」', err && err.message, '领取异常');
    check('日志记录了账号数', logs.some((l) => /共读取到 1 个账号/.test(l)), true);
    check('日志给出了 token 失效结论', logs.some((l) => /token 过期或账号不存在/.test(l)), true);
    check('日志里的 userid 已脱敏', logs.some((l) => l.includes('token 过期或账号不存在')) && !logs.join('\n').includes('0123456789abcdef'), true);
    check('走了通知流程', logs.some((l) => /\[通知\]/.test(l)), true);
  }

  /* ---------- 4. 账号合并逻辑（配置 + 本地快照） ---------- */

  console.log('\n4) 账号合并（配置 + 快照，快照里的新 token 优先）');
  {
    const { api } = loadScript({
      silent: true,
      store: {
        '账号.USERINFO': JSON.stringify([{ userid: '1', token: 'old-token' }]),
        'kg_userinfo_sync': JSON.stringify([{ userid: '1', token: 'old-token' }]),
        'kg_userinfo_snapshot': [{ userid: '1', token: 'new-token' }],
      },
    });
    const info = api.readUsers();
    check('合并后仍是 1 个账号', info.users.length, 1);
    check('采用快照里的新 token', info.users[0].token, 'new-token');
  }

  console.log('\n5) 手动改过配置后，以配置为准（快照里的旧账号不再复活）');
  {
    const { api } = loadScript({
      silent: true,
      store: {
        '账号.USERINFO': JSON.stringify([{ userid: '2', token: 't2' }]),
        'kg_userinfo_sync': JSON.stringify([{ userid: '1', token: 't1' }]),
        'kg_userinfo_snapshot': [{ userid: '1', token: 't1' }],
      },
    });
    const info = api.readUsers();
    check('只剩配置里的账号', info.users.length, 1);
    check('userid 是配置里那个', String(info.users[0].userid), '2');
  }

  console.log(`\n主流程：${pass} 项通过，${fail} 项失败`);
  if (fail) process.exitCode = 1;
})().catch((e) => {
  console.error('测试异常：', (e && e.message) || e);
  process.exitCode = 1;
});
