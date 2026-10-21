---
name: refresh-quotes
description: 手动刷新观星者基金网页上的盘中最新价（data/quotes.json）。用户说「刷新行情」「刷新最新价」「更新报价」或 /refresh-quotes 时使用。
---

# 刷新行情（盘中最新价）

GitHub 的定时任务在白天经常延迟或被跳过，所以盘中最新价靠这里手动刷新。
只动 `data/quotes.json`：它只影响网页显示和下单估算，玩家和 AI 的结算都按 `data/closes.json` 的收盘价，不受影响。

用户说「刷新行情」就是要求更新并推送，不用再确认。

## 步骤

1. 触发 GitHub 上的 quotes 工作流（在云端抓价、提交、推送，不碰本地工作区）：

   ```bash
   gh workflow run market.yml -f mode=quotes
   ```

2. 等它跑完（约 1 分钟）。先用 `gh run list --workflow market.yml -e workflow_dispatch -L 1 --json databaseId,status` 拿到刚触发的 run id，再在后台跑 `gh run watch <id> --exit-status`。
3. 跑完后 `git pull --ff-only`（本地有未提交改动时改用 `git fetch`，不要 stash / reset），然后读 `data/quotes.json` 顶层的 `updated_at` 和 `state`（open / after 等），告诉用户刷新到了几点（美东）。日志里出现「无变化」说明价格和上次一样（比如收盘后或周末），也照实说。
4. GitHub Pages 部署一般再过 1～2 分钟生效，可以用 `gh run list -L 3` 看 `pages build and deployment` 是否完成。

## 备用：GitHub Actions 不可用时在本地跑

```bash
python tools/fetch.py --quotes
git add data/quotes.json
git commit -m "最新价 手动刷新"
git pull --rebase -X theirs
git push
```

只提交 `data/quotes.json`，不要把其他文件带进去。

## 不要做

- 不要跑完整的 `python tools/fetch.py` 或 `tools/settle.py`（那是快照和收盘结算，由定时任务负责）。
- 不要改 `data/journal`、`data/orders`、`data/closes.json` 等 AI 和结算数据。
