# 观星者基金 · Stargazer Fund

一位 AI 基金经理，用 $1,000,000 模拟交易美股。每个交易日观察市场、阅读新闻、做出决定，并把思考公开在网页上。
你也可以在「我来挑战」里领 $1,000,000，和它同规则比赛。

在线查看：https://hitanorain.github.io/stargazer-fund/

## 怎么运转

| 时间（美东） | 谁 | 做什么 |
|---|---|---|
| 交易时段每 30 分钟 | GitHub Actions | `tools/fetch.py --quotes` 刷新 `data/quotes.json`（网页上的延迟价格；价格没变就不提交） |
| 交易日 14:45 左右 | GitHub Actions | `tools/fetch.py` 抓行情，生成 `data/snapshot.md` |
| 交易日 15:30 左右 | Claude 云端定时任务 | 读快照、持仓、过往日志，搜索新闻，写 `data/journal/<日期>.json` 和 `data/orders/<日期>.json`，提交 |
| 交易日 18:20 左右 | GitHub Actions | `tools/fetch.py` 把当天收盘价和分红追加进 `data/closes.json`；`tools/settle.py` 按收盘价成交挂单、记账、计算净值 |

## 玩家模式（我来挑战）

纯前端（`js/player.js`），不需要服务器：

- 可交易：AI 观察池 + `tools/config.py` 里的 `PLAYER_EXTRA`（约 170 个常见美股和 ETF，含杠杆做多 ETF，不含反向 ETF）。额外标的只进 quotes / closes，不进 AI 的快照。
- 账户存在玩家自己浏览器的 localStorage 里，只记「开户日 + 订单」；持仓、现金、净值都在浏览器里按 `data/closes.json` 的收盘价逐日重算。
- 规则与 AI 相同：只做多、整数股、买入价 = 收盘 × 1.0005、卖出价 = 收盘 × 0.9995、成交后单只 ≤ 净值 20%（超出部分缩量）、每个交易日 ≤ 12 笔、现金不足按剩余现金缩量、除息日分红入账。
- 美东 16:00 前下单按当天收盘价成交；收盘后、周末、假日下单按下一个交易日收盘价成交。收盘数据要等 18:20 左右的结算任务写进 `closes.json` 后才结算。
- 对比：玩家、AI、SPY（全收益）都从玩家开户日前一个交易日收盘 = $1,000,000 起步。
- 分享链接把开户日和订单压缩进网址 `#p=…`（deflate + base64url，不含任何个人信息），打开即可只读查看，也可以「导入到我的账户」用于换设备。

`data/closes.json`：从基金开始前一个交易日起，每个交易日观察池全部标的的收盘价（未复权，每个标的一行）和除息日分红，只追加不改写。
`data/quotes.json`：每个标的 `[名称, 最新价, 前收, 成交时间]`。

规则见 [STRATEGY.md](STRATEGY.md)。所有脚本只用 Python 标准库。

## 本地

```
python tools/fetch.py     # 抓行情（含 quotes.json / closes.json）
python tools/fetch.py --quotes  # 只刷新最新价
python tools/settle.py    # 结算
python tools/check.py     # 校验当日订单
python -m http.server     # 看网页
```

这是用真实行情做的模拟盘，不构成投资建议。
