/**
 * 加密内核对拍测试
 *
 * 左边：kgcheckin.user.js 里的纯 JS 实现
 * 右边：node:crypto（也就是原青龙版 api/util/*.js 实际用的东西）
 *
 * 两个实现的所有公开入参组合都跑一遍，输出必须逐字节一致。
 */

const crypto = require('node:crypto');
const assert = require('node:assert');
const { loadScript } = require('./harness');

const { api } = loadScript({ silent: true });
let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    pass++;
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${expected}\n      实际: ${actual}`);
  }
}

/* ------------------------- MD5 ------------------------- */

function refMd5(data) {
  const buffer = typeof data === 'object' ? JSON.stringify(data) : data;
  return crypto.createHash('md5').update(buffer).digest('hex');
}

console.log('MD5：');
const md5Cases = [
  '',
  '-',
  'a',
  'hello world',
  '45abcd1234567890123456789012345',
  '酷狗概念版 VIP 自动签到',
  '0123456789'.repeat(20),
  '{"token":"abcdef123456","clienttime":1700000000}',
];
md5Cases.forEach((c) => check(`md5(${JSON.stringify(c).slice(0, 40)})`, api.md5(c), refMd5(c)));
check('md5(对象)', api.md5({ a: 1, b: 'x' }), refMd5({ a: 1, b: 'x' }));
for (let i = 0; i < 200; i++) {
  const s = crypto.randomBytes(1 + (i % 73)).toString('base64');
  check(`md5(随机#${i})`, api.md5(s), refMd5(s));
}

/* ------------------------- SHA-256 / HMAC ------------------------- */

console.log('SHA-256 / HMAC-SHA256：');
function refSha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
const shaCases = ['', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), '酷狗', 'a'.repeat(1000)];
shaCases.forEach((c) => {
  const mine = Buffer.from(api.sha256(c)).toString('hex');
  check(`sha256(len=${c.length})`, mine, refSha256Hex(c));
});
const hmacCases = [
  ['secret', '1700000000\nsecret'],
  ['', 'hello'],
  ['k'.repeat(100), 'message'],
  ['加签密钥', '1700000000\n加签密钥'],
];
hmacCases.forEach(([k, m]) => {
  const mine = api.hmacSha256Base64(k, m);
  const ref = crypto.createHmac('sha256', k).update(m).digest('base64');
  check(`hmac(${JSON.stringify(k).slice(0, 12)}, …)`, mine, ref);
});

/* ------------------------- base64 ------------------------- */

console.log('base64：');
for (let i = 0; i < 60; i++) {
  const buf = crypto.randomBytes(i);
  check(`base64(len=${i})`, api.base64Encode(new Uint8Array(buf)), buf.toString('base64'));
}

/* ------------------------- AES-CBC ------------------------- */

console.log('AES-CBC：');
// 对齐原实现：key/iv 以「字符串」形式传给 createCipheriv / createDecipheriv
function refAesEncrypt(data, opt) {
  if (typeof data === 'object') data = JSON.stringify(data);
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  let key;
  let iv;
  let tempKey = '';
  if (opt && opt.key && opt.iv) {
    key = opt.key;
    iv = opt.iv;
  } else {
    tempKey = (opt && opt.key) || 'FIXEDRANDOMKEY12';
    key = refMd5(tempKey).substring(0, 32);
    iv = key.substring(key.length - 16);
  }
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const dest = Buffer.concat([cipher.update(buffer), cipher.final()]);
  if (opt && opt.key && opt.iv) return dest.toString('hex');
  return { str: dest.toString('hex'), key: tempKey };
}

