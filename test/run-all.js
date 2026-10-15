/**
 * 跑全部离线测试（不需要联网、不需要 npm、不需要 Python）
 *
 *   node test/run-all.js
 *
 * 需要联网的两个测试单独跑：
 *   node test/live.test.js    真实接口联调
 *   node test/sign.test.js    签到主流程（会去调酷狗的账号接口）
 */

require('./crypto.test.js');
console.log('');
require('./qr.test.js');
console.log('');
require('./userconfig.test.js');
console.log('');
require('./schedule.test.js');
console.log('');
require('./notify.test.js');
console.log('');
require('./gm.test.js');
console.log('');
require('./login.test.js');
