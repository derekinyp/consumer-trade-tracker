#!/usr/bin/env python3
"""美國民眾經濟消費 + HS 3924 追蹤：抓取 → 計算 → 輸出 data/dashboard.json。
用法：
  python3 update.py              # 重抓 FRED 與 UN Comtrade，重算
  python3 update.py --offline    # 只用 data/raw 快取重算
  python3 update.py --verdict    # 另以 codex exec（ChatGPT 訂閱）重產 data/verdict.json
不使用任何 API 金鑰；不內插、不補值。
"""
import csv, io, json, os, re, subprocess, sys, time, statistics, urllib.request
from datetime import date, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "data", "raw")
OFFLINE = "--offline" in sys.argv
TODAY = date.today()

# (id, 名稱, 頻率 M/Q/A, 單位, 看法 yoy/level, 模組, 口徑標籤)
FRED = [
 ("DSPIC96","實質可支配個人所得","M","十億美元（2017 連鎖）","yoy","所得與緩衝","稅後｜含政府補助｜已扣通膨｜不含資本利得"),
 ("PSAVERT","個人儲蓄率","M","%（季調）","level","所得與緩衝","低於 5% 代表家庭財務緩衝偏薄"),
 ("MEHOINUSA672N","實質家庭中位數所得","A","美元（已扣通膨）","level","所得與緩衝","稅前｜僅含現金補助｜已扣通膨｜每年 9 月更新"),
 ("WFRBST01134","頂層 1% 淨財富佔比","Q","%","level","財富與警訊","每季｜淨財富＝資產－負債｜名目佔比"),
 ("WFRBSB50215","底層 50% 淨財富佔比","Q","%","level","財富與警訊","每季｜淨財富＝資產－負債｜名目佔比"),
 ("DRCCLACBS","商業銀行信用卡違約率","Q","%（季調）","level","財富與警訊","逾期 30 天以上｜底層壓力領先指標"),
 ("PCEPI","整體 PCE 物價指數","M","指數","yoy","通膨體感","聯準會基準"),
 ("PCEPILFE","核心 PCE 物價指數","M","指數","yoy","通膨體感","剔除食品與能源"),
 ("CUSR0000SAH1","CPI 居住類","M","指數","yoy","通膨體感","房租等剛性居住成本"),
 ("PCEDGC96","實質耐久財消費","M","十億美元（2017 連鎖）","yoy","消費轉向","已扣通膨｜汽車、家電、家具"),
 ("PCENDC96","實質非耐久財消費","M","十億美元（2017 連鎖）","yoy","消費轉向","已扣通膨｜食品、汽油、日用品"),
 ("PCESC96","實質服務消費","M","十億美元（2017 連鎖）","yoy","消費轉向","已扣通膨｜醫療、餐旅、金融"),
 ("DFSARX1Q020SBEA","實質餐飲與住宿服務","Q","十億美元（2017 連鎖）","yoy","消費轉向","已扣通膨｜體驗經濟溫度計"),
 ("RSGCS","雜貨超市零售額","M","百萬美元（名目、季調）","yoy","消費轉向","名目｜在家自煮支出"),
 ("MRTSSM722USS","餐飲與飲酒場所零售額","M","百萬美元（名目、季調）","yoy","消費轉向","名目｜外食消費"),
 ("MRTSSM452USS","綜合百貨／大賣場零售額","M","百萬美元（名目、季調）","yoy","消費轉向","名目｜高性價比通路"),
 ("ECOMPCTSA","電商佔總零售比例","Q","%（季調）","level","消費轉向","線上通路滲透率"),
 ("DUTERX1A020NBEA","餐廚與玻璃器皿：實質消費量","A","十億美元（2017 連鎖）","level","餐廚容器總盤","已扣通膨｜真實需求量"),
 ("DUTERG3A086NBEA","餐廚與玻璃器皿：物價指數","A","指數（2017=100）","level","餐廚容器總盤","品類價格戰溫度計"),
 # 僅供交接文件數字查核，不上主圖
 ("CPIAUCSL","CPI 整體","M","指數","yoy","查核用","查核用"),
 ("CPILFESL","CPI 核心","M","指數","yoy","查核用","查核用"),
]
HS = [("392410","塑膠製餐具及廚房用具（HS 3924.10）","塑膠"),
      ("701349","餐廚用玻璃器皿（HS 7013.49）","玻璃"),
      ("732393","不鏽鋼餐廚與家用品（HS 7323.93）","不鏽鋼")]