// 原项目里真实用到的 key/iv
const FIXED = [
  ['90b8382a1bb4ccdcf063102053fd75b8', 'f063102053fd75b8'],
  ['c24f74ca2820225badc01946dba4fdf7', 'adc01946dba4fdf7'],
];
const payloads = [
  '{}',
  '',
  'a',
  '0123456789abcdef',
  JSON.stringify({ clienttime: 1700000000, token: 'abcdef1234567890' }),
  JSON.stringify({ mobile: '13800000000', code: '123456' }),
  '中'.repeat(50),
];
for (const [key, iv] of FIXED) {
  for (const p of payloads) {
    check(`aes256(${JSON.stringify(p).slice(0, 30)})`, api.cryptoAesEncrypt(p, { key, iv }), refAesEncrypt(p, { key, iv }));
  }
}
// 随机 key 分支：脚本自己生成 tempKey，这里用同一个 tempKey 复算密钥派生，验证规则一致
for (const p of payloads) {
  const mine = api.cryptoAesEncrypt(p);
  const derivedKey = refMd5(mine.key).substring(0, 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, derivedKey.substring(16));
  const expected = Buffer.concat([cipher.update(Buffer.from(typeof p === 'object' ? JSON.stringify(p) : p)), cipher.final()]).toString('hex');
  check(`aes256-随机key(${JSON.stringify(p).slice(0, 20)})`, mine.str, expected);
  check(`aes256-随机key-长度(${JSON.stringify(p).slice(0, 14)})`, mine.key.length, 16);
}

// 解密往返（对齐 login_token / login_cellphone 里 secu_params 的用法）
console.log('AES 解密往返：');
for (const [key, iv] of FIXED) {
  for (const p of payloads) {
    const hex = refAesEncrypt(p, { key, iv });
    const mine = api.cryptoAesDecrypt(hex, key, iv);
    const text = typeof mine === 'object' ? JSON.stringify(mine) : mine;
    check(`aes解密(${JSON.stringify(p).slice(0, 20)})`, text, p);
  }
}
// 不带 iv 的分支（key 需先 md5 截断）
for (const p of payloads) {
  const tempKey = 'FIXEDRANDOMKEY12';
  const hex = refAesEncrypt(p, { key: tempKey }).str;
  const mine = api.cryptoAesDecrypt(hex, tempKey);
  const text = typeof mine === 'object' ? JSON.stringify(mine) : mine;
  check(`aes解密-无iv(${JSON.stringify(p).slice(0, 20)})`, text, p);
}
// 随机数据多轮往返（前缀一个字母，避免全数字串被 JSON.parse 当成数字吃掉）
for (let i = 0; i < 100; i++) {
  const len = 1 + (i % 100);
  const plain = 'p' + crypto.randomBytes(len).toString('hex');
  const key = crypto.randomBytes(16).toString('hex');
  const iv = key.substring(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const hex = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]).toString('hex');
  const mine = api.cryptoAesDecrypt(hex, key, iv);
  check(`aes往返#${i}`, mine, plain);
}

/* ------------------------- RSA ------------------------- */

console.log('RSA：');
const PEM = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB\n-----END PUBLIC KEY-----';

function refRsaNoPadding(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'object' ? JSON.stringify(data) : data);
  const padded = Buffer.concat([buffer, Buffer.alloc(128 - buffer.length)]);
  return crypto.publicEncrypt({ key: PEM, padding: crypto.constants.RSA_NO_PADDING }, padded).toString('hex');
}

function refRsaPkcs1(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'object' ? JSON.stringify(data) : data);
  return crypto.publicEncrypt({ key: PEM, padding: crypto.constants.RSA_PKCS1_PADDING }, buffer).toString('hex');
}

const rsaCases = [
  { token: 'abcdef1234567890', clienttime: 1700000000 },
  { token: '', clienttime: 1 },
  { token: 'x'.repeat(60), clienttime: 1750000000 },
  { clienttime_ms: 1700000000000, key: 'ABCD1234EFGH5678' },
  'plain string',
  '',
];
rsaCases.forEach((c, i) => {
  check(`rsa-noPadding#${i}`, api.cryptoRSAEncrypt(c).toUpperCase(), refRsaNoPadding(c).toUpperCase());
});
// 随机明文
for (let i = 0; i < 40; i++) {
  const s = crypto.randomBytes(1 + (i % 60)).toString('hex');
  check(`rsa随机#${i}`, api.cryptoRSAEncrypt(s).toUpperCase(), refRsaNoPadding(s).toUpperCase());
}

/**
 * PKCS1 填充带随机字节，公开加密的结果不可复现，
 * 所以换成"自己造一对密钥 → 我用公钥加密 → node 用私钥解密"来验证填充结构正确。
 */
