"""Traditional Chinese (zh-TW) catalog tooling for the desktop app.

The zh-TW texts start as a conversion of the official Simplified Chinese (zh) catalogs and are then reviewed by hand.
When a merge from upstream adds strings to a zh catalog, the zh-TW file of that family has no text for them yet.
This script lists those keys, converts the zh text into a first draft and checks that nothing is missing. From app/host:

    python scripts/zh_tw_sync.py missing [out.json]      list every key that is in a zh file but not in its zh-TW file
    python scripts/zh_tw_sync.py apply [--all]           convert the missing keys (or, with --all, every key) from zh into
                                                         the zh-TW files, in zh key order; keys already reviewed are kept
    python scripts/zh_tw_sync.py check                   exit 1 if a zh-TW key is missing, extra, empty, out of order,
                                                         breaks a {0} / {name} placeholder or an HTML tag, or still has
                                                         a Simplified-only character

Options (any command): --src DIR reads the zh files from DIR, --out DIR reads and writes the zh-TW files in DIR
(both default to src/locales).

Needs OpenCC for the conversion (a development tool, not a dependency of the app):  pip install opencc-python-reimplemented
Convert a string from another script with:  from zh_tw_sync import convert
The conversion is s2twp (Taiwan wording) plus the overrides in WORDING, which follow the term list the translators use.
A draft still needs a read-through. Product names (Strata, Cloudflare, SSD, ID) stay as they are.
"""
import json
import re
import sys
from pathlib import Path

LOCALES = Path(__file__).resolve().parent.parent / "src" / "locales"
SLOT = re.compile(r"\{[A-Za-z0-9_]+\}")
TAG = re.compile(r"</?[A-Za-z][^>]*>")

