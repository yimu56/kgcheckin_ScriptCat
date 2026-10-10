// ==UserScript==
// @name         酷狗概念版 VIP 自动签到（ScriptCat 定时版）
// @namespace    https://github.com/yimu56
// @version      1.0.1
// @description  每天自动领取酷狗概念版 VIP：支持扫码 / 手机号 / 手动三种登录，支持系统通知与多渠道推送，零外部依赖
// @author       yimu56
// @license      MIT
// @homepageURL  https://github.com/yimu56/kgcheckin_ScriptCat
// @supportURL   https://github.com/yimu56/kgcheckin_ScriptCat/issues
// @crontab      * 1-6 once * *
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_log
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @connect      kugou.com
// @connect      kugou.com.cn
// @connect      api.qrserver.com
// @connect      qq.com
// @connect      feishu.cn
// @connect      dingtalk.com
// @connect      yhchat.com
// @connect      ftqq.com
// @connect      pushplus.plus
// @connect      telegram.org
// @connect      day.app
// @connect      discord.com
// @connect      discordapp.com
// @connect      *
// ==/UserScript==

/* ==UserConfig==
账号:
  USERINFO:
    title: 账号列表
    description: 'JSON 数组，例如 [{"userid":"123456","token":"abcdef"}]。登录入口在 ScriptCat 弹出层里：点工具栏的 ScriptCat 图标 → 找到本脚本 → 菜单「① 扫码登录」'
    type: textarea
    default: '[]'
  KG_APPEND:
    title: 登录后追加账号
    description: '打开 = 保留已有账号（同一 userid 只更新 token）；关闭 = 覆盖整个列表'
    type: checkbox
    default: true
---
登录:
  KG_PHONE:
    title: 手机号
    description: '手机号登录用的号码，填 11 位数字。填在这里最省事；如果菜单能弹出输入框，也可以直接在框里输'
    type: text
    default: ''
  KG_CODE:
    title: 短信验证码
    description: '收到短信后填这里，再点菜单「③ 手机号登录」。菜单能弹输入框时也可直接在框里输，两种都行'
    type: text
    default: ''
  KG_QR_SECONDS:
    title: 扫码等待时长
    description: '菜单「① 扫码登录」里等待手机确认的秒数'
    type: number
    default: 150
    unit: 秒
  KG_QR_ONLINE:
    title: 二维码用浏览器打开
    description: '打开 = 额外用新标签页打开一张大二维码，更好扫；但扫码链接会发给第三方 api.qrserver.com。关闭 = 只用运行日志里的字符二维码（完全本地）'
    type: checkbox
    default: true
---
签到:
  KG_CLAIM_TIMES:
    title: 每天最多领取次数
    type: number
    default: 8
    min: 1
    max: 20
    unit: 次
  KG_CLAIM_INTERVAL:
    title: 每次领取间隔
    type: number
    default: 30
    min: 0
    max: 600
    unit: 秒
  KG_REFRESH_WEEKDAY:
    title: 每周几续期 token
    description: '0=周日 1=周一 … 6=周六；填 -1 关闭自动续期'
    type: number
    default: 0
    min: -1
    max: 6
---
通知:
  KG_NOTIFY_SYSTEM:
    title: 发送系统通知
    type: checkbox
    default: true
  WECOM_BOT_KEY:
    title: 企业微信机器人 key
    type: text
    default: ''
  DINGTALK_BOT_KEY:
    title: 钉钉机器人 access_token
    type: text
    default: ''
  DINGTALK_SECRET:
    title: 钉钉加签密钥
    description: 机器人安全设置里选「加签」时填写，选「自定义关键词」可留空
    type: text
    default: ''
  FEISHU_BOT_KEY:
    title: 飞书机器人 key
    type: text
    default: ''
  YUNHU_BOT_KEY:
    title: 云湖机器人 key
    type: text
    default: ''
  SERVERCHAN_SENDKEY:
    title: Server酱 SendKey
    type: text
    default: ''
  PUSHPLUS_TOKEN:
    title: PushPlus token
    type: text
    default: ''
  PUSHPLUS_TOPIC:
    title: PushPlus 群组编码
    type: text
    default: ''
  TG_BOT_TOKEN:
    title: Telegram 机器人 token
    type: text
    default: ''
  TG_CHAT_ID:
    title: Telegram chat_id
    type: text
    default: ''
  BARK_KEY:
    title: Bark key 或完整推送地址
    type: text
    default: ''
  BARK_GROUP:
    title: Bark 分组
    type: text
    default: ''
  DISCORD_WEBHOOK:
    title: Discord Webhook 地址
    type: text
    default: ''
==/UserConfig== */

