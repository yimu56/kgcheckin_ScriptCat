/**
 * 生成 test/qr-reference.json（二维码交叉验证参考数据）
 *
 * 这个脚本只在维护测试数据时跑一次，平时跑测试不需要它 ——
 * test/qr.test.js 直接读 test/qr-reference.json，不依赖 npm 和 Python。
 *
 * 三步：
 *   1. node test/qr-reference.gen.js request
 *        写出 test/.qr-request.json
 *   2. python test/qr-ref.py < test/.qr-request.json > test/.qr-response.json
 *        Python 侧需要 qrcode 库：pip install qrcode
 *   3. node test/qr-reference.gen.js build
 *        写出 test/qr-reference.json
 *        Node 侧需要 qrcode 包：npm i qrcode
 *        （装在别处的话用 QRCODE_MODULE=/path/to/node_modules/qrcode 指定）
 *
 * 第 3 步会把 npm 的 qrcode 包对每个「版本 + 掩码」的矩阵一并算出来存进 fixture，
 * 这样测试运行时就不再依赖 npm 和 Python 了。
 */

const fs = require('node:fs');
const path = require('node:path');

const TEXT_INDEX = 'test/.qr-request.json';
const PY_INDEX = 'test/.qr-response.json';
const OUT = 'test/qr-reference.json';

const TEXTS = [
  'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=abcd1234EFGH',
  'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=0123456789abcdef',
  'A',
  'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=XyZ9-_.~%20%2F',
  'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=' + 'aB3'.repeat(40),
  'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=' + 'Zq7'.repeat(50),
];

/** 纠错等级 M 下每个版本的数据码字数（与脚本里的 QR_SPEC_M 对应） */
const DATA_CODEWORDS_M = { 1: 16, 2: 28, 3: 44, 4: 64, 5: 86, 6: 108, 7: 124, 8: 154, 9: 182, 10: 216 };

/** 按字节模式算某个版本能装多少字节内容 */
function capacityBytes(version) {
  const charCountBits = version < 10 ? 8 : 16;
  return Math.floor((DATA_CODEWORDS_M[version] * 8 - 4 - charCountBits) / 8);
}

/** 造一段刚好占满指定版本容量的内容（用可打印字符，避免编码差异） */
function fillText(version) {
  const n = capacityBytes(version);
  const pool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  let out = '';
  for (let i = 0; i < n; i++) out += pool[(i * 7 + version * 13) % pool.length];
  return out;
}

function loadQrcode() {
  const candidates = [process.env.QRCODE_MODULE, 'qrcode'].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch (e) { /* 继续试下一个 */ }
  }
  throw new Error(
    '找不到 qrcode 包。请先 `npm i qrcode`，或设置 QRCODE_MODULE=/path/to/node_modules/qrcode'
  );
}

/**
 * 取 npm qrcode 的矩阵。
 *
 * 注意：npm 的 qrcode 默认会按内容做「最优分段」（例如全大写的 'A' 会被编成
 * alphanumeric 模式，URL 会被拆成多段），那样得到的矩阵跟本脚本的纯 byte 模式
 * 没有可比性。所以这里显式传一个 byte 模式的 segment，强制两边编码方式一致。
 */
function npmMatrix(QRCode, text, version, mask) {
  const q = QRCode.create(
    [{ data: Buffer.from(text, 'utf8'), mode: 'byte' }],
    { errorCorrectionLevel: 'M', version, maskPattern: mask }
  );
  const size = q.modules.size;
  const rows = [];
  for (let r = 0; r < size; r++) {
    let line = '';
    for (let c = 0; c < size; c++) line += q.modules.data[r * size + c] === 1 ? '1' : '0';
    rows.push(line);
  }
  return rows;
}

function normalize(matrix, asStrings) {
  return matrix.map((row) => {
    if (typeof row === 'string') return row;
    return asStrings ? row.map((v) => (v ? '1' : '0')).join('') : row.map(Boolean);
  });
}

function phaseRequest() {
  fs.writeFileSync(path.join(__dirname, '..', TEXT_INDEX), JSON.stringify({ texts: TEXTS }));
  console.log('已写出 ' + TEXT_INDEX + '（接下来交给 python test/qr-ref.py）');
}

function phaseBuild() {
  const root = path.join(__dirname, '..');
  const py = JSON.parse(fs.readFileSync(path.join(root, PY_INDEX), 'utf8'));
  const QRCode = loadQrcode();

  const cases = py.cases.map((c) => {
    const forced = {};
    for (let mask = 0; mask < 8; mask++) {
      forced[mask] = npmMatrix(QRCode, c.text, c.version, mask);
    }
    // 版本 1..10 各来一组，用刚好填满该版本容量的内容，覆盖全部容量表与分块表
    const byVersion = {};
    for (let version = 1; version <= 10; version++) {
      const text = fillText(version);
      const trio = {};
      for (const mask of [0, 3, 7]) {
        trio[mask] = npmMatrix(QRCode, text, version, mask);
      }
      byVersion[version] = { text: text, matrices: trio };
    }
    return {
      text: c.text,
      version: c.version,
      // python best_mask_pattern() 选出的掩码（评估时格式信息位为 0，与规范口径不同，仅作参考）
      pythonAutoMask: c.autoMask,
      autoMatrix: normalize(c.autoMatrix, true),
      lostPoints: c.lostPoints,
      forcedMatrices: forced,
      byVersion: byVersion,
    };
  });

  const out = {
    note: '由 test/qr-reference.gen.js + test/qr-ref.py 生成：lostPoints/autoMask/autoMatrix 来自 Python qrcode（ISO 罚分），forcedMatrices/byVersion 来自 npm qrcode',
    cases: cases,
  };
  fs.writeFileSync(path.join(root, OUT), JSON.stringify(out));
  console.log('已写出 ' + OUT + '（' + cases.length + ' 组用例）');
}

const phase = process.argv[2];
if (phase === 'request') phaseRequest();
else if (phase === 'build') phaseBuild();
else {
  console.log('用法: node test/qr-reference.gen.js request|build');
  process.exit(1);
}