console.log('RSA PKCS1（自造密钥 + 私钥解密回收）：');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const pkcsCases = ['', 'a', 'hello', 'x'.repeat(100), '酷狗概念版', JSON.stringify({ clienttime_ms: 1700000000000, key: 'ABCD1234EFGH5678' })];
pkcsCases.forEach((p, i) => {
  const hex = api.rsaEncrypt2(p, PUB_PEM);
  const recovered = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(hex, 'hex')).toString('utf8');
  check(`rsa-pkcs1 私钥回收#${i}`, recovered, p);
});
// NO_PADDING 同样用私钥回收（解密结果是明文 + 右侧补零）
const noPadCases = ['', 'abc', 'y'.repeat(60), JSON.stringify({ token: 'abcdef', clienttime: 1700000000 })];
noPadCases.forEach((p, i) => {
  const hex = api.cryptoRSAEncrypt(p, PUB_PEM);
  const raw = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_NO_PADDING }, Buffer.from(hex, 'hex'));
  const expected = Buffer.concat([Buffer.from(p), Buffer.alloc(128 - Buffer.byteLength(p))]);
  check(`rsa-noPadding 私钥回收#${i}`, raw.toString('hex'), expected.toString('hex'));
});
// 明文过长必须报错，而不是悄悄截断
try {
  api.rsaEncrypt2('z'.repeat(200), PUB_PEM);
  check('rsa-pkcs1 超长应报错', 'no-throw', 'throw');
} catch (e) {
  check('rsa-pkcs1 超长应报错', 'throw', 'throw');
}

/* ------------------------- 酷狗签名 ------------------------- */

console.log('酷狗签名：');
// 直接照抄原项目 api/util/helper.js 的算法（只把 cryptoMd5 换成 node:crypto）
function refSignatureWebParams(params) {
  const str = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
  const paramsString = Object.keys(params).map((key) => `${key}=${params[key]}`).sort().join('');
  return refMd5(`${str}${paramsString}${str}`);
}
function refSignatureAndroidParams(params, data) {
  const str = `OIlwieks28dk2k092lksi2UIkp`;
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('');
  return refMd5(`${str}${paramsString}${data || ''}${str}`);
}
function refSignKey(hash, mid, userid, appid) {
  return refMd5(`${hash}57ae12eb6890223e355ccfcb74edf70d${appid || 1005}${mid}${userid || 0}`);
}
function refSignParamsKey(data, appid, clientver) {
  return refMd5(`${appid || 1005}OIlwieks28dk2k092lksi2UIkp${clientver || 20489}${data}`);
}

// 复刻一次真实的 login_qr_key 参数集
const qrParams = {
  dfid: '-',
  mid: refMd5('-') + refMd5('-').slice(0, 7),
  uuid: 'u',
  appid: 1001,
  clientver: 20489,
  userid: 0,
  clienttime: 1700000000,
  type: 1,
  plat: 4,
  qrcode_txt: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&',
  srcappid: 2919,
};
check('signatureWebParams(登录二维码)', api.signatureWebParams(qrParams), refSignatureWebParams(qrParams));

const adParams = {
  dfid: '-', mid: 'm', uuid: 'u', appid: 1005, clientver: 20489, userid: '123', clienttime: 1700000000,
};
const adData = JSON.stringify({ ad_id: 12307537187, play_end: 1700000000000, play_start: 1699999970000 });
check('signatureAndroidParams(广告)', api.signatureAndroidParams(adParams, adData), refSignatureAndroidParams(adParams, adData));
check('signKey', api.signKey('hash123', 'mid456', '789', 1005), refSignKey('hash123', 'mid456', '789', 1005));
check('signParamsKey', api.signParamsKey(1700000000000), refSignParamsKey(1700000000000));
check('signParamsKey(带 appid)', api.signParamsKey(1, 3116, 11436), refSignParamsKey(1, 3116, 11436));

// 签名必须对参数顺序不敏感、对参数值敏感
const shuffled = {};
Object.keys(qrParams).reverse().forEach((k) => { shuffled[k] = qrParams[k]; });
check('signatureWebParams(乱序参数结果一致)', api.signatureWebParams(shuffled), api.signatureWebParams(qrParams));
const changed = Object.assign({}, qrParams, { clienttime: 1700000001 });
assert.notStrictEqual(api.signatureWebParams(changed), api.signatureWebParams(qrParams), '签名对参数值不敏感，异常');
pass++;

console.log(`\n加密内核：${pass} 项通过，${fail} 项失败`);
if (fail) process.exitCode = 1;
