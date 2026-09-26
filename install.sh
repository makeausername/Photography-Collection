#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
REPOSITORY='https://github.com/makeausername/Photography-Collection.git'
DESTINATION=/opt/kosmoyonder
[[ $(uname -s) == Linux && $EUID == 0 ]] || { printf '%s\n' '请在服务器使用 sudo bash install.sh。' >&2; exit 1; }
. /etc/os-release
case "$ID:$VERSION_ID" in ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;; *) printf '%s\n' '支持 Ubuntu 22.04/24.04 或 Debian 12/13。' >&2; exit 1;; esac
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates git util-linux
[[ ! -L "$DESTINATION" ]] || { printf '%s\n' '/opt/kosmoyonder 不能是符号链接。' >&2; exit 1; }
exec 8>/opt/.kosmoyonder-install.lock
flock -n 8 || { printf '%s\n' '另一项安装仍在运行。' >&2; exit 1; }
if [[ -e "$DESTINATION" ]]; then
  [[ -d "$DESTINATION/.git" ]] || { printf '%s\n' '安装目录已存在且不是 Git 仓库，未覆盖。请先保留其中的数据，再按部署说明迁移。' >&2; exit 1; }
  [[ $(git -C "$DESTINATION" remote get-url origin) == "$REPOSITORY" ]] || { printf '%s\n' '安装目录属于其他仓库，未修改。' >&2; exit 1; }
  if [[ -f "$DESTINATION/.deployment/deploy.env" ]]; then
    exec bash "$DESTINATION/update.sh"
  fi
  [[ -f "$DESTINATION/deploy.sh" ]] || { printf '%s\n' '源码克隆未完成，请检查目录和 GitHub 网络连接，未删除已有文件。' >&2; exit 1; }
else
  git clone --branch main --single-branch "$REPOSITORY" "$DESTINATION"
fi
exec bash "$DESTINATION/deploy.sh"
