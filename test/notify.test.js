/**
 * 通知渠道测试（离线）
 *
 * 用假的 GM_xmlhttpRequest 把请求 URL 记下来，验证：
 *   · 每个渠道用的都是自己的 key（这里曾经有过一个闭包变量共用的 bug）
 *   · 消息标题和正文真的被发出去了
 *   · 某个渠道失败不影响其它渠道
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

/** 记录所有请求的 GM_xmlhttpRequest 替身 */
function recordingXhr(calls, failOn) {
  return function (options) {
    calls.push({ url: options.url, method: options.method, data: options.data, headers: options.headers });
    const shouldFail = failOn && options.url.includes(failOn);
    setTimeout(() => {
      if (shouldFail) {
        options.onerror && options.onerror({ error: 'stub failure' });
      } else {
        // 各渠道成功响应的形状不一样，按域名给出最接近真实的一份，
        // 避免用一个"万能响应"把渠道各自的成功判定逻辑掩盖过去。
        let body;
        if (options.url.includes('chat-go.jwzhd.com')) {
          // 云湖：成功是 code:1，不是 code:0
          body = { code: 1, data: { messageInfo: { msgId: 'stub-msg-id' } }, msg: 'success' };
        } else if (options.url.includes('qyapi.weixin.qq.com') || options.url.includes('oapi.dingtalk.com')) {
          body = { errcode: 0, errmsg: 'ok' };
        } else if (options.url.includes('open.feishu.cn')) {
          body = { code: 0, msg: 'success' };
        } else if (options.url.includes('pushplus.plus')) {
          body = { code: 200, msg: '请求成功' };
        } else if (options.url.includes('api.telegram.org')) {
          body = { ok: true };
        } else {
          body = { code: 0, ok: true };
        }
        options.onload &&
          options.onload({
            status: 200,
            responseHeaders: 'content-type: application/json',
            responseText: JSON.stringify(body),
          });
      }
    }, 0);
  };
}

const KEYS = {
  '通知.KG_NOTIFY_SYSTEM': false,
  '通知.WECOM_BOT_KEY': 'wecom-key-AAA',
  '通知.FEISHU_BOT_KEY': 'feishu-key-BBB',
  '通知.PUSHPLUS_TOKEN': 'pushplus-token-CCC',
  '通知.SERVERCHAN_SENDKEY': 'serverchan-key-DDD',
  '通知.DISCORD_WEBHOOK': 'https://discord.com/api/webhooks/EEE/FFF',
};

