# notion_sync

Notion 3旧DB（JP / Global / 旧Unified）→ 新 `🧪 Test_Unified_Pipeline v2` への統合同期。

## セットアップ

1. Notion Integration を作成しトークン取得
2. 旧3DBに **読み取り権限** で招待
3. 新Unified v2を置くNotionページに **編集権限** で招待
4. 本ディレクトリに `.env` を作成:
   ```
   NOTION_TOKEN=secret_xxx
   NEW_UNIFIED_V2_PARENT_PAGE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
5. `pip install -r ../requirements.txt`（requests / pyyaml / python-dotenv / rapidfuzz）

## 実行手順

### Step 1: 新Unified v2 DB作成（1回だけ）

```bash
# 計画確認
python create_unified_v2.py

# 実行
python create_unified_v2.py --apply
```

→ `config.yaml.new` が生成されるので、内容確認後に `config.yaml` に反映（database_id と data_source_id）。

### Step 2: サンプルデータで動作確認（Notion触らない）

```bash
python merge_pipeline.py --mock
```

→ `logs/merge_plan_preview.json` に書き込み計画が出力される。

### Step 3: 本物の旧DBを読んで計画だけ立てる（旧DB読取のみ、新DB書込なし）

```bash
python merge_pipeline.py --dry-run
```

### Step 4: 実際に新Unified v2へ書き込み

```bash
python merge_pipeline.py --apply
```

## Safety guards

- 旧3DBの database_id は `NotionClient.READ_ONLY_DATABASES` に登録され、うっかり書き込みAPIを呼んでもRuntimeErrorで止まる
- `--dry-run` がデフォルト。`--apply` / `--prod` 明示時のみ書き込み
- 全実行は `logs/merge_pipeline_YYYY-MM-DD.log` に記録

## 関連ファイル

- `config.yaml` — DB ID / ステータスマッピング / 重複検出設定
- `notion_client.py` — Notion API ラッパー
- `create_unified_v2.py` — 新DB作成（1回だけ実行）
- `merge_pipeline.py` — 統合同期本体
- `run_daily.py` — Task Scheduler用エントリ
- `samples/` — mock モード用のサンプルレコード
