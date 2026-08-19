# AIカンパニー — Windows one-line installer & launcher
#
#   iwr -useb https://raw.githubusercontent.com/h30642905-ai/AICompany/main/install.ps1 | iex
#
# 何度貼っても OK。初回はダウンロード、2 回目以降は最新版に更新して起動。

$ErrorActionPreference = "Stop"

trap {
    Write-Host "" -ForegroundColor Red
    Write-Host "──────────────────────────────────────────" -ForegroundColor Red
    Write-Host "  途中で止まりました。上の赤い文字（エラー）をコピーして" -ForegroundColor Red
    Write-Host "  Codex か Claude Code に貼り付け『このエラーを直して』と頼んでください。" -ForegroundColor Red
    Write-Host "──────────────────────────────────────────" -ForegroundColor Red
    break
}

$GH_REPO   = if ($env:AICOMPANY_REPO)   { $env:AICOMPANY_REPO }   else { "h30642905-ai/AICompany" }
$BRANCH    = if ($env:AICOMPANY_BRANCH) { $env:AICOMPANY_BRANCH } else { "main" }
$DesktopDir = [Environment]::GetFolderPath('Desktop')
$InstallDir = if ($env:AICOMPANY_HOME)  { $env:AICOMPANY_HOME }  else { Join-Path $DesktopDir "AICompany" }

function Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function OK($msg)   { Write-Host $msg -ForegroundColor Green }
function Err($msg)  { Write-Host $msg -ForegroundColor Red }

Info "▶ AIカンパニー セットアップを開始します（Windows）"

# 道具の確認（Node/git/Codex は「第一の儀（環境構築）」で支度済みの前提）
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$__missing = @()
if (-not (Get-Command node  -ErrorAction SilentlyContinue)) { $__missing += "Node.js" }
if (-not (Get-Command git   -ErrorAction SilentlyContinue)) { $__missing += "git" }
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { $__missing += "Codex" }
if ($__missing.Count -gt 0) {
    Err "✗ 道具が足りません：$($__missing -join ' ')"
    Err ""
    Err "先に『第一の儀（環境構築）』を一度だけ実行してください:"
    Err "  iwr -useb https://service.if-juku.net/Ashura/setup.ps1 | iex"
    Err ""
    Err "（整え終えたら、もう一度この 1 行を貼り直してください）"
    exit 1
}

# リポジトリを取得 or 更新
if (Test-Path (Join-Path $InstallDir ".git")) {
    $dirty = git -C $InstallDir status --porcelain 2>$null
    if ($dirty) {
        Info "▶ あなたの修正を保持したまま起動します（自動更新はスキップ）"
    } else {
        Info "▶ 既存のアプリを最新版に更新します"
        git -C $InstallDir fetch --quiet origin $BRANCH
        git -C $InstallDir reset --quiet --hard "origin/$BRANCH"
    }
} else {
    Info "▶ アプリをダウンロードします → $InstallDir"
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    git clone --quiet --depth 1 --branch $BRANCH "https://github.com/$GH_REPO.git" $InstallDir
}

Set-Location $InstallDir
# 依存ゼロ・ビルド不要

# ChatGPT へのログイン状態を確認
codex login status *> $null
if ($LASTEXITCODE -ne 0) {
    Info ""
    Info "▶ 初回ログイン: ChatGPT アカウントと接続します（ブラウザが開きます）"
    codex login
    if ($LASTEXITCODE -ne 0) { Err "ログインがキャンセルされました。次回もう一度実行してください。"; exit 1 }
}

OK ""
OK "✓ 起動します。ブラウザが自動で開きます。"
OK "  この黒い画面が会社の電源です。閉じると閉店します。閉店は Ctrl+C。"
OK ""
node bin/cli.js
