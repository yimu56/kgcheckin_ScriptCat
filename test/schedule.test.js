/**
 * 随机延迟回归测试（离线）
 *
 * 背景：@crontab 命中的是时间窗里的第一个时刻（`* 1-6 once * *` 落在 01:00:00），
 * 每天同一秒发起签到，时间特征过于规整。现在改成触发后先随机等一段时间再签到，
 * 这里校验这段随机延迟的取值范围、边界处理，以及「只有定时任务会等」这一点。
 *
 * 注意：定时任务用整分钟做单位，所以「打散」的效果是分钟级的——这是刻意的，
 * 秒级抖动没有意义，反而会让人怀疑是脚本。
 */

const assert = require('node:assert');
const fs = require('node:fs');
const { loadScript, SCRIPT_PATH } = require('./harness');

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

const MIN = 60000;
const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

(async function main() {
  console.log('随机延迟测试\n');

  const { api } = loadScript({ silent: true });
  const pick = api.pickRandomDelayMs;
  check('导出了 pickRandomDelayMs', typeof pick, 'function');

  /* ---------- 1. 关闭与固定值 ---------- */

  console.log('1) 关闭 / 固定值');
  check('上下限都填 0 → 不等待', pick(0, 0), 0);
  check('上下限相同 → 固定等待', pick(5, 5), 5 * MIN);
  check('负数按 0 处理', pick(-10, -1), 0);

  /* ---------- 2. 区间是闭区间 ---------- */

  console.log('\n2) 闭区间 [下限, 上限]');
  check('随机数为 0 → 取下限', pick(2, 10, () => 0), 2 * MIN);
  check('随机数接近 1 → 取上限', pick(2, 10, () => 0.999999), 10 * MIN);
  check('随机数为 1 → 仍取上限（不越界）', pick(2, 10, () => 1), 10 * MIN);
  check('随机数越界（负数）→ 取下限', pick(2, 10, () => -3), 2 * MIN);

  /* ---------- 3. 真的落在区间里，而且真的被打散 ---------- */

  console.log('\n3) 取值分布');
  {
    const seen = new Set();
    let outOfRange = 0;
    for (let i = 0; i < 400; i++) {
      const ms = pick(1, 60);
      const min = ms / MIN;
      if (!Number.isInteger(min) || min < 1 || min > 60) outOfRange++;
      seen.add(min);
    }
    check('400 次抽样全部落在 [1, 60] 分钟的整数分钟上', outOfRange, 0);
    check('抽样值已打散（出现多个不同取值）', seen.size > 20, true);
  }

  /* ---------- 4. 上下限写反了也能用 ---------- */

  console.log('\n4) 上下限颠倒');
  {
    let outOfRange = 0;
    for (let i = 0; i < 200; i++) {
      const min = pick(30, 10) / MIN;
      if (min < 10 || min > 30) outOfRange++;
    }
    check('下限 30 / 上限 10 → 仍落在 [10, 30]', outOfRange, 0);
  }

  /* ---------- 5. 非法配置不会造出离谱的等待 ---------- */

  console.log('\n5) 非法配置');
  check('全部空值 → 0', pick(undefined, undefined, () => 0.5), 0);
  check('非数字 → 0', pick('abc', 'xyz', () => 0.5), 0);
  check('上限 NaN、下限 0 → 0', pick(0, NaN, () => 0.5), 0);
  check('随机数不是数字 → 取下限', pick(4, 8, () => NaN), 4 * MIN);
  {
    let tooLong = 0;
    for (let i = 0; i < 200; i++) {
      if (pick(1, 720) > 720 * MIN) tooLong++;
    }
    check('默认外的最长等待不超过配置上限', tooLong, 0);
  }

  /* ---------- 6. 上限为 0 时等于关闭（只填上限那种写法） ---------- */

  console.log('\n6) 只填了上限 0');
  check('下限 0 / 上限 0 → 0', pick(0, 0, () => 0.7), 0);
  check('下限 0 / 上限 1 → 随机数小时不等待', pick(0, 1, () => 0), 0);
  check('下限 0 / 上限 1 → 随机数大时等 1 分钟', pick(0, 1, () => 0.99), MIN);

  /* ---------- 7. 等待真的会发生（0 延迟路径不阻塞） ---------- */

  console.log('\n7) waitRandomDelay');
  {
    const { api: api2, logs: logs2 } = loadScript({
      silent: true,
      store: { '签到.KG_RANDOM_DELAY_MIN': 0, '签到.KG_RANDOM_DELAY_MAX': 0 },
    });
    const ms = await api2.waitRandomDelay();
    check('配置为 0 时不等待', ms, 0);
    check('日志说明了不等待的原因', logs2.some((l) => /随机延迟为 0/.test(l)), true);
  }

  /* ---------- 8. 源码级：只有定时任务会等，手动签到不等 ---------- */

  console.log('\n8) 调用点');
  const runScheduledBody = src.match(/async function runScheduled\(\)\s*\{([\s\S]*?)\n  \}/);
  check('找得到 runScheduled', Boolean(runScheduledBody), true);
  check('runScheduled 在签到前先等待随机延迟', Boolean(runScheduledBody) && /await waitRandomDelay\(\)[\s\S]*await runSign\(\)/.test(runScheduledBody[1]), true);

  const menuBody = src.match(/add\('④ 立即签到[\s\S]*?'kg-run-now'\);/);
  check('找得到「④ 立即签到」菜单', Boolean(menuBody), true);
  check('手动签到直接跑 runSign，不经过随机延迟', Boolean(menuBody) && /runSign\(\)/.test(menuBody[0]) && !/waitRandomDelay/.test(menuBody[0]), true);

  /* ---------- 9. 串起来：延迟为 0 时 runScheduled 一路走到签到 ---------- */

  console.log('\n9) runScheduled 串联（0 延迟 + 没配账号，不联网）');
  {
    const { api: api3, logs: logs3 } = loadScript({
      silent: true,
      store: { '签到.KG_RANDOM_DELAY_MIN': 0, '签到.KG_RANDOM_DELAY_MAX': 0 },
    });
    const ret = await api3.runScheduled().then(() => 'ok', (e) => e);
    check('没配账号时不会返回 ok', ret === 'ok', false);
    check('抛出的是可操作的「未配置账号」', /未配置账号/.test(String(ret && ret.message)), true);
    const started = logs3.findIndex((l) => /定时任务启动/.test(l));
    const skipped = logs3.findIndex((l) => /随机延迟为 0/.test(l));
    check('日志顺序：先启动、再跳过延迟', started >= 0 && skipped > started, true);
  }

  console.log(`\n随机延迟：${pass} 项通过，${fail} 项失败`);
  if (fail) process.exitCode = 1;
})().catch((e) => {
  console.error('测试异常：', (e && e.message) || e);
  process.exitCode = 1;
});
