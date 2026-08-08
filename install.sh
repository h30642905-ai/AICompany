#!/usr/bin/env bash
# AIカンパニー — one-line installer & launcher
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Getabako/AICompany/main/install.sh)"
#
# 何度貼っても OK。初回はダウンロード、2 回目以降は最新版に更新して起動するだけ。

set -e

GH_REPO="${AICOMPANY_REPO:-Getabako/AICompany}"
BRANCH="${AICOMPANY_BRANCH:-main}"
INSTALL_DIR="${AICOMPANY_HOME:-$HOME/Desktop/AICompany}"

cyan()  { printf "\033[36m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*" >&2; }

__ash_on_error() {
  red ""
  red "──────────────────────────────────────────"
  red "  途中で止まりました。上の赤い文字（エラー）をそのままコピーして、"
  red "  Codex か Claude Code に貼り付け『このエラーを直して』と頼んでください。"
  red "──────────────────────────────────────────"
}
trap __ash_on_error ERR

cyan "▶ AIカンパニー セットアップを開始します"

if [[ "$(uname)" != "Darwin" ]]; then
  red "✗ install.sh は macOS 向けです。"
  red ""
  red "Windows の方は PowerShell を開いて以下の 1 行を実行してください:"
  red "  iwr -useb https://raw.githubusercontent.com/$GH_REPO/main/install.ps1 | iex"
  exit 1
fi

# 道具の確認（Node/git/Codex は「第一の儀（環境構築）」で支度済みの前提）
[[ -x /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
[[ -x /usr/local/bin/brew ]] && eval "$(/usr/local/bin/brew shellenv)"
__missing=""
command -v node  >/dev/null 2>&1 || __missing="$__missing Node.js"
command -v git   >/dev/null 2>&1 || __missing="$__missing git"
command -v codex >/dev/null 2>&1 || __missing="$__missing Codex"
if [[ -n "$__missing" ]]; then
  red "✗ 道具が足りません：$__missing"
  red ""
  red "先に『第一の儀（環境構築）』を一度だけ実行してください:"
  red "  /bin/bash -c \"\$(curl -fsSL https://service.if-juku.net/Ashura/setup.sh)\""
  red ""
  red "（整え終えたら、もう一度この 1 行を貼り直してください）"
  exit 1
fi

# リポジトリを取得 or 更新
if [[ -d "$INSTALL_DIR/.git" ]]; then
  if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain 2>/dev/null)" ]]; then
    cyan "▶ あなたの修正を保持したまま起動します（自動更新はスキップ）"
    cyan "  最新版に戻したい時は: cd \"$INSTALL_DIR\" && git reset --hard origin/$BRANCH"
  else
    cyan "▶ 既存のアプリを最新版に更新します"
    git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
    git -C "$INSTALL_DIR" reset --quiet --hard "origin/$BRANCH"
  fi
else
  cyan "▶ アプリをダウンロードします → $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  git clone --quiet --depth 1 --branch "$BRANCH" \
    "https://github.com/$GH_REPO.git" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
# 依存ゼロ・ビルド不要（npm install はいりません）

# ChatGPT へのログイン状態を確認
if ! codex login status >/dev/null 2>&1; then
  cyan ""
  cyan "▶ 初回ログイン: ChatGPT アカウントと接続します"
  cyan "  ブラウザが開きます。ChatGPT (Plus/Pro/Business) でサインインしてください。"
  codex login || {
    red "ログインがキャンセルされました。次回もう一度この 1 行を実行してください。"
    exit 1
  }
fi

green ""
green "✓ 起動します。ブラウザが自動で開きます。"
green "  このターミナル（黒い画面）が会社の電源です。閉じると閉店します。"
green "  仕事を続けたい間は開いたままに。閉店は Ctrl+C。"
green ""
curl -fsSL https://service.if-juku.net/Ashura/install-command.sh | bash -s -- aicompany "AIカンパニー" "$INSTALL_DIR" "node bin/cli.js" 2>/dev/null || true
trap - ERR
exec node bin/cli.js
