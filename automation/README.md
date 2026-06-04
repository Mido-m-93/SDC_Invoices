# automation/ — Phase 1+ バックエンドスクリプト

Roadmap v2 における Phase 3〜10 を支える Python スクリプト群。
Next.js のフロントエンド（`src/`）が UI と Mock データを担当し、
こちらは MoneyForward / Notion / SharePoint / Excel との実データ連携を担う。

## モジュール構成

| ディレクトリ | 役割 | Roadmap対応 |
|---|---|---|
| `mf_sync/` | MF Cloud Invoice API（取引先・請求書・OAuth） | Phase 6 |
| `notion_sync/` | Notion v2 営業パイプライン DB 連携 | Phase 4 (project/vendor master) |
| `reconcile/` | 営業×契約×請求×支払 突合・Teams アラート | Phase 4 + 5 |
| `sheet_builder/` | Excel 統合管理ブック（10シート）生成・Notion同期 | Phase 4 (master data) |
| `sharepoint/` | 契約フォルダ MECE 再構成・取引先マッピング | Phase 1 (workflow mapping) |

## セットアップ

```bash
pip install -r automation/requirements.txt
```

認証情報は 1Password `AI-Agents` vault で管理：

```bash
cat > /tmp/op_env.txt << EOF
MF_CLIENT_ID=op://AI-Agents/MF Client ID/credential
MF_CLIENT_SECRET=op://AI-Agents/MF Client Secret/credential
MF_REFRESH_TOKEN=op://AI-Agents/MF Refresh Token/credential
NOTION_TOKEN=op://AI-Agents/Notion RC Token/credential
MF_SCOPE=mfc/invoice/data.read
EOF
```

## 実行フロー（日次）

```bash
# 1. 取引先マスター同期（Notion Pipeline → Excel M_取引先）
op run --env-file=/tmp/op_env.txt -- python automation/mf_sync/populate_master.py
op run --env-file=/tmp/op_env.txt -- python automation/mf_sync/sync_partners.py --apply

# 2. 案件マスター同期
op run --env-file=/tmp/op_env.txt -- python automation/mf_sync/populate_projects.py

# 3. MF請求書同期
op run --env-file=/tmp/op_env.txt -- python automation/mf_sync/sync_invoices.py --apply

# 4. 突合・アラート（reconcile → Teams notification）
op run --env-file=/tmp/op_env.txt -- python automation/reconcile/reconcile.py
```

## MF OAuth 再認可

Refresh Token 失効時：

```bash
op run --env-file=/tmp/op_env.txt -- python automation/mf_sync/mf_reauth.py
# ブラウザで MF 認可 → 1Password に自動書き戻し
```

## 担当

- Jin（Robo Co-op）: アーキテクチャ・Notion連携
- Mohamad（SDC）: 経理運用・MF・Teams通知