# Applied after OpenCC s2twp: (pattern, replacement). s2twp already gives 載入 預設 檔案 記憶體 伺服器 搜尋 連結 登入
# 使用者 支援 介面 視窗 選單 最佳化 效能 快取 程式碼 資料 影片 軟體 硬碟 網路 金鑰 資訊 訊息 程式 字型.
WORDING = [
    (r"視訊記憶體", "顯示記憶體"),
    (r"終端(?!機)", "終端機"),
    (r"質量", "品質"),
    (r"(?<!連接)(?<!通訊)埠", "連接埠"),
    (r"推理", "推論"),
    (r"響應", "回應"),
    (r"高階", "進階"),
    (r"調優", "調校"),
    (r"解除安裝", "卸載"),
    (r"顯卡", "顯示卡"),
    (r"激活", "啟用"),
    (r"線程", "執行緒"),
    (r"兼容", "相容"),
    (r"對象", "物件"),
    (r"調用", "呼叫"),
    (r"屏幕", "螢幕"),
    (r"粘貼", "貼上"),
    (r"默認", "預設"),
    (r"項目", "專案"),
    (r"全屏", "全螢幕"),
    (r"賬", "帳"),
    (r"域名", "網域名稱"),
    (r"會話", "對話"),
    (r"級別", "等級"),
    (r"許可權", "權限"),
    (r"訪問", "存取"),
    (r"日誌", "記錄"),
    (r"個令牌", "個詞元"),
    (r"令牌", "權杖"),
    (r"倉庫", "儲存庫"),
    (r"構建", "建置"),
    (r"標籤頁|選項卡", "分頁"),
    (r"重置", "重設"),
    (r"重啟", "重新啟動"),
    (r"配置", "設定"),
    (r"示例", "範例"),
    (r"例項", "實例"),
    (r"驅動器", "磁碟機"),
    (r"驅動(?!程式)", "驅動程式"),
    (r"臺(?!灣)", "台"),
    (r"地址", "位址"),
    (r"列表", "清單"),
    (r"後臺|後台", "背景"),
    (r"實時", "即時"),
    (r"本地", "本機"),
    (r"版本號", "版本編號"),
    (r"嚮導", "精靈"),
    (r"隧道", "通道"),
    (r"區域網(?!路)", "區域網路"),
    (r"客戶端", "用戶端"),
    (r"協議", "協定"),
    (r"批處理", "批次處理"),
    (r"流式", "串流"),
    (r"模板", "範本"),
    (r"字號", "字型大小"),
    (r"禁用", "停用"),
    (r"滾動", "捲動"),
    (r"命令(?!列)", "指令"),
    (r"透過驗證", "通過驗證"),
    (r"是否透過", "是否通過"),
    (r"(未|均|已|曾|之前|一項之前)透過", r"通過"),
    (r"透過了", "通過了"),
    (r"透過(?=(?:Strata 的)?安全檢查)", "通過"),
    (r"退出", "結束"),
    (r"托盤", "系統匣"),
    (r"智慧體", "代理"),
    (r"包管理器", "套件管理員"),
    (r"任務管理器", "工作管理員"),
    (r"校驗", "驗證"),
    (r"計劃", "計畫"),
    (r"您", "你"),
    (r"下劃線", "底線"),
    (r"單個", "單一"),
    (r"高亮", "醒目提示"),
    (r"回車", " Enter "),
    (r" Enter (?=[，。；：？！」）]|$)", " Enter"),
    (r"^ Enter ", "Enter "),
    (r"主機名(?!稱)", "主機名稱"),
    (r"移動端", "行動裝置"),
    (r"複用", "重複使用"),
    (r"軟體包", "套件"),
    (r"控制元件", "控制項"),
    (r"自定義", "自訂"),
    (r"憑據", "憑證"),
    (r"獲取", "取得"),
    (r"估算", "估計"),
    (r"臨時", "暫時"),
    (r"係統", "系統"),
    (r"資料資料夾", "資料夾"),
    (r"聯結器", "連接器"),
    (r"後設資料", "中繼資料"),
    (r"當前", "目前"),
    (r"提供商", "供應商"),
    (r"釋出", "發布"),
    (r"應用(?=設定|並載入|你的|這些|你選擇)", "套用"),
    (r"(立即|儲存或|引數)應用(?!程式)", r"套用"),
    (r"應用(?=於)", "套用"),
    (r"應用(?!程式)", "應用程式"),
    (r"檔案資源管理器", "檔案總管"),
    (r"檔案管理器", "檔案管理員"),
    (r"引數", "參數"),
    (r"全域性", "全域"),
    (r"帖子", "貼文"),
    (r"反饋", "回饋"),
    (r"歸檔", "封存"),
    (r"指令碼", "腳本"),
    (r"解壓(?!縮)", "解壓縮"),
]

QUOTES = str.maketrans({"“": "「", "”": "」", "‘": "『", "’": "』"})
# half-width , ; : ? ! right after a Chinese character become full-width (the zh catalogs have a few such lines)
HALF_TO_FULL = {",": "，", ";": "；", ":": "：", "?": "？", "!": "！"}
_AFTER_CJK = re.compile("([一-鿿」』）])([,;:?!]) ?")


def fix_punct(text):
    return _AFTER_CJK.sub(lambda m: m.group(1) + HALF_TO_FULL[m.group(2)], text)


_converter = None


def convert(text):
    """Simplified -> Taiwan Traditional for one string. Placeholders, tags and ASCII are not touched by OpenCC."""
    global _converter
    if _converter is None:
        try:
            from opencc import OpenCC
        except ImportError:
            raise SystemExit("OpenCC is missing: pip install opencc-python-reimplemented")
        _converter = OpenCC("s2twp")
    out = _converter.convert(text)
    for pattern, repl in WORDING:
        out = re.sub(pattern, repl, out)
    # Taiwan quotes: “text” -> 「text」, ‘text’ -> 『text』
    return fix_punct(out.translate(QUOTES))


def family_pairs(src, out):
    """[(zh path, zh-TW path)] for every zh catalog: zh.json -> zh-TW.json, ui-zh.json -> ui-zh-TW.json."""
    pairs = []
    for path in sorted(src.glob("*zh.json")):
        pairs.append((path, out / (path.name[: -len("zh.json")] + "zh-TW.json")))
    return pairs


