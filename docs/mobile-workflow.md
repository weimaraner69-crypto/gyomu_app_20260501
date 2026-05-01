# モバイル開発ワークフロー

## 概要

iPhone / iPad から GitHub リポジトリの操作やコード編集を行うための代替手段をまとめる。
Safari で github.dev を開く方法は画面が小さく実用的でないため、専用アプリやターミナル経由のアプローチを推奨する。

## 推奨アプローチ

### 1. GitHub Mobile アプリ（最も手軽）

**用途**: PR レビュー・承認、Issue 管理、Actions ログ確認、Copilot Chat

- App Store から「GitHub」をインストール
- PR の差分確認・コメント・承認が可能
- GitHub Copilot Chat がモバイルで利用可能（質問・コード生成）
- Actions のワークフロー実行状況とログを確認可能
- Issue の作成・編集・クローズが可能

**制限**: ファイル編集やターミルアクセスは不可

### 2. SSH ターミナルアプリ経由で Codespace に接続

**用途**: 本格的なコード編集・コマンド実行

#### 推奨アプリ

| アプリ | 特徴 | 価格 |
|---|---|---|
| **Termius** | モダンな UI、Codespace 対応 | 無料（Pro は有料） |
| **Blink Shell** | Mosh 対応で接続安定 | 有料 |
| **a-Shell** | ローカル実行も可能 | 無料 |

#### Codespace への SSH 接続手順

```bash
# PC で事前に Codespace を起動しておく
# ターミナルアプリから接続
gh cs ssh
```

#### 接続後の作業例

```bash
# ステータス確認
git status

# テスト実行
{{RUN_PREFIX}} {{TEST_RUNNER}}

# Copilot エージェントの指示（Codespace ターミナルで）
# gh copilot suggest "..."
```

### 3. Safari（補助的な利用）

**用途**: Actions ログ確認、簡単な文書編集

- GitHub の通常 Web サイト (github.com) を使用する
- 「デスクトップ用 Web サイトを表示」で PC 版表示に切り替え可能
- ファイルの軽微な編集は鉛筆アイコンから可能
- github.dev（Web エディタ）は画面が小さいため非推奨

## ワークフロー別ガイド

### PR のレビュー・承認

1. **GitHub Mobile** で通知を受信
2. 差分を確認し、コメントを投稿
3. 問題なければ承認（Approve）
4. 自動実行パイプラインの最終承認もモバイルから可能

### CI 失敗の確認

1. **GitHub Mobile** で Actions タブを開く
2. 失敗したジョブのログを確認
3. 簡単な修正であれば Safari から直接編集
4. 複雑な修正は Codespace + SSH で対応

### Issue 管理

1. **GitHub Mobile** で Issue を作成・編集
2. ラベルやアサインを設定
3. Projects ボードの確認も可能

## iPad 固有の Tips

- iPad Pro + Magic Keyboard の場合、Safari でも比較的快適に操作可能
- Split View で GitHub Mobile + メモアプリを並べて作業できる
- Stage Manager（iPadOS 16+）で複数ウィンドウを活用可能

## 制約事項

- モバイルからの自動実行パイプライン起動は推奨しない（PC で実行すること）
- 大規模なコード変更はモバイルでは行わない
- SSH 接続は Wi-Fi 環境を推奨（モバイル回線では不安定になる場合がある）
