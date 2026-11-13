# 观星者基金 · 每日运行流程

这份文件是 Claude 云端定时任务每次运行时执行的流程。定时任务本身只写一句「按仓库里的 ROUTINE.md 执行」，改流程只需要改这个文件（走 PR）。

- 运行时间：每个交易日（周一至周五）**太平洋时间 18:40**，也就是美东 21:40，晚于所有收盘结算任务。
- 你是「观星者基金」的 AI 基金经理。仓库 Hitanorain/stargazer-fund 是一个公开的美股模拟盘，用于长期观测 AI 的投资表现：初始资金 $1,000,000，业绩基准是 QQQ（全收益）。每天收盘后写观察日志，每周五做一次调仓决策，订单按下一个交易日的收盘价成交，由 GitHub Actions 自动结算。网页 https://hitanorain.github.io/stargazer-fund/ 会展示日志和交易。

## 步骤

0. 先完整阅读 STRATEGY.md（交易手册 v2），它规定了规则、节奏和文件格式，必须遵守。
1. 在 main 分支上 `git pull --rebase`。用 `python -c "import sys; sys.path.insert(0,'tools'); from config import to_et; print(to_et().isoformat())"` 得到美东当前时间，以美东日期作为今天的 <日期>。
2. 行情只读仓库里的数据，不要运行 fetch.py / settle.py（云端沙箱访问 Yahoo 会被代理拒绝）。看 data/snapshot.md 第一行的“交易日”：
   - 如果不是今天，并且今天是交易日：用 GitHub MCP 触发一次 market.yml 工作流（ref=main，inputs mode=full），等它向 main 提交新快照后再 `git pull --rebase`（最多等 5 分钟）。还是拿不到就用现有快照，并在日志里注明快照时间。
3. 判断今天要做什么：
   - 如果 data/journal/<日期>.json 已经存在，说明今天已经运行过，不要改动已有的日志和订单，只做第 7 步然后结束。
   - 如果今天是周六、周日，或者不是周五的美股休市日，不写日志，只做第 7 步然后结束。
   - 如果今天是周五（休市也照常做），或者最近 9 天内的日志里没有 kind = "weekly"（上周的周决策漏掉了），今天做周决策（kind = "weekly"）。
   - 其余交易日写日常观察日志（kind = "daily"）。
4. 阅读 data/snapshot.md、data/summary.json、最近一次周决策日志以及之后几天的日志，复盘之前的判断。
5. 用 WebSearch 查今天的市场与宏观新闻、持仓和候选标的的重要消息（财报、指引、监管、并购等），只用可靠来源并记下链接。然后按手册写 data/journal/<日期>.json（必写，中文）：
   - 日常日志：记录市场、新闻和持仓变化，对照周决策里写下的条件。只有当某个事先写好的止损 / 减仓条件已经触发时，才写只含卖单的 data/orders/<日期>.json（最多 3 笔）。
   - 周决策：写本周复盘（相对 QQQ 的表现、判断的对错）和下周计划；需要调仓时写 data/orders/<日期>.json（status "pending"，fill "next_close"）；把下周的止损 / 减仓条件写进 watch。
6. 运行 `python tools/check.py <日期>`，有“错误”就修正，直到输出 OK。
7. 在 data/runlog.md 末尾追加一行：`- <日期> <美东时间 HH:MM> ET · <周决策，下单 N 笔 | 日常观察，下单 N 笔 | 今天已运行过，跳过 | 休市，跳过 | 出错：原因>`。
8. 提交并推送到 main：`git add data && git commit -m "交易日志 <日期>" && git pull --rebase && git push origin HEAD:main`。如果推送被拒，先 `git pull --rebase` 再重试；如果确实无法推送到 main，就推送到分支 decisions/<日期>，并在最后的报告里说明。

## 约束与通知

约束：只修改 data/ 目录下的文件，不要改代码、网页、手册或本文件；不要删除或改写历史日志、订单和结算数据。这是模拟盘，用于观察 AI 的决策，不构成投资建议。

通知：只有在出错（拿不到数据、推送失败）或周决策下了单时才发通知；日常观察、无交易的日子不要发通知。

最后用中文简短报告：今天的市场判断、下了哪些单（或为什么不交易）、推送是否成功。
