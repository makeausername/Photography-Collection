#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ $(uname -s) == Linux && $EUID == 0 ]] || { printf '%s\n' '请在服务器运行 sudo bash update.sh。' >&2; exit 1; }
STATE="$ROOT/.deployment"
[[ -f "$STATE/deploy.env" && ! -L "$STATE" ]] || { printf '%s\n' '尚未安装，请先执行 sudo bash deploy.sh。' >&2; exit 1; }
command -v git >/dev/null || { printf '%s\n' '缺少 Git，请安装 git 软件包。' >&2; exit 1; }
if [[ ${KOSMO_DEPLOY_LOCK_HELD:-} != "$STATE/deploy.lock" || $(readlink /proc/$$/fd/9 2>/dev/null || true) != "$STATE/deploy.lock" ]]; then
  exec 9>"$STATE/deploy.lock"
fi
flock -n 9 || { printf '%s\n' '另一项部署操作尚未结束。' >&2; exit 1; }
export KOSMO_DEPLOY_LOCK_HELD="$STATE/deploy.lock"
source "$ROOT/scripts/github-sync.sh"
github_sync "$ROOT" 'https://github.com/makeausername/Photography-Collection.git' main
export KOSMO_SOURCE_READY=1
exec bash "$ROOT/deploy.sh" update