def get(url, tries=3):
    """以 curl 抓取（FRED 會擋部分 User-Agent）。回傳 (HTTP 狀態碼, 內容)。"""
    for i in range(tries):
        try:
            p = subprocess.run(["curl", "-s", "-m", "60", "-w", "\n%{http_code}", url], capture_output=True, text=True, timeout=90)
            body, _, code = p.stdout.rpartition("\n")
            code = int(code) if code.isdigit() else None
            if code == 200: return 200, body
            if code in (400, 404): return code, ""
        except Exception:
            pass
        time.sleep(3 * (i + 1))
    return code if 'code' in dir() else None, ""

def add_years(d, n):
    try: return d.replace(year=d.year + n)
    except ValueError: return d.replace(year=d.year + n, day=28)

def step(d, f):
    m = {"M": 1, "Q": 3, "A": 12}[f]
    y, mo = divmod(d.month - 1 + m, 12)
    return date(d.year + y, mo + 1, 1)

# ---------- FRED ----------
def fetch_fred():
    os.makedirs(os.path.join(RAW, "fred"), exist_ok=True)
    status = {}
    for sid, *_ in FRED:
        path = os.path.join(RAW, "fred", sid + ".csv")
        if not OFFLINE:
            code, txt = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}")
            if code == 200 and txt.count("\n") > 2:
                open(path, "w").write(txt); status[sid] = "ok"
            else:
                status[sid] = f"失敗（HTTP {code}）" + ("，沿用快取" if os.path.exists(path) else "")
        else:
            status[sid] = "ok（快取）" if os.path.exists(path) else "無快取"
    return status

def read_fred(sid):
    path = os.path.join(RAW, "fred", sid + ".csv")
    if not os.path.exists(path): return {}
    out = {}
    rows = list(csv.reader(io.StringIO(open(path).read())))
    for r in rows[1:]:
        if len(r) < 2: continue
        try: d = datetime.strptime(r[0], "%Y-%m-%d").date()
        except ValueError: continue
        try: out[d] = float(r[1])
        except ValueError: out[d] = None  # '.' = 官方無發布
    return out

# ---------- UN Comtrade（公開預覽端點，免金鑰；美國申報之進口） ----------
def fetch_hs():
    path = os.path.join(RAW, "comtrade_us_imports_monthly.json")
    cache = json.load(open(path)) if os.path.exists(path) else {}
    log = {"calls": 0, "errors": []}
    if not OFFLINE:
        start = date(TODAY.year - 6, TODAY.month, 1)
        d = start
        last = date(TODAY.year, TODAY.month, 1)
        recent = add_years(last, -1)
        while d < last:
            p = d.strftime("%Y%m")
            if p not in cache or d >= recent:  # 近 12 個月每次重抓（官方會修正）
                url = ("https://comtradeapi.un.org/public/v1/preview/C/M/HS?reporterCode=842&period=%s"
                       "&partnerCode=0&cmdCode=392410,701349,732393&flowCode=M" % p)
                code, txt = get(url); log["calls"] += 1
                if code == 200:
                    try:
                        rows = json.loads(txt).get("data", [])
                        vals = {}
                        for r in rows:
                            if r.get("partnerCode") == 0 and r.get("partner2Code") == 0 and r.get("customsCode") == "C00" and r.get("motCode") == 0:
                                vals[r["cmdCode"]] = r["primaryValue"]
                        if vals: cache[p] = vals
                    except Exception as e:
                        log["errors"].append(f"{p}: {e}")
                else:
                    log["errors"].append(f"{p}: HTTP {code}")
                time.sleep(1.0)
                if log['calls'] % 12 == 0:
                    json.dump(cache, open(path, 'w'), sort_keys=True); print('HS', p, flush=True)
            d = step(d, "M")
        json.dump(cache, open(path, "w"), indent=0, sort_keys=True)
    return cache, log

# ---------- 計算 ----------
def full_index(obs, f, start):
    if not obs: return []
    end = max(obs)
    d = min(x for x in obs if x >= start) if any(x >= start for x in obs) else end
    idx = []
    while d <= end:
        idx.append(d); d = step(d, f)
    return idx

def pct_stats(vals, latest):
    v = [x for x in vals if x is not None]
    if not v or latest is None: return None
    return {"percentile": round(100 * sum(1 for x in v if x <= latest) / len(v), 1),
            "min": round(min(v), 3), "median": round(statistics.median(v), 3), "max": round(max(v), 3), "n": len(v)}

def r(x, n=3): return None if x is None else round(x, n)

