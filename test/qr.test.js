/**
 * 二维码编码器交叉验证
 *
 * 参考数据来自两个独立实现（见 test/qr-reference.json 的 note 字段）：
 *   · Python qrcode 库 —— 按 ISO/IEC 18004 计算掩码罚分，给出"标准答案矩阵"
 *   · npm qrcode 包    —— 给出「指定版本 + 指定掩码」下的矩阵，用来逐位对拍
 *
 * 只有 版本 / 掩码 / 矩阵 三者全一致，扫出来的内容才可能与预期相同。
 * 平时跑这个测试不需要 npm 和 Python，全部数据都在 fixture 里。
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./harness');

const { api } = loadScript({ silent: true });
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'qr-reference.json'), 'utf8'));

let pass = 0;
let fail = 0;

/**
 * 用 JSON 序列化后比较。
 * 不能直接用 assert.deepStrictEqual：脚本跑在 vm 沙箱里，它返回的数组
 * 属于另一个 realm，原型不同，deepStrictEqual 会误判为不等。
 */
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
    if (process.env.QR_TEST_VERBOSE) {
      console.log(`      期望 ${String(b).slice(0, 160)}`);
      console.log(`      实际 ${String(a).slice(0, 160)}`);
    }
  }
}

/** 把 0101 字符串矩阵转成布尔矩阵 */
const toBools = (rows) => rows.map((r) => Array.from(r).map((c) => c === '1'));
/** 把布尔矩阵转成 0101 字符串矩阵 */
const toStr = (m) => m.map((row) => row.map((v) => (v ? '1' : '0')).join(''));

console.log(`参考用例：${fixture.cases.length} 组\n`);

/* ============ 1. 版本选择 ============ */

console.log('版本选择：');
fixture.cases.forEach((c, i) => {
  check(`自动版本 #${i}（${c.text.length} 字节）`, api.qrEncode(c.text).version, c.version);
});

/* ============ 2. 指定版本 + 指定掩码，与 npm 逐位对拍 ============ */

console.log('矩阵逐位对拍（指定版本 + 指定掩码，对照 npm qrcode）：');
let matrixChecks = 0;
fixture.cases.forEach((c, i) => {
  for (let mask = 0; mask < 8; mask++) {
    const mine = toStr(api.qrEncode(c.text, c.version, mask).modules);
    check(`载荷#${i} v${c.version} mask=${mask}`, mine, c.forcedMatrices[String(mask)]);
    matrixChecks++;
  }
});
console.log(`  载荷级：${matrixChecks} 组`);

// 每个版本都塞满容量再对拍一遍，覆盖全部容量表 / 分块表
let versionChecks = 0;
fixture.cases.forEach((c, i) => {
  Object.keys(c.byVersion).forEach((versionKey) => {
    const version = Number(versionKey);
    const item = c.byVersion[versionKey];
    Object.keys(item.matrices).forEach((maskKey) => {
      const mask = Number(maskKey);
      const mine = toStr(api.qrEncode(item.text, version, mask).modules);
      check(`v${version} 满容量 mask=${mask}`, mine, item.matrices[maskKey]);
      versionChecks++;
    });
  });
  if (i === 0) {
    console.log(`  容量级：${versionChecks} 组（版本 1~10 各 3 个掩码，内容填满该版本容量）`);
  }
});

/* ============ 3. 掩码罚分与掩码选择 ============ */

console.log('掩码罚分 / 自动掩码（对照 ISO/IEC 18004 罚分）：');
fixture.cases.forEach((c, i) => {
  const expectedPoints = c.lostPoints;

  // 罚分函数逐档对拍
  const minePoints = [];
  for (let mask = 0; mask < 8; mask++) {
    minePoints.push(api.qrPenalty(api.qrEncode(c.text, c.version, mask).modules));
  }
  check(`罚分 #${i}`, minePoints, expectedPoints);

  /*
   * 期望掩码取「真实罚分」的最小值。
   *
   * 这里刻意不用 Python 的 best_mask_pattern()：python-qrcode 在挑掩码时用
   * makeImpl(test=True) 评估，而 test 模式下格式信息位全被写成 0，
   * 相当于拿"没有格式信息"的图去算罚分（ZXing 和 ISO 规范都是带格式信息算的）。
   * fixture 里的 pythonAutoMask 字段保留下来，仅用于观察两者差异。
   */
  const expectedMask = expectedPoints.indexOf(Math.min(...expectedPoints));

  const auto = api.qrEncode(c.text);
  check(`自动掩码 #${i}`, auto.mask, expectedMask);
  check(`自动掩码罚分最优 #${i}`, api.qrPenalty(auto.modules), expectedPoints[expectedMask]);

  // 最终成图：与 npm 在同一版本 + 同一掩码下的矩阵逐位一致
  check(`最终成图 #${i}`, toStr(auto.modules), c.forcedMatrices[String(auto.mask)]);

  // 与 Python 的成图对比（当两边选的掩码相同时才有可比性）
  if (c.pythonAutoMask === auto.mask) {
    check(`Python 成图一致 #${i}`, toStr(auto.modules), c.autoMatrix);
  }
});

/* ============ 4. 字符二维码渲染 ============ */

console.log('字符二维码渲染：');
const sample = api.qrEncode(fixture.cases[0].text);
const lines = api.qrToText(sample.modules, 2).split('\n');
const expectedSize = sample.modules.length + 4;

check('字符行数（两行模块一行文本）', lines.length, Math.ceil(expectedSize / 2));
check('行宽一致', new Set(lines.map((l) => Array.from(l).length)).size, 1);
check('行宽正确', Array.from(lines[0]).length, expectedSize);
check('只含半块字符与空格', /^[\u2588\u2580\u2584 ]+$/.test(lines.join('')), true);
check('右上角是定位图案（外圈实心）', lines[2][4], '\u2588');
check('留了静区（首行全空）', lines[0].trim(), '');

/** 把字符二维码还原成矩阵（上下左右静区都要去掉），必须与原矩阵一致，否则扫不出来 */
function decodeFromText(text, quiet) {
  const rows = text.split('\n');
  const size = Array.from(rows[0]).length - quiet * 2;
  const all = [];
  for (const row of rows) {
    const chars = Array.from(row);
    const top = [];
    const bottom = [];
    for (let c = 0; c < chars.length; c++) {
      const ch = chars[c];
      top.push(ch === '\u2588' || ch === '\u2580');
      bottom.push(ch === '\u2588' || ch === '\u2584');
    }
    all.push(top);
    all.push(bottom);
  }
  return all.slice(quiet, quiet + size).map((r) => r.slice(quiet, quiet + size));
}
check('字符二维码可无损还原', decodeFromText(api.qrToText(sample.modules, 2), 2), toBools(toStr(sample.modules)));

/* ============ 5. 边界与自检 ============ */

console.log('边界与自检：');
try {
  api.qrEncode('x'.repeat(500));
  check('超长内容应报错', 'no-throw', 'throw');
} catch (e) {
  check('超长内容应报错', 'throw', 'throw');
}
// 版本表在脚本加载时自检过（数据码字 + 纠错码字 == 该版本总码字），这里再确认一次能正常出图
check('最大版本可正常出图', api.qrEncode('y'.repeat(213)).version, 10);
check('空内容也可出图', typeof api.qrEncode('').modules.length, 'number');

console.log(`\n二维码：${pass} 项通过，${fail} 项失败`);
if (fail) process.exitCode = 1;