/* eslint-disable no-restricted-globals */
// 注意：这里的 return 是 ScriptCat 后台/定时脚本的约定写法（脚本源码会被包进函数执行）。
// 异步逻辑必须以 Promise 形式返回，ScriptCat 才能统计运行状态、失败重试。
return (function () {
  'use strict';

  /* ================================================================== *
   *  0. 基础工具
   * ================================================================== */

  var LOG_PREFIX = '[酷狗签到]';

  /**
   * 取一个脚本管理器注入的 GM_* 函数。
   *
   * 关键坑：脚本猫（以及多数油猴兼容管理器）注入 GM_* 的方式不是挂在
   * globalThis 上，而是注入到「脚本执行的作用域」里（等效于给脚本包了一层
   * function(GM_xmlhttpRequest, GM_openInTab, ...) { ... }）。
   * 所以这里不能用 globalThis[name]，得用 eval 在当前作用域链里找，两种都能命中。
   * 不存在时 typeof 会安全地返回 undefined，不会抛 ReferenceError。
   */
  function GM(name) {
    try {
      // eslint-disable-next-line no-eval
      var fn = eval('typeof ' + name + ' === "function" ? ' + name + ' : undefined');
      return typeof fn === 'function' ? fn : undefined;
    } catch (e) {
      return undefined;
    }
  }

  function log(msg) {
    var line = LOG_PREFIX + ' ' + msg;
    var gmLog = GM('GM_log');
    if (gmLog) {
      try {
        gmLog(line);
        return;
      } catch (e) { /* 落到 console */ }
    }
    try { console.log(line); } catch (e) { /* ignore */ }
  }

  /** 不带前缀地输出一行（画字符二维码时必须这样，否则每行前缀会歪掉对齐） */
  function logLine(msg) {
    var gmLog = GM('GM_log');
    if (gmLog) {
      try {
        gmLog(msg);
        return;
      } catch (e) { /* 落到 console */ }
    }
    try { console.log(msg); } catch (e) { /* ignore */ }
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /** 北京时间（不依赖本机时区设置错误） */
  function beijingNow() {
    var now = new Date();
    var utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utcMs + 8 * 3600 * 1000);
  }

  function formatDate(d) {
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  /* ---------------- 日志脱敏 ---------------- */

  var SENSITIVE_KEYS = {
    token: 1, vip_token: 1, viptoken: 1, cookie: 1, authorization: 1, pat: 1,
    gh_token: 1, userinfo: 1, password: 1, code: 1, mobile: 1, phone: 1,
    qrcode: 1, qrcode_img: 1, qrcode_txt: 1, qrimg: 1, key: 1, secu_params: 1,
  };
  var DISPLAY_NAME_KEYS = { nickname: 1, username: 1, display_name: 1, displayname: 1 };
  var IDENTIFIER_KEYS = { userid: 1, user_id: 1, uid: 1, kguid: 1, kugouid: 1, t_userid: 1 };

  function maskDisplayName(value) {
    var chars = Array.from(String(value === undefined || value === null ? '' : value));
    if (!chars.length) return '';
    if (chars.length === 1) return chars[0] + '********';
    if (chars.length === 2) return chars[0] + '********' + chars[1];
    return chars.slice(0, 2).join('') + '********' + chars[chars.length - 1];
  }

  function maskIdentifier(value) {
    var chars = Array.from(String(value === undefined || value === null ? '' : value));
    if (!chars.length) return '';
    if (chars.length <= 2) return '*'.repeat(chars.length);
    if (chars.length <= 6) return chars[0] + '***' + chars[chars.length - 1];
    return chars.slice(0, 3).join('') + '***' + chars.slice(-2).join('');
  }

  /** 手机号脱敏：13*******00（比通用的 maskIdentifier 更严，只露前 2 后 2） */
  function maskPhone(value) {
    var s = String(value === undefined || value === null ? '' : value).replace(/\D/g, '');
    if (s.length < 7) return maskIdentifier(value);
    return s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2);
  }

  function sanitizeString(value) {
    return String(value)
      .replace(/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]{20,})/g, '[REDACTED]')
      .replace(/(?<!\d)(1[3-9]\d{9})(?!\d)/g, function (phone) {
        return phone.slice(0, 2) + '*******' + phone.slice(-2);
      });
  }

  function redactValue(key, value) {
    var k = String(key).toLowerCase();
    if (DISPLAY_NAME_KEYS[k]) return maskDisplayName(value);
    if (IDENTIFIER_KEYS[k]) return maskIdentifier(value);
    if (SENSITIVE_KEYS[k]) return '[REDACTED]';
    return typeof value === 'string' ? sanitizeString(value) : value;
  }

  function sanitizeForLog(value, depth) {
    depth = depth || 0;
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') {
      return typeof value === 'string' ? sanitizeString(value) : value;
    }
    if (depth >= 4) return '[Object]';
    if (Array.isArray(value)) {
      return value.slice(0, 20).map(function (i) { return sanitizeForLog(i, depth + 1); });
    }
    var out = {};
    Object.keys(value).forEach(function (k) {
      out[k] = sanitizeForLog(redactValue(k, value[k]), depth + 1);
    });
    return out;
  }

  /** 只保留排查问题需要的字段，避免把整包响应写进日志 */
  function summarizeResponse(response) {
    var safe = sanitizeForLog(response);
    if (!safe || typeof safe !== 'object') return safe;
    var summary = {};
    ['status', 'code', 'error_code', 'errcode', 'error', 'msg', 'message', 'httpStatus'].forEach(function (key) {
      if (safe[key] !== undefined) summary[key] = safe[key];
    });
    if (safe.data && typeof safe.data === 'object') {
      summary.data = {};
      ['status', 'code', 'error_code', 'errcode', 'msg', 'message', 'nickname', 'userid'].forEach(function (key) {
        if (safe.data[key] !== undefined) summary.data[key] = safe.data[key];
      });
    } else if (typeof safe.data === 'string' || typeof safe.data === 'number') {
      // 酷狗失败时经常把原因直接放在 data 里（例如 "验证码过期"），别丢掉
      summary.data = safe.data;
    }
    return Object.keys(summary).length ? summary : safe;
  }

  /** 酷狗登录相关错误码 → 人话 */
  var KG_ERROR_TEXT = {
    20006: '参数错误，请求被服务端拒绝',
    20020: '验证码错误或已过期，请重新执行「② 发送短信验证码」',
    20021: '验证码错误或已过期，请重新执行「② 发送短信验证码」',
    34175: '该手机号绑定了多个账号，只能用扫码登录',
  };

  /** 从响应里提取一句可读的失败原因 */
  function errorTextOf(res) {
    if (!res || typeof res !== 'object') return '';
    var code = res.error_code !== undefined ? res.error_code : res.errcode;
    if (code !== undefined && KG_ERROR_TEXT[code]) return KG_ERROR_TEXT[code];
    if (typeof res.data === 'string' && res.data) return res.data;
    if (typeof res.msg === 'string' && res.msg) return res.msg;
    if (typeof res.message === 'string' && res.message) return res.message;
    return '';
  }

  /* ================================================================== *
   *  1. 加密内核（纯 JS，无任何外部依赖）
   *     全部与 Node 的 node:crypto 逐项对拍验证过，见 test/
   * ================================================================== */

  /* ---------------- GF(2^8) ----------------
   * 这里有两条不同的不可约多项式，不能共用同一套实现：
   *   AES    x^8+x^4+x^3+x+1   = 0x11B
   *   QR/RS  x^8+x^4+x^3+x^2+1 = 0x11D
   *
   * 注意：0x11D 下 2 是本原元（阶 255），可以用「2 的幂」建 log/exp 表；
   * 但 0x11B 下 2 的阶只有 51，建出来的表覆盖不全（这是个很容易踩的坑），
   * 所以 AES 这边直接用移位累加乘法，不查表。
   */

  function buildGfTables(poly) {
    var exp = new Uint8Array(512);
    var log = new Uint8Array(256);
    var x = 1;
    for (var i = 0; i < 255; i++) {
      exp[i] = x;
      log[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= poly;
    }
    for (var j = 255; j < 512; j++) exp[j] = exp[j - 255];
    return { exp: exp, log: log };
  }

  var QR_GF = buildGfTables(0x11d);

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return QR_GF.exp[QR_GF.log[a] + QR_GF.log[b]];
  }

  function aesMul(a, b) {
    var r = 0;
    var x = a & 0xff;
    var y = b & 0xff;
    while (y) {
      if (y & 1) r ^= x;
      x <<= 1;
      if (x & 0x100) x ^= 0x11b;
      y >>= 1;
    }
    return r & 0xff;
  }

  // 自检：FIPS-197 里的经典例子 0x57 • 0x13 = 0xfe；QR 域 0x80 • 0x02 = 0x1d
  if (aesMul(0x57, 2) !== 0xae || aesMul(0x57, 0x13) !== 0xfe || gfMul(0x80, 2) !== 0x1d) {
    throw new Error('有限域乘法表自检失败');
  }

  /* ---------------- MD5 ---------------- */

  var MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  var MD5_K = (function () {
    var k = new Uint32Array(64);
    for (var i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
    return k;
  })();

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(bytes);
  }

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length >> 1);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function utf8ToBytes(value) {
    if (typeof value === 'string') return utf8Bytes(value);
    // ArrayBuffer.isView 是跨 realm 可靠的（instanceof 在沙箱里会失效）
    if (value && typeof value === 'object' && (ArrayBuffer.isView(value) || value instanceof Uint8Array)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) return new Uint8Array(value);
    return utf8Bytes(value && typeof value === 'object' ? JSON.stringify(value) : String(value));
  }

  function md5(data) {
    var bytes = utf8ToBytes(data);
    var len = bytes.length;
    var total = (((len + 8) >> 6) + 1) * 64;
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    var view = new DataView(buf.buffer);
    var bitLen = len * 8;
    view.setUint32(total - 8, bitLen >>> 0, true);
    view.setUint32(total - 4, Math.floor(bitLen / 4294967296), true);

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    var M = new Uint32Array(16);

    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
      var A = a0, B = b0, C = c0, D = d0;
      for (var r = 0; r < 64; r++) {
        var F, g;
        if (r < 16) { F = (B & C) | (~B & D); g = r; }
        else if (r < 32) { F = (D & B) | (~D & C); g = (5 * r + 1) % 16; }
        else if (r < 48) { F = B ^ C ^ D; g = (3 * r + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * r) % 16; }
        F = (F + A + MD5_K[r] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + ((F << MD5_S[r]) | (F >>> (32 - MD5_S[r])))) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }

    var out = new Uint8Array(16);
    var ov = new DataView(out.buffer);
    ov.setUint32(0, a0, true);
    ov.setUint32(4, b0, true);
    ov.setUint32(8, c0, true);
    ov.setUint32(12, d0, true);
    return bytesToHex(out);
  }

  /* ---------------- SHA-256 + HMAC（钉钉加签用） ---------------- */

  var SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function sha256(data) {
    var bytes = utf8ToBytes(data);
    var len = bytes.length;
    var total = (((len + 8) >> 6) + 1) * 64;
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    var view = new DataView(buf.buffer);
    var bitLen = len * 8;
    view.setUint32(total - 8, Math.floor(bitLen / 4294967296), false);
    view.setUint32(total - 4, bitLen >>> 0, false);

    var h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    var w = new Uint32Array(64);

    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
      for (var j = 16; j < 64; j++) {
        var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (var t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
      h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }

    var out = new Uint8Array(32);
    var ov = new DataView(out.buffer);
    for (var n = 0; n < 8; n++) ov.setUint32(n * 4, h[n], false);
    return out;
  }

  function hmacSha256Base64(key, message) {
    var blockSize = 64;
    var keyBytes = utf8Bytes(key);
    if (keyBytes.length > blockSize) keyBytes = sha256(keyBytes);
    var padded = new Uint8Array(blockSize);
    padded.set(keyBytes);

    var ipad = new Uint8Array(blockSize);
    var opad = new Uint8Array(blockSize);
    for (var i = 0; i < blockSize; i++) {
      ipad[i] = padded[i] ^ 0x36;
      opad[i] = padded[i] ^ 0x5c;
    }
    var inner = sha256(concatBytes(ipad, utf8Bytes(message)));
    return base64Encode(sha256(concatBytes(opad, inner)));
  }

  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64Encode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += B64_CHARS[b0 >> 2];
      out += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
      out += i + 1 < bytes.length ? B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
      out += i + 2 < bytes.length ? B64_CHARS[b2 & 63] : '=';
    }
    return out;
  }

  function base64Decode(str) {
    var clean = String(str).replace(/[^A-Za-z0-9+/]/g, '');
    var out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    var p = 0;
    for (var i = 0; i < clean.length; i += 4) {
      var c0 = B64_CHARS.indexOf(clean[i]);
      var c1 = B64_CHARS.indexOf(clean[i + 1]);
      var c2 = B64_CHARS.indexOf(clean[i + 2]);
      var c3 = B64_CHARS.indexOf(clean[i + 3]);
      if (p < out.length) out[p++] = (c0 << 2) | (c1 >> 4);
      if (c2 >= 0 && p < out.length) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
      if (c3 >= 0 && p < out.length) out[p++] = ((c2 & 3) << 6) | c3;
    }
    return out.subarray(0, p);
  }

  /* ---------------- AES（128 / 192 / 256 + CBC + PKCS7） ---------------- */

  var AES_SBOX = hexToBytes(
    '637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0' +
    'b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b275' +
    '09832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cf' +
    'd0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2' +
    'cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdb' +
    'e0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08' +
    'ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9e' +
    'e1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16'
  );

  var AES_INV_SBOX = (function () {
    var inv = new Uint8Array(256);
    for (var i = 0; i < 256; i++) inv[AES_SBOX[i]] = i;
    return inv;
  })();

  var AES_RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

  function aesExpandKey(key) {
    var nk = key.length >> 2;
    var nr = nk + 6;
    var total = (nr + 1) << 4;
    var w = new Uint8Array(total);
    w.set(key);
    for (var i = nk; i < total >> 2; i++) {
      var t = [w[(i - 1) * 4], w[(i - 1) * 4 + 1], w[(i - 1) * 4 + 2], w[(i - 1) * 4 + 3]];
      if (i % nk === 0) {
        t = [AES_SBOX[t[1]] ^ AES_RCON[i / nk - 1], AES_SBOX[t[2]], AES_SBOX[t[3]], AES_SBOX[t[0]]];
      } else if (nk > 6 && i % nk === 4) {
        t = [AES_SBOX[t[0]], AES_SBOX[t[1]], AES_SBOX[t[2]], AES_SBOX[t[3]]];
      }
      for (var k = 0; k < 4; k++) w[i * 4 + k] = w[(i - nk) * 4 + k] ^ t[k];
    }
    return { w: w, nr: nr };
  }

  function aesAddRoundKey(s, w, offset) {
    for (var i = 0; i < 16; i++) s[i] ^= w[offset + i];
  }

  function aesSubBytes(s, box) {
    for (var i = 0; i < 16; i++) s[i] = box[s[i]];
  }

  function aesShiftRows(s, inverse) {
    var t = s.slice();
    for (var r = 1; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        var src = inverse ? (c - r + 4) % 4 : (c + r) % 4;
        s[r + 4 * c] = t[r + 4 * src];
      }
    }
  }

  function aesMixColumns(s, inverse) {
    for (var c = 0; c < 4; c++) {
      var i = c * 4;
      var a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      if (inverse) {
        s[i]     = aesMul(a0, 14) ^ aesMul(a1, 11) ^ aesMul(a2, 13) ^ aesMul(a3, 9);
        s[i + 1] = aesMul(a0, 9)  ^ aesMul(a1, 14) ^ aesMul(a2, 11) ^ aesMul(a3, 13);
        s[i + 2] = aesMul(a0, 13) ^ aesMul(a1, 9)  ^ aesMul(a2, 14) ^ aesMul(a3, 11);
        s[i + 3] = aesMul(a0, 11) ^ aesMul(a1, 13) ^ aesMul(a2, 9)  ^ aesMul(a3, 14);
      } else {
        var all = a0 ^ a1 ^ a2 ^ a3;
        s[i]     = a0 ^ all ^ aesMul(a0 ^ a1, 2);
        s[i + 1] = a1 ^ all ^ aesMul(a1 ^ a2, 2);
        s[i + 2] = a2 ^ all ^ aesMul(a2 ^ a3, 2);
        s[i + 3] = a3 ^ all ^ aesMul(a3 ^ a0, 2);
      }
    }
  }

  function aesEncryptBlock(block, key) {
    var s = block.slice();
    aesAddRoundKey(s, key.w, 0);
    for (var round = 1; round < key.nr; round++) {
      aesSubBytes(s, AES_SBOX);
      aesShiftRows(s, false);
      aesMixColumns(s, false);
      aesAddRoundKey(s, key.w, round * 16);
    }
    aesSubBytes(s, AES_SBOX);
    aesShiftRows(s, false);
    aesAddRoundKey(s, key.w, key.nr * 16);
    return s;
  }

  function aesDecryptBlock(block, key) {
    var s = block.slice();
    aesAddRoundKey(s, key.w, key.nr * 16);
    for (var round = key.nr - 1; round > 0; round--) {
      aesShiftRows(s, true);
      aesSubBytes(s, AES_INV_SBOX);
      aesAddRoundKey(s, key.w, round * 16);
      aesMixColumns(s, true);
    }
    aesShiftRows(s, true);
    aesSubBytes(s, AES_INV_SBOX);
    aesAddRoundKey(s, key.w, 0);
    return s;
  }

  function aesCbcEncrypt(keyBytes, ivBytes, dataBytes) {
    var key = aesExpandKey(keyBytes);
    var padLen = 16 - (dataBytes.length % 16);
    var padded = new Uint8Array(dataBytes.length + padLen);
    padded.set(dataBytes);
    for (var i = dataBytes.length; i < padded.length; i++) padded[i] = padLen;

    var out = new Uint8Array(padded.length);
    var prev = ivBytes.slice(0, 16);
    for (var off = 0; off < padded.length; off += 16) {
      var block = new Uint8Array(16);
      for (var k = 0; k < 16; k++) block[k] = padded[off + k] ^ prev[k];
      block = aesEncryptBlock(block, key);
      out.set(block, off);
      prev = block;
    }
    return out;
  }

  function aesCbcDecrypt(keyBytes, ivBytes, dataBytes) {
    var key = aesExpandKey(keyBytes);
    var out = new Uint8Array(dataBytes.length);
    var prev = ivBytes.slice(0, 16);
    for (var off = 0; off < dataBytes.length; off += 16) {
      var block = dataBytes.slice(off, off + 16);
      var dec = aesDecryptBlock(block, key);
      for (var k = 0; k < 16; k++) out[off + k] = dec[k] ^ prev[k];
      prev = block;
    }
    if (!out.length) return out;
    var padLen = out[out.length - 1];
    if (padLen >= 1 && padLen <= 16) return out.subarray(0, out.length - padLen);
    return out;
  }

  /* ---------------- 酷狗侧的 AES 封装（对齐原项目语义） ---------------- */

  function randomString(len) {
    var pool = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var out = [];
    for (var i = 0; i < len; i++) {
      out.push(pool[Math.ceil((pool.length - 1) * Math.random())]);
    }
    return out.join('');
  }

  /** 显式 key/iv → 返回 hex；未给 key → 随机 key，返回 { str, key } */
  function cryptoAesEncrypt(data, opt) {
    var plain = utf8ToBytes(data);
    var keyStr, ivStr, tempKey = '';
    if (opt && opt.key && opt.iv) {
      keyStr = opt.key;
      ivStr = opt.iv;
    } else {
      tempKey = (opt && opt.key) || randomString(16).toLowerCase();
      keyStr = md5(tempKey).substring(0, 32);
      ivStr = keyStr.substring(keyStr.length - 16);
    }
    var hex = bytesToHex(aesCbcEncrypt(utf8Bytes(keyStr), utf8Bytes(ivStr), plain));
    if (opt && opt.key && opt.iv) return hex;
    return { str: hex, key: tempKey };
  }

  function cryptoAesDecrypt(data, key, iv) {
    if (!iv) key = md5(key).substring(0, 32);
    iv = iv || key.substring(key.length - 16);
    var plain = aesCbcDecrypt(utf8Bytes(key), utf8Bytes(iv), typeof data === 'string' ? hexToBytes(data) : data);
    var text = utf8Decode(plain);
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  /* ---------------- RSA（BigInt 实现，对齐 node:crypto 的两种 padding） ---------------- */

  var RSA_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB\n-----END PUBLIC KEY-----';

  function derRead(bytes, pos) {
    var tag = bytes[pos++];
    var len = bytes[pos++];
    if (len & 0x80) {
      var n = len & 0x7f;
      len = 0;
      for (var i = 0; i < n; i++) len = (len << 8) | bytes[pos++];
    }
    return { tag: tag, len: len, start: pos, end: pos + len, next: pos + len };
  }

  function bytesToBigInt(bytes) {
    var v = 0n;
    for (var i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]);
    return v;
  }

  function bigIntToBytes(value, size) {
    var out = new Uint8Array(size);
    var v = value;
    for (var i = size - 1; i >= 0; i--) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return out;
  }

  function modPow(base, exp, mod) {
    var result = 1n;
    var b = base % mod;
    var e = exp;
    while (e > 0n) {
      if (e & 1n) result = (result * b) % mod;
      b = (b * b) % mod;
      e >>= 1n;
    }
    return result;
  }

  var rsaKeyCache = null;

  function parseRsaPublicKey(pem) {
    if (rsaKeyCache && rsaKeyCache.pem === pem) return rsaKeyCache;
    var der = base64Decode(pem.replace(/-----[^-]+-----/g, ''));
    var outer = derRead(der, 0);
    var p = derRead(der, outer.start);       // AlgorithmIdentifier
    var bitStr = derRead(der, p.next);       // BIT STRING
    var inner = derRead(der, bitStr.start + 1);
    var nInt = derRead(der, inner.start);
    var eInt = derRead(der, nInt.next);
    var key = {
      pem: pem,
      n: bytesToBigInt(der.subarray(nInt.start, nInt.end)),
      e: bytesToBigInt(der.subarray(eInt.start, eInt.end)),
      size: inner.end - inner.start,
    };
    key.bytes = Math.ceil(key.n.toString(2).length / 8);
    rsaKeyCache = key;
    return key;
  }

  /** RSA_NO_PADDING：数据左对齐、右侧补零到密钥长度 */
  function cryptoRSAEncrypt(data, publicKey) {
    var key = parseRsaPublicKey(publicKey || RSA_PUBLIC_KEY);
    var bytes = utf8ToBytes(data);
    if (bytes.length > key.bytes) throw new Error('RSA 明文过长(' + bytes.length + ' > ' + key.bytes + ')');
    var buf = new Uint8Array(key.bytes);
    buf.set(bytes);
    var m = bytesToBigInt(buf);
    if (m >= key.n) throw new Error('RSA 明文超出模数');
    return bytesToHex(bigIntToBytes(modPow(m, key.e, key.n), key.bytes));
  }

  /** RSA_PKCS1_PADDING（加密块类型 2：00 || 02 || 非零填充 || 00 || 明文） */
  function rsaEncrypt2(data, publicKey) {
    var key = parseRsaPublicKey(publicKey || RSA_PUBLIC_KEY);
    var bytes = utf8ToBytes(data);
    if (bytes.length > key.bytes - 11) throw new Error('RSA 明文过长(' + bytes.length + ' > ' + (key.bytes - 11) + ')');
    var buf = new Uint8Array(key.bytes);
    buf[0] = 0x00;
    buf[1] = 0x02;
    var i = 2;
    while (i < key.bytes - bytes.length - 1) buf[i++] = 0xff;
    buf[i++] = 0x00;
    buf.set(bytes, i);
    var m = bytesToBigInt(buf);
    return bytesToHex(bigIntToBytes(modPow(m, key.e, key.n), key.bytes));
  }

  /* ---------------- 酷狗签名 ---------------- */

  var KA = { appid: 1005, clientver: 20489 };

  function signatureWebParams(params) {
    var str = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
    var paramsString = Object.keys(params)
      .map(function (key) { return key + '=' + params[key]; })
      .sort()
      .join('');
    return md5(str + paramsString + str);
  }

  function signatureAndroidParams(params, data) {
    var str = 'OIlwieks28dk2k092lksi2UIkp';
    var paramsString = Object.keys(params)
      .sort()
      .map(function (key) {
        var v = params[key];
        return key + '=' + (typeof v === 'object' ? JSON.stringify(v) : v);
      })
      .join('');
    return md5(str + paramsString + (data || '') + str);
  }

  function signatureRegisterParams(params) {
    var paramsString = Object.keys(params)
      .map(function (key) { return params[key]; })
      .sort()
      .join('');
    return md5('1014' + paramsString + '1014');
  }

  function signKey(hash, mid, userid, appid) {
    return md5(String(hash) + '57ae12eb6890223e355ccfcb74edf70d' + (appid || KA.appid) + mid + (userid || 0));
  }

  function signParamsKey(data, appid, clientver) {
    return md5((appid || KA.appid) + 'OIlwieks28dk2k092lksi2UIkp' + (clientver || KA.clientver) + data);
  }

  /* ================================================================== *
   *  2. 网络层：GM_xmlhttpRequest
   * ================================================================== */

  function parseHeaders(raw) {
    var out = {};
    if (!raw) return out;
    String(raw).split(/\r?\n/).forEach(function (line) {
      var idx = line.indexOf(':');
      if (idx > 0) out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });
    return out;
  }

  function gmRequest(opt) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function done(isOk, payload) {
        if (settled) return;
        settled = true;
        if (isOk) resolve(payload); else reject(payload);
      }

      var gmXhr = GM('GM_xmlhttpRequest');
      if (!gmXhr) {
        done(false, new Error('当前环境不支持 GM_xmlhttpRequest'));
        return;
      }

      try {
        gmXhr({
          method: String(opt.method || 'GET').toUpperCase(),
          url: opt.url,
          headers: opt.headers || {},
          data: opt.body === undefined || opt.body === null ? undefined : opt.body,
          timeout: opt.timeout || 15000,
          responseType: 'text',
          onload: function (res) {
            done(true, {
              status: res.status || 0,
              headers: parseHeaders(res.responseHeaders),
              text: typeof res.responseText === 'string' ? res.responseText : String(res.response || ''),
            });
          },
          onerror: function () { done(false, new Error('网络错误：' + opt.url)); },
          ontimeout: function () { done(false, new Error('请求超时：' + opt.url)); },
          onabort: function () { done(false, new Error('请求被中断：' + opt.url)); },
        });
      } catch (e) {
        done(false, e);
      }
    });
  }

  /**
   * 协议自动回落。
   * login.user.kugou.com 的证书链不完整（缺中间证书），浏览器可能拒绝；
   * 而 http 在部分环境下又会被当成混合内容拦掉。所以这里先按原样发一次，
   * 失败就把该域名的协议翻过来重试一次，并把结果记住给后续请求用。
   */
  var loginScheme = '';

  function rewriteLoginScheme(url) {
    if (!loginScheme) return url;
    if (url.indexOf('login.user.kugou.com') === -1) return url;
    return url.replace(/^https?:/, loginScheme + ':');
  }

  async function gmRequestWithFallback(opt) {
    var url = rewriteLoginScheme(opt.url);
    try {
      return await gmRequest(Object.assign({}, opt, { url: url }));
    } catch (e) {
      if (url.indexOf('login.user.kugou.com') === -1) throw e;
      loginScheme = url.indexOf('https:') === 0 ? 'http' : 'https';
      var alt = url.replace(/^https?:/, loginScheme + ':');
      log('[网络] 请求失败，改用 ' + loginScheme + ' 重试一次');
      return await gmRequest(Object.assign({}, opt, { url: alt }));
    }
  }

  function buildUrl(baseURL, url, params) {
    var full = baseURL ? baseURL + url : url;
    if (params) {
      var search = new URLSearchParams();
      Object.keys(params).forEach(function (key) {
        var v = params[key];
        if (v === undefined || v === null) return;
        search.append(key, typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
      var qs = search.toString();
      if (qs) full += (full.indexOf('?') === -1 ? '?' : '&') + qs;
    }
    return full;
  }

  function parseBody(text) {
    if (typeof text !== 'string') return text;
    var t = text.replace(/^\uFEFF/, '');
    if (/^\s*[[{]/.test(t)) {
      try { return JSON.parse(t); } catch (e) { return text; }
    }
    return text;
  }

  /**
   * 对齐原项目 api/util/request.js 的 createRequest：
   * 负责拼默认参数、算 signature、发请求，并把业务失败 reject 成 { status, body }
   */
  async function useAxios(options) {
    var dfid = (options.cookie && options.cookie.dfid) || '-';
    var mid = md5(dfid) + md5(dfid).slice(0, 7);
    var uuid = md5(dfid + mid);
    var token = (options.cookie && options.cookie.token) || '';
    var userid = (options.cookie && options.cookie.userid) || 0;
    var clienttime = Math.floor(Date.now() / 1000);

    var defaultParams = {
      dfid: dfid,
      mid: mid,
      uuid: uuid,
      appid: KA.appid,
      clientver: KA.clientver,
      userid: userid,
      clienttime: clienttime,
    };
    if (token) defaultParams.token = token;

    var params = options.clearDefaultParams
      ? options.params || {}
      : Object.assign({}, defaultParams, options.params || {});

    if (options.encryptKey) {
      params.key = signKey(params.hash, params.mid, params.userid, params.appid);
    }

    var rawData = options.data;
    var dataString = typeof rawData === 'object' && rawData !== null ? JSON.stringify(rawData) : rawData || '';

    if (!params.signature && !options.notSignature) {
      if (options.encryptType === 'register') params.signature = signatureRegisterParams(params);
      else if (options.encryptType === 'web') params.signature = signatureWebParams(params);
      else params.signature = signatureAndroidParams(params, dataString);
    }

    var baseURL = options.baseURL || 'https://gateway.kugou.com';
    var headers = Object.assign(
      { 'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi' },
      options.headers || {},
      { dfid: dfid, clienttime: params.clienttime, mid: mid }
    );

    var url = buildUrl(baseURL, options.url, params);
    var body = null;
    if (rawData !== undefined && rawData !== null) {
      body = typeof rawData === 'object' ? JSON.stringify(rawData) : String(rawData);
      var hasContentType = Object.keys(headers).some(function (k) { return k.toLowerCase() === 'content-type'; });
      if (!hasContentType) headers['content-type'] = 'application/json';
    }

    var answer = { status: 200, body: {}, cookie: [], headers: {} };

    var res;
    try {
      res = await gmRequestWithFallback({
        url: url,
        method: options.method || 'GET',
        headers: headers,
        body: body,
      });
    } catch (e) {
      answer.status = 502;
      answer.body = { status: 0, msg: e.message };
      throw answer;
    }

    var parsed = parseBody(res.text);
    answer.body = parsed;

    if (res.status >= 400) {
      answer.status = res.status;
      answer.body = Object.assign(
        { status: 0, msg: '请求失败', httpStatus: res.status },
        parsed && typeof parsed === 'object' ? parsed : {}
      );
      throw answer;
    }

    if (parsed && typeof parsed === 'object' &&
        (parsed.status === 0 || (parsed.error_code && parsed.error_code !== 0))) {
      answer.status = 502;
      throw answer;
    }

    return answer;
  }

  /* ================================================================== *
   *  3. 酷狗接口（移植自 api/module/*.js，语义保持不变）
   * ================================================================== */

  var MODULES = {
    /* 账号信息（用于校验 token 是否还有效） */
    user_detail: function (params, request) {
      var token = params.token || (params.cookie && params.cookie.token) || '';
      var userid = Number(params.userid || (params.cookie && params.cookie.userid) || '0');
      var clienttimeMs = Math.floor(Date.now() / 1000);
      var pk = cryptoRSAEncrypt({ token: token, clienttime: clienttimeMs }).toUpperCase();
      return request({
        url: '/v3/get_my_info',
        method: 'POST',
        data: { visit_time: clienttimeMs, usertype: 1, p: pk, userid: userid },
        params: { plat: 1 },
        encryptType: 'android',
        cookie: params.cookie || {},
        headers: { 'x-router': 'usercenter.kugou.com' },
      });
    },

    /* 听歌领 VIP */
    youth_listen_song: function (params, request) {
      return request({
        url: '/youth/v2/report/listen_song',
        data: { mixsongid: params.mixsongid || 666075191 },
        method: 'POST',
        encryptType: 'android',
        params: { clientver: 10566 },
        cookie: params.cookie,
        headers: {
          'user-agent': 'Android13-1070-10566-201-0-ReportPlaySongToServerProtocol-wifi',
          'content-type': 'application/json; charset=utf-8',
        },
      });
    },

    /* 看广告领 VIP */
    youth_vip: function (params, request) {
      var time = Date.now();
      return request({
        url: '/youth/v1/ad/play_report',
        encryptType: 'android',
        method: 'post',
        data: { ad_id: 12307537187, play_end: time, play_start: time - 30000 },
        cookie: params.cookie,
      });
    },

    /* VIP 到期时间 */
    user_vip_detail: function (params, request) {
      return request({
        baseURL: 'https://kugouvip.kugou.com',
        url: '/v1/get_union_vip',
        method: 'GET',
        params: { busi_type: 'concept' },
        encryptType: 'android',
        cookie: params.cookie || {},
      });
    },

    /* 刷新 token */
    login_token: function (params, request) {
      var key = '90b8382a1bb4ccdcf063102053fd75b8';
      var iv = 'f063102053fd75b8';
      var dateNow = Date.now();
      var token = params.token || (params.cookie && params.cookie.token) || '';
      var userid = params.userid || (params.cookie && params.cookie.userid) || '0';
      var encrypt = cryptoAesEncrypt({ clienttime: Math.floor(dateNow / 1000), token: token }, { key: key, iv: iv });
      var encryptParams = cryptoAesEncrypt({});
      var pk = cryptoRSAEncrypt({ clienttime_ms: dateNow, key: encryptParams.key });

      return request({
        baseURL: 'http://login.user.kugou.com',
        url: '/v5/login_by_token',
        method: 'POST',
        data: {
          dfid: (params.cookie && params.cookie.dfid) || '-',
          p3: encrypt,
          plat: 1,
          t1: 0,
          t2: 0,
          t3: 'MCwwLDAsMCwwLDAsMCwwLDA=',
          pk: pk,
          params: encryptParams.str,
          userid: userid,
          clienttime_ms: dateNow,
        },
        cookie: params.cookie,
        encryptType: 'android',
        headers: { 'x-router': 'login.user.kugou.com' },
      }).then(function (res) {
        var body = res.body;
        if (body && body.status === 1) {
          if (body.data && body.data.secu_params) {
            var got = cryptoAesDecrypt(body.data.secu_params, encryptParams.key);
            if (typeof got === 'object') res.body.data = Object.assign({}, body.data, got);
            else res.body.data.token = got;
          }
        }
        return res;
      });
    },

    /* 二维码 key */
    login_qr_key: function (params, request) {
      return request({
        baseURL: 'https://login-user.kugou.com',
        url: '/v2/qrcode',
        method: 'GET',
        params: {
          appid: params.type === 'web' ? 1014 : 1001,
          type: 1,
          plat: 4,
          qrcode_txt: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=' + KA.appid + '&',
          srcappid: 2919,
        },
        encryptType: 'web',
        cookie: params.cookie || {},
      });
    },

    /* 二维码状态：0 过期 / 1 待扫 / 2 待确认 / 4 成功 */
    login_qr_check: function (params, request) {
      return request({
        baseURL: 'https://login-user.kugou.com',
        url: '/v2/get_userinfo_qrcode',
        method: 'GET',
        params: { plat: 4, appid: KA.appid, srcappid: 2919, qrcode: params.key },
        encryptType: 'web',
        cookie: params.cookie || {},
      });
    },

    /* 发送短信验证码 */
    captcha_sent: function (params, request) {
      return request({
        baseURL: 'http://login.user.kugou.com',
        url: '/v7/send_mobile_code',
        method: 'POST',
        data: { businessid: 5, mobile: String(params.mobile), plat: 3 },
        encryptType: 'android',
        cookie: {},
      });
    },

    /* 手机号 + 验证码登录 */
    login_cellphone: function (params, request) {
      var dateTime = Date.now();
      var encrypt = cryptoAesEncrypt({ mobile: params.mobile || '', code: params.code || '' });
      var mobile = params.mobile && (String(params.mobile).substring(0, 2) + '*****' + String(params.mobile).substring(10, 11));
      var dataMap = {
        plat: 1,
        support_multi: 1,
        t1: 0,
        t2: 0,
        clienttime_ms: dateTime,
        mobile: mobile,
        key: signParamsKey(dateTime),
        t3: 'MCwwLDAsMCwwLDAsMCwwLDA=',
        params: encrypt.str,
        pk: cryptoRSAEncrypt({ clienttime_ms: dateTime, key: encrypt.key }).toUpperCase(),
      };

      return request({
        url: '/v7/login_by_verifycode',
        method: 'POST',
        data: dataMap,
        encryptType: 'android',
        cookie: params.cookie || {},
        headers: { 'x-router': 'login.user.kugou.com' },
      }).then(function (res) {
        var body = res.body;
        if (body && body.status === 1) {
          if (body.data && body.data.secu_params) {
            var got = cryptoAesDecrypt(body.data.secu_params, encrypt.key);
            if (typeof got === 'object') res.body.data = Object.assign({}, body.data, got);
            else res.body.data.token = got;
          }
        }
        return res;
      });
    },
  };

  async function callApi(name, params) {
    var mod = MODULES[name];
    if (!mod) throw new Error('未知接口：' + name);
    try {
      var res = await mod(params || {}, useAxios);
      return (res && res.body) || {};
    } catch (e) {
      // 业务失败时 request 会 reject 成 { status, body }，这里把 body 交回给调用方判断
      if (e && e.body) return e.body;
      throw e;
    }
  }

  function cookieOf(user) {
    return { token: String(user.token || ''), userid: String(user.userid || '') };
  }

  /* ================================================================== *
   *  4. 二维码编码（byte 模式 / 纠错等级 M / 自动选版本）
   *     矩阵与 npm 的 qrcode 库逐位对拍验证过，见 test/qr.test.js
   * ================================================================== */

  var QR_SPEC_M = {
    1: [1, 26, 16],
    2: [1, 44, 28],
    3: [1, 70, 44],
    4: [2, 50, 32],
    5: [2, 67, 43],
    6: [4, 43, 27],
    7: [4, 49, 31],
    8: [2, 60, 38, 2, 61, 39],
    9: [3, 58, 36, 2, 59, 37],
    10: [4, 69, 43, 1, 70, 44],
  };
  var QR_ALIGN_M = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
  };

  (function verifyQrTables() {
    var totals = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };
    Object.keys(QR_SPEC_M).forEach(function (v) {
      var spec = QR_SPEC_M[v];
      var blocks = 0;
      var data = 0;
      for (var i = 0; i < spec.length; i += 3) {
        blocks += spec[i];
        data += spec[i] * spec[i + 2];
      }
      var ecPerBlock = spec[1] - spec[2];
      if (data + blocks * ecPerBlock !== totals[v]) {
        throw new Error('二维码版本表自检失败：version ' + v);
      }
    });
  })();

  function rsGenPoly(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var a = 0; a < poly.length; a++) {
        next[a] ^= poly[a];
        next[a + 1] ^= gfMul(poly[a], QR_GF.exp[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = data.concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) {
        for (var j = 1; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
      }
    }
    return res.slice(data.length);
  }

  function qrCharCountBits(version) {
    return version < 10 ? 8 : 16;
  }

  function qrDataCodewords(version) {
    var spec = QR_SPEC_M[version];
    var total = 0;
    for (var i = 0; i < spec.length; i += 3) total += spec[i] * spec[i + 2];
    return total;
  }

  function qrBuildCodewords(bytes, version) {
    var buffer = [];
    function put(value, length) {
      for (var i = length - 1; i >= 0; i--) buffer.push((value >>> i) & 1);
    }

    put(4, 4); // 模式指示符：0100 = 8bit 字节模式
    put(bytes.length, qrCharCountBits(version));
    for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);

    var capacityBits = qrDataCodewords(version) * 8;
    if (buffer.length > capacityBits) throw new Error('二维码数据超长');

    if (buffer.length + 4 <= capacityBits) put(0, 4);
    while (buffer.length % 8 !== 0) buffer.push(0);
    while (buffer.length < capacityBits) {
      put(0xec, 8);
      if (buffer.length >= capacityBits) break;
      put(0x11, 8);
    }

    var codewords = [];
    for (var b = 0; b < buffer.length; b += 8) {
      var value = 0;
      for (var k = 0; k < 8; k++) value = (value << 1) | buffer[b + k];
      codewords.push(value);
    }

    // 分块 + 纠错 + 交织
    var spec = QR_SPEC_M[version];
    var blocks = [];
    for (var g = 0; g < spec.length; g += 3) {
      for (var c = 0; c < spec[g]; c++) blocks.push(spec[g + 2]);
    }
    var ecLen = spec[1] - spec[2];
    var dcData = [];
    var ecData = [];
    var offset = 0;
    var maxDc = 0;
    for (var bi = 0; bi < blocks.length; bi++) {
      var dc = codewords.slice(offset, offset + blocks[bi]);
      offset += blocks[bi];
      dcData.push(dc);
      ecData.push(rsEncode(dc, ecLen));
      maxDc = Math.max(maxDc, dc.length);
    }

    var out = [];
    for (var di = 0; di < maxDc; di++) {
      for (var r = 0; r < blocks.length; r++) {
        if (di < dcData[r].length) out.push(dcData[r][di]);
      }
    }
    for (var ei = 0; ei < ecLen; ei++) {
      for (var r2 = 0; r2 < blocks.length; r2++) out.push(ecData[r2][ei]);
    }
    return out;
  }

  function qrBch(data, poly, bits) {
    function digit(value) {
      var n = 0;
      while (value !== 0) { n++; value >>>= 1; }
      return n;
    }
    var d = data << bits;
    while (digit(d) - digit(poly) >= 0) d ^= poly << (digit(d) - digit(poly));
    return d;
  }

  function qrFormatBits(mask) {
    var data = (0 << 3) | mask; // 纠错等级 M 对应 00
    var bits = ((data << 10) | qrBch(data, 0x537, 10)) ^ 0x5412;
    return bits;
  }

  function qrVersionBits(version) {
    return (version << 12) | qrBch(version, 0x1f25, 12);
  }

  function qrMaskFn(pattern, i, j) {
    switch (pattern) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
      case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
      default: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
    }
  }

  function qrMatrix(version, codewords, mask) {
    var size = version * 4 + 17;
    var modules = [];
    for (var r = 0; r < size; r++) modules.push(new Array(size).fill(null));

    function setProbe(row, col) {
      for (var dr = -1; dr <= 7; dr++) {
        if (row + dr < 0 || row + dr >= size) continue;
        for (var dc = -1; dc <= 7; dc++) {
          if (col + dc < 0 || col + dc >= size) continue;
          var inRing = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                       (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                       (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          modules[row + dr][col + dc] = inRing;
        }
      }
    }
    setProbe(0, 0);
    setProbe(size - 7, 0);
    setProbe(0, size - 7);

    var align = QR_ALIGN_M[version];
    for (var a = 0; a < align.length; a++) {
      for (var b = 0; b < align.length; b++) {
        var ar = align[a];
        var ac = align[b];
        if (modules[ar][ac] !== null) continue;
        for (var r2 = -2; r2 <= 2; r2++) {
          for (var c2 = -2; c2 <= 2; c2++) {
            modules[ar + r2][ac + c2] = (r2 === -2 || r2 === 2 || c2 === -2 || c2 === 2 || (r2 === 0 && c2 === 0));
          }
        }
      }
    }

    for (var t = 8; t < size - 8; t++) {
      if (modules[t][6] === null) modules[t][6] = (t % 2 === 0);
      if (modules[6][t] === null) modules[6][t] = (t % 2 === 0);
    }

    // 格式信息占位（先写死值，mask 阶段会重写；这里只为占位，避免被数据覆盖）
    var bits = qrFormatBits(mask);
    for (var i = 0; i < 15; i++) {
      var mod = ((bits >> i) & 1) === 1;
      if (i < 6) modules[i][8] = mod;
      else if (i < 8) modules[i + 1][8] = mod;
      else modules[size - 15 + i][8] = mod;

      if (i < 8) modules[8][size - i - 1] = mod;
      else if (i < 9) modules[8][15 - i] = mod;
      else modules[8][15 - i - 1] = mod;
    }
    modules[size - 8][8] = true;

    if (version >= 7) {
      var vBits = qrVersionBits(version);
      for (var v = 0; v < 18; v++) {
        var vMod = ((vBits >> v) & 1) === 1;
        modules[Math.floor(v / 3)][(v % 3) + size - 11] = vMod;
        modules[(v % 3) + size - 11][Math.floor(v / 3)] = vMod;
      }
    }

    var bitIndex = 7;
    var byteIndex = 0;
    var inc = -1;
    var row = size - 1;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (var cc = 0; cc < 2; cc++) {
          var target = col - cc;
          if (modules[row][target] === null) {
            var dark = false;
            if (byteIndex < codewords.length) dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
            if (qrMaskFn(mask, row, target)) dark = !dark;
            modules[row][target] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }

    return modules;
  }

  function qrPenalty(modules) {
    var size = modules.length;
    var penalty = 0;

    // 规则 1：行/列中连续 5 个以上同色
    var container = new Array(size + 1).fill(0);
    for (var r = 0; r < size; r++) {
      var prev = modules[r][0];
      var len = 0;
      for (var c = 0; c < size; c++) {
        if (modules[r][c] === prev) len++;
        else { if (len >= 5) container[len]++; len = 1; prev = modules[r][c]; }
      }
      if (len >= 5) container[len]++;
    }
    for (var col = 0; col < size; col++) {
      var prevC = modules[0][col];
      var lenC = 0;
      for (var row = 0; row < size; row++) {
        if (modules[row][col] === prevC) lenC++;
        else { if (lenC >= 5) container[lenC]++; lenC = 1; prevC = modules[row][col]; }
      }
      if (lenC >= 5) container[lenC]++;
    }
    for (var n = 5; n <= size; n++) penalty += container[n] * (n - 2);

    // 规则 2：2x2 同色方块
    for (var r2 = 0; r2 < size - 1; r2++) {
      for (var c2 = 0; c2 < size - 1; c2++) {
        var v = modules[r2][c2];
        if (v === modules[r2][c2 + 1] && v === modules[r2 + 1][c2] && v === modules[r2 + 1][c2 + 1]) penalty += 3;
      }
    }

    // 规则 3：1:1:3:1:1 的类定位图案
    var pat = [true, false, true, true, true, false, true, false, false, false, false];
    var patRev = [false, false, false, false, true, false, true, true, true, false, true];
    function matchRow(rr, start, pattern) {
      for (var k = 0; k < 11; k++) if (modules[rr][start + k] !== pattern[k]) return false;
      return true;
    }
    function matchCol(cc, start, pattern) {
      for (var k = 0; k < 11; k++) if (modules[start + k][cc] !== pattern[k]) return false;
      return true;
    }
    for (var r3 = 0; r3 < size; r3++) {
      for (var c3 = 0; c3 + 11 <= size; c3++) {
        if (matchRow(r3, c3, pat) || matchRow(r3, c3, patRev)) penalty += 40;
      }
    }
    for (var c4 = 0; c4 < size; c4++) {
      for (var r4 = 0; r4 + 11 <= size; r4++) {
        if (matchCol(c4, r4, pat) || matchCol(c4, r4, patRev)) penalty += 40;
      }
    }

    // 规则 4：黑白比例偏离 50%
    var darkCount = 0;
    for (var r5 = 0; r5 < size; r5++) {
      for (var c5 = 0; c5 < size; c5++) if (modules[r5][c5]) darkCount++;
    }
    var ratio = (darkCount * 100) / (size * size);
    penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10;

    return penalty;
  }

  /** 生成二维码矩阵（版本按长度自动选择，纠错等级 M） */
  function qrEncode(text, forcedVersion, forcedMask) {
    var bytes = utf8Bytes(String(text));
    var version = forcedVersion || 0;
    if (!version) {
      for (var v = 1; v <= 10; v++) {
        var needBits = 4 + qrCharCountBits(v) + bytes.length * 8;
        if (needBits <= qrDataCodewords(v) * 8) { version = v; break; }
      }
    }
    if (!version) throw new Error('二维码内容过长，超出支持范围');

    var codewords = qrBuildCodewords(bytes, version);

    if (forcedMask !== undefined && forcedMask !== null) {
      return { version: version, mask: forcedMask, modules: qrMatrix(version, codewords, forcedMask) };
    }

    var bestMask = 0;
    var bestPenalty = Infinity;
    var bestModules = null;
    for (var m = 0; m < 8; m++) {
      var mods = qrMatrix(version, codewords, m);
      var p = qrPenalty(mods);
      if (p < bestPenalty) { bestPenalty = p; bestMask = m; bestModules = mods; }
    }
    return { version: version, mask: bestMask, penalty: bestPenalty, modules: bestModules };
  }

  /** 渲染成半块字符二维码（终端 / 日志里可直接扫） */
  function qrToText(matrix, quiet) {
    var n = matrix.length;
    var q = quiet === undefined ? 2 : quiet;
    var size = n + q * 2;
    function get(r, c) {
      if (r < q || c < q || r >= q + n || c >= q + n) return false;
      return matrix[r - q][c - q];
    }
    var lines = [];
    for (var r = 0; r < size; r += 2) {
      var line = '';
      for (var c = 0; c < size; c++) {
        var top = get(r, c);
        var bottom = r + 1 < size ? get(r + 1, c) : false;
        line += top && bottom ? '\u2588' : top ? '\u2580' : bottom ? '\u2584' : ' ';
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /* ================================================================== *
   *  5. 配置与账号存储
   * ================================================================== */

  var DEFAULT_CONFIG = {
    '账号.USERINFO': '[]',
    '账号.KG_APPEND': true,
    '登录.KG_PHONE': '',
    '登录.KG_CODE': '',
    '登录.KG_QR_SECONDS': 150,
    '登录.KG_QR_ONLINE': true,
    '签到.KG_CLAIM_TIMES': 8,
    '签到.KG_CLAIM_INTERVAL': 30,
    '签到.KG_REFRESH_WEEKDAY': 0,
    '通知.KG_NOTIFY_SYSTEM': true,
    '通知.WECOM_BOT_KEY': '',
    '通知.DINGTALK_BOT_KEY': '',
    '通知.DINGTALK_SECRET': '',
    '通知.FEISHU_BOT_KEY': '',
    '通知.YUNHU_BOT_KEY': '',
    '通知.SERVERCHAN_SENDKEY': '',
    '通知.PUSHPLUS_TOKEN': '',
    '通知.PUSHPLUS_TOPIC': '',
    '通知.TG_BOT_TOKEN': '',
    '通知.TG_CHAT_ID': '',
    '通知.BARK_KEY': '',
    '通知.BARK_GROUP': '',
    '通知.DISCORD_WEBHOOK': '',
  };

  function cfg(key) {
    var def = DEFAULT_CONFIG[key];
    var gmGet = GM('GM_getValue');
    if (gmGet) {
      try {
        var v = gmGet(key, def);
        if (v === undefined || v === null) return def;
        return v;
      } catch (e) { /* ignore */ }
    }
    return def;
  }

  function cfgStr(key) {
    var v = cfg(key);
    return v === undefined || v === null ? '' : String(v);
  }

  function cfgInt(key, fallback) {
    var n = Number(cfgStr(key));
    return Number.isNaN(n) || cfgStr(key) === '' ? fallback : n;
  }

  function cfgBool(key) {
    var v = cfg(key);
    if (typeof v === 'boolean') return v;
    var s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === '是';
  }

  var KEY_SNAPSHOT = 'kg_userinfo_snapshot';
  var KEY_SYNC = 'kg_userinfo_sync';
  var KEY_PHONE = 'kg_phone';

  function gmSet(key, value) {
    var set = GM('GM_setValue');
    if (!set) return false;
    try { set(key, value); return true; } catch (e) { return false; }
  }

  function gmGet(key, def) {
    var get = GM('GM_getValue');
    if (!get) return def;
    try {
      var v = get(key, def);
      return v === undefined ? def : v;
    } catch (e) { return def; }
  }

  function parseUserList(raw) {
    if (!raw || !String(raw).trim()) return [];
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(function (u) { return u && u.userid && u.token; });
      }
      if (parsed && typeof parsed === 'object' && parsed.userid) return [parsed];
      return [];
    } catch (e) {
      log('[配置] 账号列表不是合法 JSON，已忽略：' + e.message);
      return [];
    }
  }

  /**
   * 读账号：配置里的列表为准，本地快照里的新 token 覆盖同 userid 的旧 token。
   * 若用户在配置里手动改过列表（与上次同步的内容不一致），则重置快照，尊重手动内容。
   */
  function readUsers() {
    var raw = cfgStr('账号.USERINFO');
    var lastSync = String(gmGet(KEY_SYNC, '') || '');
    var configUsers = parseUserList(raw);
    var snapshot = gmGet(KEY_SNAPSHOT, []);
    if (!Array.isArray(snapshot)) snapshot = [];

    if (raw !== lastSync) snapshot = [];

    var users = configUsers.slice();
    snapshot.forEach(function (snapUser) {
      if (!snapUser || !snapUser.userid) return;
      var idx = -1;
      for (var i = 0; i < users.length; i++) {
        if (String(users[i].userid) === String(snapUser.userid)) { idx = i; break; }
      }
      if (idx >= 0) users[idx] = Object.assign({}, users[idx], snapUser);
      else users.push(snapUser);
    });

    var source = configUsers.length ? (snapshot.length ? '配置 + 快照' : '配置') : (snapshot.length ? '快照' : '');
    return { users: users, source: source };
  }

  function saveUsers(users) {
    var raw = JSON.stringify(users, null, 2);
    gmSet(KEY_SNAPSHOT, users);
    gmSet(KEY_SYNC, raw);
    gmSet('账号.USERINFO', raw);
  }

  function upsertUser(list, loginUser, append) {
    var user = { userid: String(loginUser.userid), token: String(loginUser.token) };
    if (!append) return [user];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].userid) === user.userid) {
        log('[信息] userid ' + maskIdentifier(user.userid) + ' 已存在，仅更新 token');
        list[i] = Object.assign({}, list[i], user);
        return list;
      }
    }
    list.push(user);
    return list;
  }

  /* ================================================================== *
   *  6. 通知
   * ================================================================== */

  async function postJson(url, body, headers) {
    var res = await gmRequestWithFallback({
      url: url,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
      body: JSON.stringify(body),
      timeout: 15000,
    });
    return res;
  }

  async function postForm(url, form) {
    return gmRequestWithFallback({
      url: url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      timeout: 15000,
    });
  }

  /**
   * 收集所有已配置的通知渠道。
   *
   * 注意：每个渠道 key 必须用各自独立的变量名。
   * 这些闭包是延迟执行的（sendNotify 里统一 Promise.all），
   * 如果共用一个 var，回调跑的时候读到的会是最后一个值。
   */
  function notifyChannels(title, content) {
    var list = [];

    var wecomKey = cfgStr('通知.WECOM_BOT_KEY');
    if (wecomKey) list.push(['企业微信', async function () {
      var res = await postJson('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + encodeURIComponent(wecomKey), {
        msgtype: 'text', text: { content: title + '\n\n' + content },
      });
      var data = parseBody(res.text) || {};
      if (data.errcode !== 0) throw new Error(data.errmsg || 'errcode=' + data.errcode);
    }]);

    var dingtalkKey = cfgStr('通知.DINGTALK_BOT_KEY');
    var dingtalkSecret = cfgStr('通知.DINGTALK_SECRET');
    if (dingtalkKey) list.push(['钉钉', async function () {
      var url = 'https://oapi.dingtalk.com/robot/send?access_token=' + encodeURIComponent(dingtalkKey);
      if (dingtalkSecret) {
        var timestamp = Date.now();
        var sign = hmacSha256Base64(dingtalkSecret, timestamp + '\n' + dingtalkSecret);
        url += '&timestamp=' + timestamp + '&sign=' + encodeURIComponent(sign);
      }
      var res = await postJson(url, { msgtype: 'markdown', markdown: { title: title, text: '### ' + title + '\n\n' + content } });
      var data = parseBody(res.text) || {};
      if (data.errcode !== 0) throw new Error(data.errmsg || 'errcode=' + data.errcode);
    }]);

    var feishuKey = cfgStr('通知.FEISHU_BOT_KEY');
    if (feishuKey) list.push(['飞书', async function () {
      var res = await postJson('https://open.feishu.cn/open-apis/bot/v2/hook/' + encodeURIComponent(feishuKey), {
        msg_type: 'text', content: { text: title + '\n\n' + content },
      });
      var data = parseBody(res.text) || {};
      if (data.code !== undefined && data.code !== 0) throw new Error(data.msg || 'code=' + data.code);
    }]);

    var yunhuKey = cfgStr('通知.YUNHU_BOT_KEY');
    if (yunhuKey) list.push(['云湖', async function () {
      var res = await postJson('https://www.yhchat.com/bot/send?key=' + encodeURIComponent(yunhuKey), {
        msg: { text: title + '\n\n' + content },
      });
      if (res.status >= 400) throw new Error('HTTP ' + res.status);
    }]);

    var serverchanKey = cfgStr('通知.SERVERCHAN_SENDKEY');
    if (serverchanKey) list.push(['Server酱', async function () {
      var res = await postForm('https://sctapi.ftqq.com/' + encodeURIComponent(serverchanKey) + '.send', { title: title, desp: content });
      if (res.status >= 400) throw new Error('HTTP ' + res.status);
    }]);

    var pushplusToken = cfgStr('通知.PUSHPLUS_TOKEN');
    var pushplusTopic = cfgStr('通知.PUSHPLUS_TOPIC');
    if (pushplusToken) list.push(['PushPlus', async function () {
      var body = { token: pushplusToken, title: title, content: content, template: 'txt' };
      if (pushplusTopic) body.topic = pushplusTopic;
      var res = await postJson('https://www.pushplus.plus/send', body);
      var data = parseBody(res.text) || {};
      if (data.code !== undefined && data.code !== 200) throw new Error(data.msg || 'code=' + data.code);
    }]);

    var tgToken = cfgStr('通知.TG_BOT_TOKEN');
    var tgChat = cfgStr('通知.TG_CHAT_ID');
    if (tgToken && tgChat) list.push(['Telegram', async function () {
      var res = await postJson('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
        chat_id: tgChat, text: '*' + title + '*\n\n' + content, parse_mode: 'Markdown',
      });
      var data = parseBody(res.text) || {};
      if (!data.ok) throw new Error(data.description || 'Telegram 返回失败');
    }]);

    var barkKey = cfgStr('通知.BARK_KEY');
    var barkGroup = cfgStr('通知.BARK_GROUP');
    if (barkKey) list.push(['Bark', async function () {
      var base = barkKey.indexOf('http') === 0 ? barkKey : 'https://api.day.app/' + barkKey;
      var url = base.replace(/\/$/, '') + '/' + encodeURIComponent(title) + '/' + encodeURIComponent(content);
      if (barkGroup) url += '?group=' + encodeURIComponent(barkGroup);
      var res = await gmRequestWithFallback({ url: url, method: 'GET', timeout: 15000 });
      if (res.status >= 400) throw new Error('HTTP ' + res.status);
    }]);

    var discordWebhook = cfgStr('通知.DISCORD_WEBHOOK');
    if (discordWebhook) list.push(['Discord', async function () {
      var res = await postJson(discordWebhook, { content: ('**' + title + '**\n\n' + content).slice(0, 2000) });
      if (res.status >= 400) throw new Error('HTTP ' + res.status);
    }]);

    return list;
  }

  async function sendNotify(title, content) {
    var jobs = [];

    if (cfgBool('通知.KG_NOTIFY_SYSTEM')) {
      jobs.push(['系统通知', async function () {
        var notify = GM('GM_notification');
        if (!notify) throw new Error('当前环境不支持 GM_notification');
        notify({ title: title, text: content.slice(0, 400), timeout: 10000 });
      }]);
    }

    var channels = notifyChannels(title, content);
    if (!channels.length && !jobs.length) {
      log('[通知] 没有配置任何通知渠道，跳过');
      return;
    }

    jobs = jobs.concat(channels);
    log('[通知] 正在推送到 ' + jobs.length + ' 个渠道...');
    var results = await Promise.all(
      jobs.map(function (job) {
        return job[1]().then(
          function () { return { name: job[0], ok: true }; },
          function (e) { return { name: job[0], ok: false, reason: (e && e.message) || String(e) }; }
        );
      })
    );
    var ok = 0;
    results.forEach(function (r) {
      if (r.ok) { log('  ✓ ' + r.name + ' 发送成功'); ok++; }
      else log('  ✗ ' + r.name + ' 发送失败：' + r.reason);
    });
    log('[通知] 完成：' + ok + ' 成功，' + (results.length - ok) + ' 失败');
  }

  /* ================================================================== *
   *  7. 签到主流程
   * ================================================================== */

  async function runSign() {
    var info = readUsers();
    var users = info.users;
    if (!users.length) {
      throw new Error('未配置账号：请先用菜单里的「扫码登录 / 手机号登录」，或在脚本配置的「账号列表」里填写 [{"userid":"xxx","token":"xxx"}]');
    }
    log('共读取到 ' + users.length + ' 个账号（来源：' + (info.source || '未知') + '）');

    var today = beijingNow();
    var date = formatDate(today);
    var claimTimes = cfgInt('签到.KG_CLAIM_TIMES', 8);
    var claimInterval = cfgInt('签到.KG_CLAIM_INTERVAL', 30);
    var refreshWeekday = cfgInt('签到.KG_REFRESH_WEEKDAY', 0);

    log('今天是 ' + date + '（北京时间），每个账号最多领 ' + claimTimes + ' 次');

    var results = [];
    var errorMsg = {};
    var needRefresh = false;
    var hasNetworkError = false;

    for (var ui = 0; ui < users.length; ui++) {
      var user = users[ui];
      try {
        var cookie = cookieOf(user);
        var detail = await callApi('user_detail', { cookie: cookie });

        if (!detail || !detail.data || detail.data.nickname === undefined || detail.data.nickname === null) {
          var safeUserId = maskIdentifier(user.userid);
          log('[失败] token 过期或账号不存在，userid: ' + safeUserId);
          errorMsg[safeUserId] = { msg: 'token过期或账号不存在', data: summarizeResponse(detail) };
          results.push({ nickname: safeUserId, status: '失败', listen: '账号不存在', vipClaim: '0/' + claimTimes, vipExpiry: '未知', error: 'token过期或账号不存在' });
          continue;
        }

        var nickname = maskDisplayName(detail.data.nickname);
        log('账号 ' + nickname + ' 开始签到...');

        if (refreshWeekday >= 0 && today.getDay() === refreshWeekday) {
          try {
            var refreshed = await callApi('login_token', { cookie: cookie, token: user.token, userid: user.userid });
            if (refreshed && refreshed.status === 1 && refreshed.data && refreshed.data.token && refreshed.data.token !== user.token) {
              user.token = refreshed.data.token;
              cookie.token = String(user.token);
              needRefresh = true;
              log('[信息] 账号 ' + nickname + ' 已续期 token');
            }
          } catch (e) {
            log('[警告] 账号 ' + nickname + ' 续期 token 失败：' + ((e && e.message) || e));
          }
        }

        // 听歌领 VIP
        var listen = await callApi('youth_listen_song', { cookie: cookie });
        var listenStatus = '未知';
        if (listen && listen.status === 1) { log('[成功] 听歌领取成功'); listenStatus = '成功'; }
        else if (listen && listen.error_code === 130012) { log('[成功] 听歌今日已领取'); listenStatus = '今日已领取'; }
        else {
          log('[失败] 听歌领取失败');
          errorMsg[nickname + ' listen'] = summarizeResponse(listen);
          listenStatus = '失败';
        }

        // 看广告领 VIP
        log('开始领取 VIP...');
        var claimCount = 0;
        var claimTotal = 0;
        for (var i = 1; i <= claimTimes; i++) {
          var ad = await callApi('youth_vip', { cookie: cookie });
          claimTotal = i;
          if (ad && ad.status === 1) {
            log('[成功] 第 ' + i + ' 次领取成功');
            claimCount++;
            if (i !== claimTimes) await delay(claimInterval * 1000);
          } else if (ad && ad.error_code === 30002) {
            log('[成功] 今天次数已用光');
            break;
          } else {
            log('[失败] 第 ' + i + ' 次领取失败');
            errorMsg[nickname + ' ad'] = summarizeResponse(ad);
            break;
          }
        }

        // VIP 到期时间
        var vipExpiry = '未知';
        var vipDetail = await callApi('user_vip_detail', { cookie: cookie });
        if (vipDetail && vipDetail.status === 1 && Array.isArray(vipDetail.data && vipDetail.data.busi_vip) && vipDetail.data.busi_vip.length) {
          vipExpiry = vipDetail.data.busi_vip[0].vip_end_time;
          log('[信息] VIP 到期时间：' + vipExpiry);
        } else {
          log('[失败] 获取 VIP 信息失败');
          errorMsg[nickname + ' vip_detail'] = summarizeResponse(vipDetail);
        }

        results.push({
          nickname: nickname,
          status: listenStatus === '失败' || claimCount === 0 ? '部分失败' : '成功',
          listen: listenStatus,
          vipClaim: claimCount + '/' + claimTotal,
          vipExpiry: vipExpiry,
          error: '',
        });
      } catch (err) {
        var safeId = maskIdentifier(user.userid || '未知');
        var msg = (err && err.message) || String(err);
        if (/网络错误|请求超时|请求被中断|Failed to fetch/i.test(msg)) hasNetworkError = true;
        log('[失败] 账号 ' + safeId + ' 处理异常：' + msg);
        errorMsg[safeId] = { msg: '处理异常', error: msg };
        results.push({ nickname: safeId, status: '失败', listen: '异常', vipClaim: '0/' + claimTimes, vipExpiry: '未知', error: msg });
      }
    }

    if (needRefresh) {
      log('[信息] 检测到 token 变化，正在回写账号信息...');
      saveUsers(users);
    }

    var successCount = results.filter(function (r) { return r.status === '成功'; }).length;
    var title = '酷狗签到' + (Object.keys(errorMsg).length ? '异常' : '成功') + ' ' + date;
    var content = '📅 日期: ' + date + '\n📊 账号数: ' + results.length + '\n';
    content += '✅ 成功: ' + successCount + '  ❌ 失败: ' + (results.length - successCount) + '\n';
    results.forEach(function (r) {
      content += '\n【' + r.nickname + '】\n  🎵 听歌领取: ' + r.listen + '\n  🎁 VIP领取: ' + r.vipClaim + ' 次\n  ⏰ VIP到期: ' + r.vipExpiry + '\n';
      if (r.error) content += '  ⚠️ 错误: ' + r.error + '\n';
    });

    try { await sendNotify(title, content); } catch (e) { log('[警告] 通知发送异常：' + ((e && e.message) || e)); }

    if (Object.keys(errorMsg).length) {
      log('[失败] 异常信息如下：');
      log(JSON.stringify(errorMsg, null, 2));
      var err = new Error('领取异常');
      err.network = hasNetworkError;
      throw err;
    }

    log('[完成] 全部账号处理完毕');
    return results;
  }

  /* ================================================================== *
   *  8. 登录：扫码 / 手机号
   * ================================================================== */

  async function prepareQrDisplay(url) {
    var qr = qrEncode(url);
    log('二维码已生成：版本 v' + qr.version + '，纠错等级 M，掩码 ' + qr.mask + '。用「酷狗音乐 APP → 扫一扫」扫描下面这块图案：');
    logLine('');
    qrToText(qr.modules, 2).split('\n').forEach(function (line) { logLine(line); });
    logLine('');

    var onlineUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=16&ecc=M&data=' + encodeURIComponent(url);
    if (cfgBool('登录.KG_QR_ONLINE')) {
      var open = GM('GM_openInTab');
      var opened = false;
      if (open) {
        try {
          open(onlineUrl, { active: true, insert: true });
          opened = true;
        } catch (e) {
          opened = false;
        }
      }
      if (opened) {
        log('[提示] 已在新标签页打开一张大二维码，扫那张更省事（不想外发扫码链接，可在配置里关掉「二维码用浏览器打开」）');
      } else {
        log('[提示] 没能自动打开新标签页。把下面这个地址复制到浏览器地址栏，就是同一张大二维码：');
        log(onlineUrl);
      }
    }
    log('扫码链接（若上面两种都不行，用任意本地二维码工具生成即可）：');
    log(url);
  }

  async function qrLogin() {
    var timeoutSec = cfgInt('登录.KG_QR_SECONDS', 150);
    var append = cfgBool('账号.KG_APPEND');

    var keyResp = await callApi('login_qr_key', { cookie: {} });
    if (!keyResp || keyResp.status !== 1 || !keyResp.data || !keyResp.data.qrcode) {
      log('[失败] 获取二维码失败：' + JSON.stringify(summarizeResponse(keyResp)));
      throw new Error('获取二维码密钥失败');
    }

    var qrcode = keyResp.data.qrcode;
    var url = 'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=' + qrcode;

    log('\n================ 酷狗扫码登录 ================');
    log('请使用「酷狗音乐 APP」扫描下方二维码并确认登录\n');
    await prepareQrDisplay(url);
    log('\n等待扫码确认（最多 ' + timeoutSec + ' 秒）...\n');

    var deadline = Date.now() + timeoutSec * 1000;
    var loggedIn = false;
    var expired = false;

    while (Date.now() < deadline) {
      var res = await callApi('login_qr_check', { cookie: {}, key: qrcode });
      var status = res && res.data ? res.data.status : undefined;

      if (status === 4) {
        var list = append ? readUsers().users.slice() : [];
        upsertUser(list, { userid: res.data.userid, token: res.data.token }, true);
        saveUsers(list);
        loggedIn = true;
        log('[成功] 登录成功！账号已保存，当前共 ' + list.length + ' 个账号');
        break;
      }
      if (status === 0) {
        log('[失败] 二维码已过期，请重新执行菜单里的「① 扫码登录」');
        expired = true;
        break;
      }
      if (status === 2) log('[信息] 已扫码，等待 APP 上点击确认...');
      await delay(3000);
    }

    if (!loggedIn && !expired) throw new Error('等待扫码超时，请重新执行菜单里的「① 扫码登录」');

    var notify = GM('GM_notification');
    if (loggedIn && notify) {
      try { notify({ title: '酷狗登录成功', text: '账号已保存，等待每天的定时签到即可', timeout: 5000 }); } catch (e) { /* ignore */ }
    }
    return loggedIn;
  }

  /** 手机号从哪儿来的（依次：菜单输入框 → 上次用过的 → 脚本配置） */
  function resolvePhone(phoneArg) {
    var fromInput = String(phoneArg === undefined || phoneArg === null ? '' : phoneArg).trim();
    var remembered = String(gmGet(KEY_PHONE, '') || '').trim();
    var fromConfig = String(cfgStr('登录.KG_PHONE') || '').trim();
    if (fromInput) return { phone: fromInput, source: '菜单输入框' };
    if (remembered) return { phone: remembered, source: '上次用过的手机号' };
    if (fromConfig) return { phone: fromConfig, source: '脚本配置' };
    return { phone: '', source: '无' };
  }

  /**
   * 发送短信验证码。
   * @param {string} [phoneArg] 手机号；不传则依次取「上次用过的手机号」→「配置里的手机号」
   */
  async function sendSmsCode(phoneArg) {
    var resolved = resolvePhone(phoneArg);
    var phone = resolved.phone;

    if (!phone) {
      log('[失败] 没拿到手机号：菜单输入框、上次记录、脚本配置里都是空的');
      throw new Error(
        '没填手机号。两种填法任选：① 菜单弹出输入框时，在框里填 11 位手机号；' +
        '② 打开脚本配置 →「登录」组 → 填「手机号」→ 保存后重新点这个菜单'
      );
    }
    log('[信息] 本次使用手机号 ' + maskPhone(phone) + '（来源：' + resolved.source + '）');

    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('手机号格式不对（应该是 11 位数字）：' + maskPhone(phone));
    }

    var sent = await callApi('captcha_sent', { mobile: phone });
    if (sent && sent.status === 1) {
      // 只记在脚本自己的存储里，不动用户的配置
      gmSet(KEY_PHONE, phone);
      log('[成功] 验证码已发送到 ' + maskPhone(phone) + '，请查收短信');
      log('[提示] 验证码只有几分钟有效期，收到后请尽快执行菜单「③ 手机号登录」');
      return true;
    }
    var hint = errorTextOf(sent);
    log('[失败] 验证码发送失败：' + JSON.stringify(summarizeResponse(sent)));
    throw new Error('验证码发送失败' + (hint ? '：' + hint : ''));
  }

  /**
   * 手机号 + 验证码登录。
   * @param {string} [codeArg] 验证码；不传则取配置里的「短信验证码」
   * @param {string} [phoneArg] 手机号；不传则依次取「上次用过的手机号」→「配置里的手机号」
   */
  async function phoneLogin(codeArg, phoneArg) {
    var resolved = resolvePhone(phoneArg);
    var phone = resolved.phone;
    var fromInput = String(codeArg === undefined || codeArg === null ? '' : codeArg).trim();
    var fromConfig = String(cfgStr('登录.KG_CODE') || '').trim();
    var code = fromInput || fromConfig;

    if (!phone) {
      log('[失败] 没拿到手机号（来源：' + resolved.source + '）');
      throw new Error('不知道用哪个手机号登录：请先执行菜单「② 发送短信验证码」把手机号填一次');
    }
    if (!code) {
      log('[失败] 没拿到验证码：菜单输入框和脚本配置里都是空的');
      throw new Error('没填验证码。两种填法任选：① 菜单弹出输入框时，在框里填收到的验证码；② 到脚本配置的「登录 → 短信验证码」里填上');
    }
    log('[信息] 本次使用手机号 ' + maskPhone(phone) + '（来源：' + resolved.source + '），验证码来源：' + (fromInput ? '菜单输入框' : '脚本配置'));

    var result = await callApi('login_cellphone', { mobile: phone, code: code });
    if (result && result.status === 1 && result.data && result.data.token) {
      var append = cfgBool('账号.KG_APPEND');
      var list = append ? readUsers().users : [];
      upsertUser(list, { userid: result.data.userid, token: result.data.token }, true);
      saveUsers(list);
      log('[成功] 登录成功！账号已保存，当前共 ' + list.length + ' 个账号');
      return true;
    }

    var hint = errorTextOf(result);
    log('[失败] 登录失败：' + JSON.stringify(summarizeResponse(result)));
    throw new Error('登录失败' + (hint ? '：' + hint : '，请检查手机号与验证码'));
  }

  /* ================================================================== *
   *  9. 菜单与入口
   * ================================================================== */

  /**
   * 没有账号时：日志 + 系统通知，把用户带到登录入口
   */
  function notifyLoginGuide() {
    log('还没有配置任何账号，两种登录方式任选一种：');
    log('  ① 扫码登录：点浏览器工具栏的 ScriptCat 图标 → 找到本脚本 → 菜单「① 扫码登录」');
    log('  ② 手机号登录：菜单「② 发送短信验证码」→ 在弹出的输入框里填手机号 →');
    log('     收到短信后点菜单「③ 手机号登录」，在输入框里填验证码（手机号会记住，不用重复填）');
    log('  ③ 手动粘贴：在脚本配置里把账号列表填成 [{"userid":"...","token":"..."}]');
    var notify = GM('GM_notification');
    if (!notify) return;
    var text = '点浏览器工具栏的 ScriptCat 图标 → 找到本脚本 → 菜单「① 扫码登录」\n或在脚本配置里粘贴账号列表';
    try {
      notify({
        title: '酷狗签到：还没有配置账号',
        text: text,
        timeout: 15000,
        buttons: [{ title: '扫码登录' }],
        onclick: function (e) {
          if (e && e.isButtonClick && e.buttonClickIndex === 0) {
            qrLogin().catch(function (err) { log('[失败] ' + ((err && err.message) || err)); });
          }
        },
      });
    } catch (err) {
      // 个别版本不支持按钮 / onclick，退化成纯文字通知，引导文字仍在
      try { notify({ title: '酷狗签到：还没有配置账号', text: text, timeout: 15000 }); } catch (e2) { /* ignore */ }
    }
  }

  function registerMenus() {
    var register = GM('GM_registerMenuCommand');
    var registerInput = GM('CAT_registerMenuInput');

    /**
     * 优先用脚本猫的「带输入框的菜单」（CAT_registerMenuInput），
     * 这样手机号 / 验证码可以直接在弹出层里输入，不用来回改脚本配置。
     * 老版本或其它管理器没有这个 API 时，自动退回普通菜单（改从配置读）。
     */
    function add(name, fn, id, inputOptions) {
      if (inputOptions && registerInput) {
        try {
          registerInput(name, fn, Object.assign({ id: id }, inputOptions));
          return;
        } catch (e) { /* 退回普通菜单 */ }
      }
      if (!register) return;
      try { register(name, fn, { id: id }); } catch (e) { /* 老版本管理器可能不支持，忽略 */ }
    }

    var hasInput = Boolean(registerInput);

    add('① 扫码登录（新增账号）', function () {
      return qrLogin().catch(function (e) { log('[失败] ' + ((e && e.message) || e)); });
    }, 'kg-qr-login');

    add(hasInput ? '② 发送短信验证码（填写手机号）' : '② 发送短信验证码（用配置里的手机号）', function (inputValue) {
      return sendSmsCode(inputValue).catch(function (e) { log('[失败] ' + ((e && e.message) || e)); });
    }, 'kg-send-sms', { inputType: 'text', inputLabel: '手机号', inputPlaceholder: '11 位手机号' });

    add(hasInput ? '③ 手机号登录（填写验证码）' : '③ 手机号登录（用配置里的验证码）', function (inputValue) {
      return phoneLogin(inputValue).catch(function (e) { log('[失败] ' + ((e && e.message) || e)); });
    }, 'kg-phone-login', { inputType: 'text', inputLabel: '短信验证码', inputPlaceholder: '收到的验证码' });

    add('④ 立即签到（不等定时）', function () {
      log('手动触发签到...');
      return runSign()
        .then(function () { log('[完成] 手动签到结束'); })
        .catch(function (e) { log('[失败] ' + ((e && e.message) || e)); });
    }, 'kg-run-now');

    add('⑤ 查看当前账号', function () {
      var info = readUsers();
      if (!info.users.length) { log('当前没有任何账号'); notifyLoginGuide(); return; }
      log('当前共 ' + info.users.length + ' 个账号：');
      info.users.forEach(function (u, i) {
        log('  ' + (i + 1) + '. userid=' + maskIdentifier(u.userid) + '  token=' + maskIdentifier(u.token));
      });
    }, 'kg-list-users');

    add('⑥ 清空本地账号', function () {
      gmSet(KEY_SNAPSHOT, []);
      gmSet(KEY_SYNC, '[]');
      gmSet('账号.USERINFO', '[]');
      log('已清空本地保存的账号（配置里的账号列表也一并清空）');
    }, 'kg-clear-users');
  }

  async function runScheduled() {
    log('==============================');
    log('定时任务启动');
    log('==============================');
    try {
      await runSign();
      return 'ok';
    } catch (e) {
      var msg = (e && e.message) || String(e);
      log('[失败] ' + msg);
      if (/未配置账号/.test(msg)) notifyLoginGuide();
      // 网络类问题交给 ScriptCat 稍后重试（同一天内的重试不受 once 限制）
      if (e && e.network && typeof CATRetryError !== 'undefined') {
        throw new CATRetryError(msg + '（稍后自动重试）', 120);
      }
      throw e;
    }
  }

  // 测试钩子：仅在 Node 测试环境（定义了 __KG_TEST_HOOK__）下导出内部实现
  if (typeof __KG_TEST_HOOK__ !== 'undefined') {
    __KG_TEST_HOOK__({
      md5: md5, sha256: sha256, hmacSha256Base64: hmacSha256Base64,
      aesCbcEncrypt: aesCbcEncrypt, aesCbcDecrypt: aesCbcDecrypt,
      cryptoAesEncrypt: cryptoAesEncrypt, cryptoAesDecrypt: cryptoAesDecrypt,
      cryptoRSAEncrypt: cryptoRSAEncrypt, rsaEncrypt2: rsaEncrypt2,
      signatureAndroidParams: signatureAndroidParams, signatureWebParams: signatureWebParams,
      signKey: signKey, signParamsKey: signParamsKey,
      useAxios: useAxios, callApi: callApi, MODULES: MODULES,
      qrEncode: qrEncode, qrToText: qrToText, qrPenalty: qrPenalty, base64Encode: base64Encode,
      qrBuildCodewords: qrBuildCodewords, rsGenPoly: rsGenPoly, rsEncode: rsEncode, qrMatrix: qrMatrix,
      aesExpandKey: aesExpandKey, aesEncryptBlock: aesEncryptBlock,
      aesDecryptBlock: aesDecryptBlock, aesMul: aesMul, gfMul: gfMul,
      readUsers: readUsers, saveUsers: saveUsers, runSign: runSign,
      sendNotify: sendNotify, notifyChannels: notifyChannels,
      resolveGM: GM, registerMenus: registerMenus,
      sendSmsCode: sendSmsCode, phoneLogin: phoneLogin, errorTextOf: errorTextOf,
      summarizeResponse: summarizeResponse, KEY_PHONE: KEY_PHONE, maskPhone: maskPhone,
    });
    return new Promise(function (resolve) { resolve('test'); });
  }

  registerMenus();
  return runScheduled();
})();
