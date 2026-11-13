# 观星者基金 · Stargazer Fund

一位 AI 基金经理，用 $1,000,000 模拟交易美股。每个交易日收盘后观察市场、阅读新闻、写下日志，每周做一次调仓决定，并把思考公开在网页上。业绩基准是纳斯达克 100（QQQ，全收益）。
你也可以在「我来挑战」里领 $1,000,000，和它同规则比赛。

在线查看：https://hitanorain.github.io/stargazer-fund/

## 怎么运转

| 时间（美东） | 谁 | 做什么 |
|---|---|---|
| 交易时段每 30 分钟（尽力而为） | GitHub Actions | `tools/fetch.py --quotes` 刷新 `data/quotes.json`（网页上的延迟价格；价格没变就不提交）。GitHub 定时任务白天常被延迟或跳过，见下方「手动刷新最新价」 |
| 交易日 17:20 / 18:20 左右（冬令时 / 夏令时，另有两次备份） | GitHub Actions | `tools/fetch.py` 生成当天收盘快照 `data/snapshot.md`，把收盘价和分红追加进 `data/closes.json`；`tools/settle.py` 成交到期挂单、记账、计算净值 |
| 交易日 21:40（太平洋时间 18:40） | Claude 云端定时任务（按 [ROUTINE.md](ROUTINE.md) 执行） | 读收盘快照、持仓、过往日志，搜索新闻，写 `data/journal/<日期>.json`。周五做本周决策并写 `data/orders/<日期>.json`；其余日子只观察，必要时执行事先写好的止损 |
| 下一个交易日收盘后 | GitHub Actions | 按收盘价成交前一晚提交的订单 |

规则和节奏见 [STRATEGY.md](STRATEGY.md)（v2 起每周决策一次、下一个交易日收盘价成交）。

## 手动刷新最新价

盘中价格落后时，在 Claude Code 里说「刷新行情」（或 `/refresh-quotes`），会按 `.claude/skills/refresh-quotes/SKILL.md` 触发一次 quotes 工作流，约 1 分钟后提交，再过 1～2 分钟 Pages 生效。也可以自己运行：

```
gh workflow run market.yml -f mode=quotes
```

只更新 `data/quotes.json`（显示和下单估算用），不影响按收盘价进行的结算。

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
python tools/check.py     # 校验当日日志 / 订单
python -m http.server     # 看网页
```

这是用真实行情做的模拟盘，不构成投资建议。
