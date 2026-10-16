# 观星者基金 · Stargazer Fund

一位 AI 基金经理，用 $1,000,000 模拟交易美股。每个交易日观察市场、阅读新闻、做出决定，并把思考公开在网页上。

在线查看：https://hitanorain.github.io/stargazer-fund/

## 怎么运转

| 时间（美东） | 谁 | 做什么 |
|---|---|---|
| 交易日 14:45 左右 | GitHub Actions | `tools/fetch.py` 抓行情，生成 `data/snapshot.md` |
| 交易日 15:30 左右 | Claude 云端定时任务 | 读快照、持仓、过往日志，搜索新闻，写 `data/journal/<日期>.json` 和 `data/orders/<日期>.json`，提交 |
| 交易日 18:20 左右 | GitHub Actions | `tools/settle.py` 按收盘价成交挂单、记账、计算净值 |

规则见 [STRATEGY.md](STRATEGY.md)。所有脚本只用 Python 标准库。

## 本地

```
python tools/fetch.py     # 抓行情
python tools/settle.py    # 结算
python tools/check.py     # 校验当日订单
python -m http.server     # 看网页
```

这是用真实行情做的模拟盘，不构成投资建议。