def load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def convert_value(value):
    if isinstance(value, dict):
        return {key: convert_value(inner) for key, inner in value.items()}
    if isinstance(value, str):
        return convert(value)
    return value


def strings(value):
    if isinstance(value, dict):
        for inner in value.values():
            yield from strings(inner)
    elif isinstance(value, str):
        yield value


def simplified_only(text):
    """Characters in the CJK block that Big5 (CP950, Traditional only) cannot encode."""
    bad = set()
    for ch in text:
        if "一" <= ch <= "鿿":
            try:
                ch.encode("cp950")
            except UnicodeEncodeError:
                bad.add(ch)
    return bad


def parse(argv):
    args, opts = [], {"src": LOCALES, "out": LOCALES, "all": False}
    it = iter(argv)
    for arg in it:
        if arg == "--src":
            opts["src"] = Path(next(it))
        elif arg == "--out":
            opts["out"] = Path(next(it))
        elif arg == "--all":
            opts["all"] = True
        else:
            args.append(arg)
    return args, opts


def cmd_missing(opts, target):
    report = {}
    for zh_path, tw_path in family_pairs(opts["src"], opts["out"]):
        zh, tw = load(zh_path), load(tw_path)
        gone = [key for key in zh if key not in tw]
        if gone:
            report[tw_path.name] = gone
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if target:
        Path(target).write_text(text + "\n", encoding="utf-8")
    print(text if not target else f"{sum(len(v) for v in report.values())} missing keys in {len(report)} files -> {target}")
    return 0


def cmd_apply(opts):
    for zh_path, tw_path in family_pairs(opts["src"], opts["out"]):
        zh, tw = load(zh_path), load(tw_path)
        merged = {}
        added = 0
        for key, value in zh.items():
            if key in tw and not opts["all"]:
                merged[key] = tw[key]
            else:
                merged[key] = convert_value(value)
                added += 1
        dump(tw_path, merged)
        print(f"{tw_path.name}: {added} converted, {len(merged)} keys")
    return 0


def cmd_check(opts):
    problems = []
    for zh_path, tw_path in family_pairs(opts["src"], opts["out"]):
        name = tw_path.name
        if not tw_path.exists():
            problems.append(f"{name}: file is missing")
            continue
        zh, tw = load(zh_path), load(tw_path)
        if list(zh) != list(tw):
            miss = [k for k in zh if k not in tw]
            extra = [k for k in tw if k not in zh]
            problems.append(f"{name}: keys differ (missing {len(miss)}, extra {len(extra)}" + ("" if miss or extra else ", same keys but the order differs") + ")")
        for key, zh_value in zh.items():
            if key not in tw:
                continue
            a, b = list(strings(zh_value)), list(strings(tw[key]))
            if len(a) != len(b):
                problems.append(f"{name}:{key}: plural forms differ")
                continue
            for zs, ts in zip(a, b):
                if zs.strip() and not ts.strip():
                    problems.append(f"{name}:{key}: empty")
                if sorted(SLOT.findall(zs)) != sorted(SLOT.findall(ts)):
                    problems.append(f"{name}:{key}: placeholders differ")
                if sorted(TAG.findall(zs)) != sorted(TAG.findall(ts)):
                    problems.append(f"{name}:{key}: tags differ")
                bad = simplified_only(ts)
                if bad:
                    problems.append(f"{name}:{key}: Simplified-only characters {''.join(sorted(bad))}")
    for line in problems[:200]:
        print(line)
    print(f"{len(problems)} problems" if problems else "zh-TW catalogs are complete")
    return 1 if problems else 0


def main(argv):
    args, opts = parse(argv)
    if not args or args[0] not in ("missing", "apply", "check"):
        print(__doc__)
        return 2
    if args[0] == "missing":
        return cmd_missing(opts, args[1] if len(args) > 1 else None)
    if args[0] == "apply":
        return cmd_apply(opts)
    return cmd_check(opts)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
