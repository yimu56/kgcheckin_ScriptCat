/**
 * UserConfig 语法测试（离线）
 *
 * 背景：==UserConfig== 区块是用 YAML 解析的。曾经在「账号」组之后写了
 * 一个 `---` 分隔行，YAML 会把它当成"新文档开始"，导致单文档解析直接抛
 * "expected a single document in the stream, but found more"，
 * 于是「登录 / 签到 / 通知」全部读不出来，配置面板里也就没有云湖等输入框。
 *
 * 这里用一个极简的 YAML 子集解析器把每个分组、每个配置项列出来，
 * 保证：分组只有一个文档、四个分组都在、通知组里的每个键都能被脚本读到。
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'kgcheckin.user.js');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  }
}

const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
const m = src.match(/\/\* ==UserConfig==([\s\S]*?)==\/UserConfig== \*\//);
if (!m) {
  console.error('找不到 ==UserConfig== 区块');
  process.exit(1);
}
const body = m[1];

console.log('UserConfig 语法测试\n');

/* ---------- 1. 不能出现文档分隔符 ---------- */

console.log('1) 不能有 YAML 文档分隔符');
const separators = body.split(/\r?\n/).filter((l) => /^\s*---\s*(#.*)?$/.test(l));
check('没有独立的 --- 行', separators.length, 0);

/* ---------- 2. 顶层分组与配置项 ---------- */

console.log('\n2) 分组与配置项');

/** 解析这个受控子集：顶层 `组:`，二级 `  KEY:`，三级 `    attr: value` */
function parseGroups(text) {
  const groups = {};
  let group = null;
  let key = null;
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim() || /^\s*#/.test(line)) return;
    const top = line.match(/^(\S[^:]*):\s*$/);
    const second = line.match(/^ {2}(\S[^:]*):\s*$/);
    if (top) {
      group = top[1].trim();
      groups[group] = {};
      key = null;
      return;
    }
    if (second && group) {
      key = second[1].trim();
      groups[group][key] = {};
      return;
    }
  });
  return groups;
}

const groups = parseGroups(body);
check('顶层分组', Object.keys(groups), ['账号', '登录', '签到', '通知']);

// 脚本里 DEFAULT_CONFIG 用到的每个 key 都必须在 UserConfig 里出现，否则面板无处可填
const DEFAULT_CONFIG = {
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
  '通知.YUNHU_BOT_TOKEN': '',
  '通知.YUNHU_RECV_ID': '',
  '通知.YUNHU_RECV_TYPE': 'user',
  '通知.SERVERCHAN_SENDKEY': '',
  '通知.PUSHPLUS_TOKEN': '',
  '通知.PUSHPLUS_TOPIC': '',
  '通知.TG_BOT_TOKEN': '',
  '通知.TG_CHAT_ID': '',
  '通知.BARK_KEY': '',
  '通知.BARK_GROUP': '',
  '通知.DISCORD_WEBHOOK': '',
};

const declared = [];
Object.keys(groups).forEach((g) => Object.keys(groups[g]).forEach((k) => declared.push(g + '.' + k)));

const missing = Object.keys(DEFAULT_CONFIG).filter((k) => declared.indexOf(k) === -1);
check('DEFAULT_CONFIG 里的 key 在面板里都有入口', missing, []);

const extra = declared.filter((k) => !(k in DEFAULT_CONFIG));
check('面板里没有多余的孤儿配置项', extra, []);

/* ---------- 3. 通知组里的云湖键 ---------- */

console.log('\n3) 云湖配置项');
check('通知组包含 YUNHU_BOT_TOKEN', 'YUNHU_BOT_TOKEN' in groups['通知'], true);
check('通知组包含 YUNHU_RECV_ID', 'YUNHU_RECV_ID' in groups['通知'], true);
check('通知组包含 YUNHU_RECV_TYPE', 'YUNHU_RECV_TYPE' in groups['通知'], true);

/* ---------- 4. 属性完整 ---------- */

console.log('\n4) 每项都有 title 与 type');
const attrs = body.split(/\r?\n/);
let badTitles = [];
let current = null;
let hasTitle = false;
let hasType = false;
let currentGroup = null;
attrs.forEach((line) => {
  const top = line.match(/^(\S[^:]*):\s*$/);
  const second = line.match(/^ {2}(\S[^:]*):\s*$/);
  if (top) { currentGroup = top[1].trim(); }
  if (second) {
    if (currentGroup === '通知' && current && (!hasTitle || !hasType)) badTitles.push(current);
    current = second[1].trim();
    hasTitle = false;
    hasType = false;
    return;
  }
  if (/^ {4}title:/.test(line)) hasTitle = true;
  if (/^ {4}type:/.test(line)) hasType = true;
});
if (currentGroup === '通知' && current && (!hasTitle || !hasType)) badTitles.push(current);
check('通知组每项都有 title 和 type', badTitles, []);

console.log(`\nUserConfig：${pass} 项通过，${fail} 项失败`);
if (fail) process.exitCode = 1;
