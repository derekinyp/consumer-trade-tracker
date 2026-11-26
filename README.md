# 美國民眾經濟消費 × HS 3924 追蹤（靜態網站）

- `index.html`＋`assets/`：前端（Chart.js 本地版，`spanGaps:false`）。
- `update.py`：重抓 FRED 公開 CSV 與 UN Comtrade 公開預覽端點 → `data/dashboard.json`、`data/summary.json`。
  - `--offline` 只用快取；`--verdict` 另用 codex exec（ChatGPT 訂閱）產生 `data/verdict.json`，並逐一比對數字。
- 不使用任何 API 金鑰、不內插、不補值。
- `.github/workflows/refresh-data.yml`：只刷新資料，不跑 LLM。
- 本機預覽：`python3 -m http.server 8765` 後開 http://localhost:8765/