def build():
    fred_status = fetch_fred()
    ten = add_years(date(TODAY.year, TODAY.month, 1), -10)
    series = {}
    for sid, name, f, unit, view, group, label in FRED:
        obs = read_fred(sid)
        if not obs:
            series[sid] = {"id": sid, "name": name, "ok": False, "status": fred_status.get(sid)}; continue
        idx = full_index(obs, f, ten)
        vals = [obs.get(d) for d in idx]
        yoy = []
        for d, v in zip(idx, vals):
            b = obs.get(add_years(d, -1))
            yoy.append(r((v / b - 1) * 100) if (v is not None and b not in (None, 0)) else None)
        li = max((i for i, v in enumerate(vals) if v is not None), default=None)
        missing = [d.isoformat()[:7] for d, v in zip(idx, vals) if v is None]
        s = {"id": sid, "name": name, "freq": f, "unit": unit, "view": view, "group": group, "label": label,
             "ok": True, "status": fred_status.get(sid),
             "dates": [d.isoformat()[:7] if f != "A" else str(d.year) for d in idx],
             "values": [r(v, 4) for v in vals], "yoy": yoy, "missing": missing,
             "latest_date": idx[li].isoformat() if li is not None else None,
             "latest": r(vals[li], 4) if li is not None else None,
             "latest_yoy": yoy[li] if li is not None else None}
        s["stats_level"] = pct_stats(vals, s["latest"])
        s["stats_yoy"] = pct_stats(yoy, s["latest_yoy"]) if view == "yoy" else None
        series[sid] = s

    # 衍生：外食÷超市比、耐久−非耐久 YoY 差
    def by_date(sid, key="values"):
        s = series.get(sid, {})
        return dict(zip(s.get("dates", []), s.get(key, [])))
    din, gro = by_date("MRTSSM722USS"), by_date("RSGCS")
    dd = sorted(set(din) | set(gro))
    ratio = [r(din[d] / gro[d], 4) if din.get(d) is not None and gro.get(d) not in (None, 0) else None for d in dd]
    dg, nd = by_date("PCEDGC96", "yoy"), by_date("PCENDC96", "yoy")
    sd = sorted(set(dg) | set(nd))
    spread = [r(dg[d] - nd[d]) if dg.get(d) is not None and nd.get(d) is not None else None for d in sd]

    # HS 12 個月滾動份額
    cache, hslog = fetch_hs()
    months = []
    if cache:
        d = datetime.strptime(min(cache), "%Y%m").date(); end = datetime.strptime(max(cache), "%Y%m").date()
        while d <= end: months.append(d); d = step(d, "M")
    raw = {c: [cache.get(m.strftime("%Y%m"), {}).get(c) for m in months] for c, _, _ in HS}
    roll = {c: [] for c, _, _ in HS}
    for i in range(len(months)):
        for c in roll:
            w = raw[c][i - 11:i + 1] if i >= 11 else []
            roll[c].append(sum(w) if len(w) == 12 and all(x is not None for x in w) else None)
    share = {c: [] for c in roll}
    for i in range(len(months)):
        tot = [roll[c][i] for c in roll]
        ok = all(x is not None for x in tot) and sum(tot) > 0
        for c in roll: share[c].append(r(roll[c][i] / sum(tot) * 100) if ok else None)
    hsd = [m.isoformat()[:7] for m in months]
    five = add_years(date(TODAY.year, TODAY.month, 1), -5).isoformat()[:7]
    k0 = next((i for i, x in enumerate(hsd) if x >= five), 0)
    hs = {"source": "UN Comtrade 公開預覽端點（reporter=美國 842，flow=進口，partner=全球），美國申報資料",
          "dates": hsd[k0:], "items": []}
    for c, name, mat in HS:
        sv = share[c][k0:]; rv = roll[c][k0:]
        li = max((i for i, v in enumerate(sv) if v is not None), default=None)
        fi = next((i for i, v in enumerate(sv) if v is not None), None)
        hs["items"].append({"code": c, "name": name, "material": mat,
            "monthly": [r(x / 1e6, 2) if x is not None else None for x in raw[c][k0:]],
            "rolling12_musd": [r(x / 1e6, 1) if x is not None else None for x in rv],
            "share": sv,
            "first_share": {"date": hs["dates"][fi], "value": sv[fi]} if fi is not None else None,
            "latest_share": {"date": hs["dates"][li], "value": sv[li]} if li is not None else None,
            "missing_months": [hsd[k0 + i] for i, x in enumerate(raw[c][k0:]) if x is None]})
    hs["hs10_3924104000"] = "未取得：Census API 現須金鑰（依規定不申請）；UN Comtrade 僅到 HS6。"
    hs["log"] = hslog

    def lastnn(dates, vals):
        for d, v in zip(reversed(dates), reversed(vals)):
            if v is not None: return {"date": d, "value": v}
        return None
    def firstnn(dates, vals, since):
        for d, v in zip(dates, vals):
            if v is not None and d >= since: return {"date": d, "value": v}
        return None
    tenp = ten.isoformat()[:7]
    derived = {
        "dining_grocery_ratio": {"dates": dd, "values": ratio, "latest": lastnn(dd, ratio),
                                 "first_10y": firstnn(dd, ratio, tenp), "stats": pct_stats([v for d, v in zip(dd, ratio) if d >= tenp], (lastnn(dd, ratio) or {}).get("value"))},
        "durable_minus_nondurable_yoy": {"dates": sd, "values": spread, "latest": lastnn(sd, spread),
                                 "first_10y": firstnn(sd, spread, tenp), "stats": pct_stats([v for d, v in zip(sd, spread) if d >= tenp], (lastnn(sd, spread) or {}).get("value"))},
    }
    out = {"generated": datetime.now().strftime("%Y-%m-%d %H:%M"), "tz": "Asia/Taipei",
           "series": series, "derived": derived, "hs": hs, "checks": spec_checks(series, cache)}
    json.dump(out, open(os.path.join(ROOT, "data", "dashboard.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    summ = summary(out)
    json.dump(summ, open(os.path.join(ROOT, "data", "summary.json"), "w"), ensure_ascii=False, indent=1)
    return out, summ

def val(series, sid, d, key="values"):
    s = series.get(sid, {})
    if not s.get("ok"): return None
    m = dict(zip(s["dates"], s[key]))
    return m.get(d)

def spec_checks(series, cache):
    """交接文件的 2026 基準數字 vs 官方重算。"""
    rows = []
    def add(claim, sid, d, key, spec, nd=1, unit=""):
        v = val(series, sid, d, key)
        if v is None:
            res, shown = "無法驗證（官方無此期數據）", "—"
        else:
            shown = f"{round(v, nd)}{unit}"
            res = "相符" if abs(round(v, nd) - spec) < (0.051 if nd == 1 else 0.0051 if nd == 2 else 0.6) else "不符"
        rows.append({"claim": claim, "series": sid, "period": d, "spec": f"{spec}{unit}", "official": shown, "result": res})
    add("個人儲蓄率 2026-10", "PSAVERT", "2026-10", "values", 4.1, 1, "%")
    add("個人儲蓄率 2026-09", "PSAVERT", "2026-09", "values", 3.9, 1, "%")
    add("個人儲蓄率 2026-07", "PSAVERT", "2026-07", "values", 4.4, 1, "%")
    s1 = series.get("WFRBST01134", {}); 
    add("頂層 1% 淨財富佔比 2026 Q2", "WFRBST01134", "2026-04", "values", 32.5, 1, "%")
    add("底層 50% 淨財富佔比 2026 Q2（文件稱 <3%）", "WFRBSB50215", "2026-04", "values", 3.0, 1, "%")
    rows[-1]["result"] = ("相符（<3%）" if (val(series, "WFRBSB50215", "2026-04") or 99) < 3 else "不符（≥3%）") if val(series, "WFRBSB50215", "2026-04") is not None else rows[-1]["result"]
    rows[-1]["spec"] = "<3%"
    add("CPI 年增率 2026-09", "CPIAUCSL", "2026-09", "yoy", 3.72, 2, "%")
    add("核心 CPI 年增率 2026-09", "CPILFESL", "2026-09", "yoy", 2.57, 2, "%")
    v = val(series, "CPIAUCSL", "2026-10", "yoy"); b = val(series, "CPIAUCSL", "2025-10")
    rows.append({"claim": "2026-10 CPI 年增率官方未發布（因 2025-10 缺樣本）", "series": "CPIAUCSL", "period": "2026-10",
                 "spec": "無 YoY", "official": f"2025-10 指數={'缺' if b is None else b}；2026-10 YoY={'無' if v is None else v}",
                 "result": "相符" if v is None and b is None else ("不符" if b is not None else "部分相符（2025-10 缺，但 2026-10 尚未出現）")})
    add("餐廚器皿實質消費 2021", "DUTERX1A020NBEA", "2021", "values", 55.77, 2, "")
    add("餐廚器皿實質消費 2025", "DUTERX1A020NBEA", "2025", "values", 71.25, 2, "")
    add("餐廚器皿物價指數 2022 高點", "DUTERG3A086NBEA", "2022", "values", 96.30, 2, "")
    add("餐廚器皿物價指數 2025", "DUTERG3A086NBEA", "2025", "values", 86.41, 2, "")
    # 美國 HS 392410 進口（Comtrade，年度加總需 12 個月齊全）
    for y in (2022, 2025):
        m = [cache.get(f"{y}{mm:02d}", {}).get("392410") for mm in range(1, 13)]
        tot = sum(m) / 1e6 if all(x is not None for x in m) else None
        rows.append({"claim": f"（參考）美國 HS 392410 年進口 {y}", "series": "Comtrade 842", "period": str(y), "spec": "文件未給",
                     "official": f"{tot:,.1f} 百萬美元" if tot else "月份不齊", "result": "僅供參考"})
    for c in ["中國 HS 3924.10 全球出口 2022 101 億→2025 89 億美元（−11.9%）",
              "美國第 39 章總進口 2022 898.8 億→2025 740.2 億美元（−17.6%）"]:
        rows.append({"claim": c, "series": "—", "period": "—", "spec": "見文件", "official": "未查（不在本站資料範圍）", "result": "無法驗證"})
    rows.append({"claim": "BoA 刷卡年增：低收入 +5.9% vs 頂層 5% +5.7%", "series": "—", "period": "2026-10", "spec": "見文件",
                 "official": "非官方 API 資料", "result": "無法驗證"})
    return rows

def summary(out):
    """給 LLM 的精簡輸入：最新值、10 年分位數、衍生訊號首尾。"""
    S = {}
    for sid, s in out["series"].items():
        if not s.get("ok") or s["group"] == "查核用": continue
        S[sid] = {"name": s["name"], "label": s["label"], "unit": s["unit"], "latest_date": s["latest_date"][:7] if s["freq"] != "A" else s["latest_date"][:4],
                  "latest_value": s["latest"],
                  "latest_yoy_pct": s["latest_yoy"] if (s["view"] == "yoy" or not s["unit"].startswith("%")) else "不適用（比率類看原值）",
                  "last_valid_yoy": next(({"date": d, "yoy_pct": y} for d, y in zip(reversed(s["dates"]), reversed(s["yoy"])) if y is not None), None) if s["view"] == "yoy" else None,
                  "level_10y": s["stats_level"], "yoy_10y": s["stats_yoy"],
                  "missing_in_10y": s["missing"][-6:]}
    hs = out["hs"]
    return {"generated": out["generated"], "indicators": S,
            "derived": {k: {"first_10y": v["first_10y"], "latest": v["latest"], "stats_10y": v["stats"]} for k, v in out["derived"].items()},
            "hs_import_share_12m_rolling_pct": {i["code"]: {"material": i["material"], "first": i["first_share"], "latest": i["latest_share"]} for i in hs["items"]},
            "hs_notes": ["海關進口不含美國本土射出廠內銷", "HS 歸類混有非容器類廚具", "名目美元", hs["hs10_3924104000"]],
            "percentile_definition": "10 年有效值中 ≤ 最新值的比例（%）"}

# ---------- AI 判讀 ----------
SYS = """你是嚴謹的總體經濟分析師。以下 JSON 是本期美國官方數據摘要。請以台灣繁體中文輸出判讀，只輸出一個 JSON 物件，不要任何其他文字或 markdown。
鐵律：
1. 只准引用輸入 JSON 中真實存在的數字與日期，數字照抄（可四捨五入到一位小數）；指標為 null 或缺漏時寫「官方尚未發布或無數據」，嚴禁推算或編造。
2. 四維交叉：(a) 實質可支配所得 vs 儲蓄率 (b) 核心 PCE vs 居住 CPI (c) 耐久／非耐久／服務消費與外食超市比 (d) 頂層 1% vs 底層 50% 淨財富與信用卡違約率。cards 正好 4 張，依此順序。
3. 提到 DSPIC96 時註明「稅後、含政府補助、已扣通膨、不含資本利得」；提到 MEHOINUSA672N 時註明「稅前、僅含現金補助」。
4. 關鍵指標對照 10 年分位數；HS 3924 判讀須註明海關進口數據不含美國本土射出廠內銷。
5. 不得引用輸入以外的外部數字（如 BoA、Temu、Comtrade 以外的金額）。
Schema：{"headline":"≤45字","executive_summary":"≤200字","cards":[{"title":"","status":"正向|中性警戒|壓力升溫","analysis":""}],"hs3924_verdict":{"summary":"","strategic_implication":""},"methodology_notes":[""]}
輸入 JSON：
"""

def allowed_numbers(obj, acc=None):
    acc = set() if acc is None else acc
    if isinstance(obj, dict):
        for v in obj.values(): allowed_numbers(v, acc)
    elif isinstance(obj, list):
        for v in obj: allowed_numbers(v, acc)
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        for n in (0, 1, 2, 3, 4):
            acc.add(round(float(obj), n)); acc.add(round(abs(float(obj)), n))
    elif isinstance(obj, str):
        for m in re.findall(r"\d+(?:\.\d+)?", obj): acc.add(float(m))
    return acc

STRUCT = {1, 3, 4, 5, 6, 9, 10, 12, 50, 100, 2017, 3924, 7013, 7323, 392410, 701349, 732393, 96, 1, 0}

def validate(verdict, summ):
    ok = allowed_numbers(summ) | {float(x) for x in STRUCT}
    flags = []
    def clean(text, where):
        sents = re.split(r"(?<=[。；！？])", text)
        keep = []
        for s in sents:
            s2 = re.sub(r"(?<![A-Za-z0-9])[A-Z][A-Z0-9]*\d[A-Z0-9]*(?![A-Za-z0-9])", " ", s)  # 去掉序列代碼（如 MEHOINUSA672N）
            nums = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*(?:\.\d+)?", s2)]
            bad = [n for n in nums if n not in ok]
            if bad: flags.append({"where": where, "dropped": s.strip(), "unverified_numbers": bad})
            else: keep.append(s)
        return "".join(keep).strip()
    v = verdict
    for k in ("headline", "executive_summary"): v[k] = clean(v.get(k, ""), k)
    for i, c in enumerate(v.get("cards", [])):
        c["analysis"] = clean(c.get("analysis", ""), f"cards[{i}]")
        if c.get("status") not in ("正向", "中性警戒", "壓力升溫"): flags.append({"where": f"cards[{i}].status", "dropped": c.get("status")}); c["status"] = "中性警戒"
    h = v.get("hs3924_verdict", {})
    for k in ("summary", "strategic_implication"): h[k] = clean(h.get(k, ""), "hs3924_verdict." + k)
    v["methodology_notes"] = [clean(x, "methodology_notes") for x in v.get("methodology_notes", [])]
    v["methodology_notes"] = [x for x in v["methodology_notes"] if x]
    return v, flags

def run_verdict(summ, call=True):
    env = dict(os.environ, PATH="/home/box/.local/bin:" + os.environ.get("PATH", ""))
    outp = os.path.join(ROOT, "data", "verdict_raw.txt")
    prompt = SYS + json.dumps(summ, ensure_ascii=False)
    if call: subprocess.run(["codex", "exec", "--skip-git-repo-check", "-s", "read-only", "-c", 'approval_policy="never"',
                    "-o", outp, prompt], stdin=subprocess.DEVNULL, env=env, cwd="/tmp", timeout=900,
                   stdout=open(os.path.join(ROOT, "data", "verdict_stdout.log"), "w"), stderr=subprocess.STDOUT)
    txt = open(outp).read()
    m = re.search(r"\{.*\}", txt, re.S)
    verdict = json.loads(m.group(0))
    verdict, flags = validate(verdict, summ)
    verdict["_meta"] = {"generated": datetime.now().strftime("%Y-%m-%d %H:%M"), "tz": "Asia/Taipei",
                        "engine": "codex exec（ChatGPT 訂閱，預設模型）", "input": "data/summary.json @ " + summ["generated"],
                        "validation_flags": flags}
    json.dump(verdict, open(os.path.join(ROOT, "data", "verdict.json"), "w"), ensure_ascii=False, indent=1)
    return verdict

if __name__ == "__main__":
    out, summ = build()
    bad = [k for k, s in out["series"].items() if not s.get("ok")]
    print("series ok:", len(out["series"]) - len(bad), "failed:", bad)
    print("HS months:", out["hs"]["dates"][:1], "→", out["hs"]["dates"][-1:], "log:", out["hs"]["log"])
    if "--verdict" in sys.argv or "--revalidate" in sys.argv:
        v = run_verdict(summ, call="--verdict" in sys.argv); print("verdict:", v.get("headline"), "flags:", len(v["_meta"]["validation_flags"]))
