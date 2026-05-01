#!/usr/bin/env bash
# =============================================================================
# Codespaces / Dev Container セットアップスクリプト
# コンテナ作成後に自動実行される（postCreateCommand）
# =============================================================================
# project-config.yml の toolchain 設定に合わせてカスタマイズすること
# =============================================================================
set -euo pipefail

echo "=== Dev Container セットアップ開始 ==="

# --- 1. uv インストール ---
if ! command -v uv &> /dev/null; then
  echo ">>> uv をインストール中..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # PATH に追加（現在のシェル用）
  export PATH="$HOME/.local/bin:$PATH"
fi
echo ">>> uv バージョン: $(uv --version)"

# --- 2. Python 仮想環境を作成し、依存関係をインストール ---
echo ">>> 仮想環境を作成し、依存関係をインストール中..."
if [ -f "pyproject.toml" ]; then
  uv venv .venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  uv pip install -e ".[dev]"
  echo ">>> インストール済みパッケージ:"
  uv pip list
else
  echo ">>> pyproject.toml が見つかりません。bootstrap 実行後に再度セットアップしてください。"
fi

# --- 3. gh CLI の確認 ---
if command -v gh &> /dev/null; then
  echo ">>> gh CLI バージョン: $(gh --version | head -1)"
else
  echo ">>> 警告: gh CLI が見つかりません（Codespaces 以外の環境の場合）"
fi

# --- 4. 前提条件チェック ---
echo ">>> 前提条件チェック..."
if [ -f "pyproject.toml" ]; then
  python -c "import sys; print(f'Python {sys.version}: OK')"
  if command -v ruff &> /dev/null; then ruff --version; fi
  if command -v mypy &> /dev/null; then mypy --version; fi
fi

echo "=== Dev Container セットアップ完了 ==="
