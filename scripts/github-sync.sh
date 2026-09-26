#!/usr/bin/env bash
# Functions are also exercised against disposable local Git remotes in tests.
github_sync(){
  local root=$1 expected=$2 branch=${3:-main} origin current target previous dirty tracked
  [[ -d "$root/.git" ]] || { printf '%s\n' '此目录不是 Git 克隆，不能自动更新。请使用 GitHub 安装方式，并按文档迁移旧数据。' >&2; return 1; }
  origin=$(git -C "$root" remote get-url origin) || return 1
  [[ "$origin" == "$expected" ]] || { printf '%s\n' 'origin 与预期仓库不一致，已停止更新。' >&2; return 1; }
  current=$(git -C "$root" symbolic-ref --quiet --short HEAD) || { printf '%s\n' '当前不是分支检出，已停止更新。' >&2; return 1; }
  [[ "$current" == "$branch" ]] || { printf '请在 %s 分支更新，当前分支未被修改。\n' "$branch" >&2; return 1; }
  dirty=$(git -C "$root" status --porcelain --untracked-files=normal) || return 1
  [[ -z "$dirty" ]] || { printf '%s\n' '服务器源码存在本地修改或未跟踪文件，已停止更新。请先备份并处理修改；不会强制覆盖。' >&2; return 1; }
  tracked=$(git -C "$root" ls-files -- .deployment .env) || return 1
  [[ -z "$tracked" ]] || { printf '%s\n' '私密配置目录被 Git 跟踪，已停止更新。' >&2; return 1; }
  previous=$(git -C "$root" rev-parse HEAD) || return 1
  git -C "$root" fetch --no-tags origin "refs/heads/$branch:refs/remotes/origin/$branch" || return 1
  target=$(git -C "$root" rev-parse "refs/remotes/origin/$branch") || return 1
  git -C "$root" merge-base --is-ancestor "$previous" "$target" || { printf '%s\n' '本地与 GitHub 历史分叉或本地有额外提交，未合并、未重置。' >&2; return 1; }
  # Do not allow a remote commit to overwrite ignored server data.
  tracked=$(git -C "$root" ls-tree -r --name-only "$target" -- .deployment .env) || return 1
  [[ -z "$tracked" ]] || { printf '%s\n' '远端提交包含私密运行目录，拒绝更新。' >&2; return 1; }
  printf '源码版本：%s → %s\n' "$previous" "$target"
  git -C "$root" merge --ff-only "$target" || return 1
  printf '%s\n' "$previous" > "$root/.deployment/previous-source-commit"
  printf '%s\n' "$target" > "$root/.deployment/current-source-commit"
}
