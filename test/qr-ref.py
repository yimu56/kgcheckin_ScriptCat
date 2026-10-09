"""二维码参考数据生成器（仅测试用）

用 Python 的 qrcode 库生成参考数据。它严格按 ISO/IEC 18004 计算掩码罚分，
而 npm 的 qrcode 包用的是旧版罚分算法，两者选出的掩码可能不同 ——
所以两个都拿来当参考，互相印证。

用法（stdin 一个 JSON，stdout 一个 JSON）：
    {"texts": ["...", "..."]}

输出：
    {"cases": [{"text","version","autoMask","autoMatrix","lostPoints"}]}
"""

import json
import sys

import qrcode
import qrcode.util


def build(text, version=None, mask=None, fit=False):
    q = qrcode.QRCode(
        version=version,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=1,
        border=0,
        mask_pattern=mask,
    )
    q.add_data(qrcode.util.QRData(text, qrcode.util.MODE_8BIT_BYTE))
    q.make(fit=fit)
    return q


def main():
    req = json.load(sys.stdin)
    cases = []
    for text in req["texts"]:
        auto = build(text, fit=True)
        version = auto.version
        # 注意：best_mask_pattern() 内部会反复调用 makeImpl(True, i) ，
        # 跑完之后 auto.modules 停在"测试态"，所以必须重新用选中的掩码构建一次，
        # 否则拿到的矩阵是坏的。
        auto_mask = auto.best_mask_pattern()
        final = build(text, version=version, mask=auto_mask)

        matrices = []
        for mask in range(8):
            forced = build(text, version=version, mask=mask)
            matrices.append([[bool(c) for c in row] for row in forced.modules])

        cases.append(
            {
                "text": text,
                "version": version,
                "autoMask": auto_mask,
                "autoMatrix": [[bool(c) for c in row] for row in final.modules],
                "lostPoints": [qrcode.util.lost_point(m) for m in matrices],
            }
        )

    json.dump({"cases": cases}, sys.stdout)


main()
