# mf_sync/secrets/

使い捨てトークン・OAuth認可コードの一時ファイル置き場。
**すべて gitignore 対象**。コミットしない。

永続的なクレデンシャルは 1Password の `AI-Agents` vault を SSoT とする:
- `MF Client ID`
- `MF Client Secret`
- `MF Refresh Token` ← 統合scope（accounting + invoice）、自動ローテ対応
- `MF Redirect URI`

`.env` は副次キャッシュ（mf_client.py が 1Password と同期維持する）。
