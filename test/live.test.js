/**
 * 真实接口联调（需要联网）
 *
 * 用 Node 的 http/https 顶掉 GM_xmlhttpRequest，把整个请求链路真跑一遍：
 *   签名生成 → 参数拼装 → URL 构造 → 发请求 → 解析响应
 *
 * 只调用「不需要账号」的接口，不会发短信、不会动任何人的账号。
 */

const assert = require('node:assert');
const { loadScript } = require('./harness');

const { api } = loadScript({ silent: true, verbose: process.env.KG_TEST_VERBOSE === '1' });

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

(async function main() {
  console.log('真实接口联调（不需要账号的接口）\n');

  /* ---------- 1. 二维码 key ---------- */

  console.log('1) 二维码 key（login_qr_key）');
  const keyResp = await api.callApi('login_qr_key', { cookie: {} });
  check('status = 1', keyResp.status, 1);
  check('返回了 qrcode 字符串', typeof (keyResp.data && keyResp.data.qrcode), 'string');
  const qrcodeKey = keyResp.data && keyResp.data.qrcode;
  if (qrcodeKey) console.log(`   qrcode key: ${qrcodeKey}`);
  console.log('   → 说明 web 版签名、参数拼装、URL 构造全部与服务端约定一致');

  /* ---------- 2. 二维码状态查询 ---------- */

  console.log('\n2) 二维码状态（login_qr_check）');
  const checkResp = await api.callApi('login_qr_check', { cookie: {}, key: qrcodeKey });
  check('拿到业务响应', checkResp && typeof checkResp === 'object', true);
  check('响应里带 status 字段', typeof checkResp.status, 'number');
  console.log(`   → 服务端返回 status=${checkResp.status}${checkResp.data ? `, data.status=${checkResp.data.status}` : ''}`);

  /* ---------- 3. 账号信息（用一个不存在的 token 探路） ---------- */

  console.log('\n3) 账号信息（user_detail，用无效 token）');
  const detail = await api.callApi('user_detail', { cookie: { token: '0123456789abcdef', userid: '1' } });
  // 关键点：只要服务端能正常解析我们 RSA 加密的 p 字段，就不会报参数错误
  check('服务端正常应答（不是参数错误）', typeof detail.status === 'number', true);
  check('不是 20006 参数错误', detail.error_code === 20006, false);
  console.log(`   → 响应摘要: ${JSON.stringify(api.summarizeResponse ? api.summarizeResponse(detail) : detail).slice(0, 200)}`);
  console.log('   → 说明 RSA 公钥加密（NO_PADDING）与 android 签名被服务端接受了');

  /* ---------- 4. 构造一个本地二维码图，确认能出图 ---------- */

  console.log('\n4) 二维码渲染');
  const url = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${qrcodeKey}`;
  const qr = api.qrEncode(url);
  check('生成了二维码矩阵', Array.isArray(qr.modules) && qr.modules.length > 0, true);
  console.log(`   → 版本 v${qr.version} / 掩码 ${qr.mask} / 尺寸 ${qr.modules.length}×${qr.modules.length}`);
  const text = api.qrToText(qr.modules, 2);
  console.log('   字符二维码预览：');
  console.log(text.split('\n').slice(0, 6).map((l) => '   ' + l).join('\n'));
  console.log('   …');

  console.log(`\n联调结果：${pass} 项通过，${fail} 项失败`);
  if (fail) process.exitCode = 1;
})().catch((e) => {
  console.error('联调异常：', e && e.message ? e.message : e);
  process.exitCode = 1;
});