(async function main() {
  console.log('通知渠道测试\n');

  /* ---------- 1. 各渠道用自己的 key ---------- */

  console.log('1) 每个渠道用自己的 key');
  const calls = [];
  {
    const { api } = loadScript({ silent: true, store: Object.assign({}, KEYS), xhr: recordingXhr(calls) });
    await api.sendNotify('酷狗签到成功 2026-10-09', '正文内容');

    const urls = calls.map((c) => c.url);
    check('发出了 5 个请求', urls.length, 5);
    check('企业微信用自己的 key', urls.some((u) => u.includes('qyapi.weixin.qq.com') && u.includes('wecom-key-AAA')), true);
    check('飞书用自己的 key', urls.some((u) => u.includes('open.feishu.cn') && u.includes('feishu-key-BBB')), true);
    check('Server酱用自己的 key', urls.some((u) => u.includes('sctapi.ftqq.com') && u.includes('serverchan-key-DDD')), true);
    check('Discord 用自己的 webhook', urls.some((u) => u.includes('discord.com/api/webhooks/EEE/FFF')), true);

    const pushplus = calls.find((c) => c.url.includes('pushplus.plus'));
    check('PushPlus 请求体里是自己 token', /pushplus-token-CCC/.test(pushplus.data), true);

    // 关键回归点：不能出现"所有渠道都用最后一个 key"的情况
    check(
      '没有渠道串用别人的 key',
      urls.filter((u) => u.includes('wecom-key-AAA') || u.includes('feishu-key-BBB') || u.includes('serverchan-key-DDD')).length,
      3
    );
  }

  /* ---------- 2. 标题与正文 ---------- */

  console.log('\n2) 标题与正文');
  {
    const wecom = calls.find((c) => c.url.includes('qyapi.weixin.qq.com'));
    const body = JSON.parse(wecom.data);
    check('文本渠道带上标题', body.text.content.includes('酷狗签到成功 2026-10-09'), true);
    check('文本渠道带上正文', body.text.content.includes('正文内容'), true);
    check('请求方法是 POST', wecom.method, 'POST');
  }

  /* ---------- 3. 单个渠道失败不影响其它 ---------- */

  console.log('\n3) 单个渠道失败不影响其它渠道');
  {
    const calls2 = [];
    const { api, logs } = loadScript({
      silent: true,
      store: Object.assign({}, KEYS),
      xhr: recordingXhr(calls2, 'qyapi.weixin.qq.com'),
    });
    await api.sendNotify('标题', '内容');
    check('仍然把所有渠道都试过', calls2.length, 5);
    check('日志里标记了失败渠道', logs.some((l) => /企业微信 发送失败/.test(l)), true);
    check('日志里标记了成功渠道', logs.some((l) => /飞书 发送成功/.test(l)), true);
  }

  /* ---------- 4. 云湖（开放接口 + token） ---------- */

  console.log('\n4) 云湖走开放接口');
  {
    const calls3 = [];
    const { api, logs } = loadScript({
      silent: true,
      store: Object.assign({}, KEYS, {
        '通知.YUNHU_BOT_TOKEN': 'yunhu-token-GGG',
        '通知.YUNHU_RECV_ID': '7058262',
        '通知.YUNHU_RECV_TYPE': 'user',
      }),
      xhr: recordingXhr(calls3),
    });
    await api.sendNotify('酷狗签到成功', '正文内容');

    const yunhu = calls3.find((c) => c.url.includes('chat-go.jwzhd.com'));
    check('云湖请求打到开放接口', !!yunhu, true);
    check('云湖 token 拼在 query 上', /token=yunhu-token-GGG/.test(yunhu.url), true);
    const body = JSON.parse(yunhu.data);
    check('云湖 recvId 正确', body.recvId, '7058262');
    check('云湖 recvType 正确', body.recvType, 'user');
    check('云湖 contentType 为 text', body.contentType, 'text');
    check('云湖正文带标题', body.content.text.includes('酷狗签到成功'), true);
    check('云湖正文带内容', body.content.text.includes('正文内容'), true);
    check('云湖发送成功', logs.some((l) => /云湖 发送成功/.test(l)), true);
  }

  /* ---------- 5. 云湖配了 token 但没填接收方 ---------- */

  console.log('\n5) 云湖缺接收方 ID');
  {
    const calls4 = [];
    const { api, logs } = loadScript({
      silent: true,
      store: Object.assign({}, KEYS, { '通知.YUNHU_BOT_TOKEN': 'yunhu-token-GGG' }),
      xhr: recordingXhr(calls4),
    });
    await api.sendNotify('标题', '内容');
    check('没有发出云湖请求', calls4.some((c) => c.url.includes('chat-go.jwzhd.com')), false);
    check('日志里给出缺 ID 提示', logs.some((l) => /云湖 发送失败.*未填写接收方 ID/.test(l)), true);
  }

  /* ---------- 6. 一个渠道都没配 ---------- */

  console.log('\n6) 一个渠道都没配');
  {
    const { api, logs } = loadScript({ silent: true, store: { '通知.KG_NOTIFY_SYSTEM': false } });
    await api.sendNotify('标题', '内容');
    check('提示没有配置渠道', logs.some((l) => /没有配置任何通知渠道/.test(l)), true);
  }

  /* ---------- 7. 云湖成功码语义（回归） ---------- */

  console.log('\n7) 云湖返回 code:1 视为成功');
  {
    // 真实接口成功时返回 {"code":1,"msg":"success"}；
    // 早期实现按「code !== 0 即失败」判断，导致成功也被记成失败。
    const yunhuOk = (calls5) =>
      function (options) {
        calls5.push({ url: options.url });
        setTimeout(() => {
          options.onload &&
            options.onload({
              status: 200,
              responseHeaders: 'content-type: application/json',
              responseText: JSON.stringify({ code: 1, data: { messageInfo: { msgId: 'abc' } }, msg: 'success' }),
            });
        }, 0);
      };

    const calls5 = [];
    const { api, logs } = loadScript({
      silent: true,
      store: Object.assign({}, KEYS, {
        '通知.YUNHU_BOT_TOKEN': 'yunhu-token-GGG',
        '通知.YUNHU_RECV_ID': '8142678',
        '通知.YUNHU_RECV_TYPE': 'user',
      }),
      xhr: yunhuOk(calls5),
    });
    await api.sendNotify('标题', '内容');
    check('code:1 判定为发送成功', logs.some((l) => /云湖 发送成功/.test(l)), true);
    check('不会误报失败', logs.some((l) => /云湖 发送失败/.test(l)), false);
  }

  console.log('\n8) 云湖真实失败码要报错');
  {
    const yunhuFail = (calls6) =>
      function (options) {
        calls6.push({ url: options.url });
        setTimeout(() => {
          options.onload &&
            options.onload({
              status: 200,
              responseHeaders: 'content-type: application/json',
              responseText: JSON.stringify({ code: 1001, msg: 'token 无效' }),
            });
        }, 0);
      };

    const calls6 = [];
    const { api, logs } = loadScript({
      silent: true,
      store: Object.assign({}, KEYS, {
        '通知.YUNHU_BOT_TOKEN': 'bad-token',
        '通知.YUNHU_RECV_ID': '8142678',
        '通知.YUNHU_RECV_TYPE': 'user',
      }),
      xhr: yunhuFail(calls6),
    });
    await api.sendNotify('标题', '内容');
    check('非成功码判定失败', logs.some((l) => /云湖 发送失败.*token 无效/.test(l)), true);
  }

  console.log(`\n通知渠道：${pass} 项通过，${fail} 项失败`);
  if (fail) process.exitCode = 1;
})().catch((e) => {
  console.error('测试异常：', (e && e.message) || e);
  process.exitCode = 1;
});
