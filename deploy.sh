#!/usr/bin/env bash
# Run from a trusted source checkout on a dedicated Ubuntu/Debian host.
set -Eeuo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
STATE="$ROOT/.deployment"
ACTION=${1:-install}
if [[ "$ACTION" == --help || "$ACTION" == -h ]]; then
  printf '%s\n' '用法：sudo bash deploy.sh [install|update|verify|status|logs|stop|start]' '首次安装只需输入域名。证书、管理员密码、SQLite 和备份自动初始化。' '要求：独立 Ubuntu 22.04/24.04 或 Debian 12/13；域名已解析；公网 TCP 80/443 可达。'
  exit 0
fi
die(){ printf '未完成：%s\n' "$*" >&2; exit 1; }
[[ "$ACTION" =~ ^(install|update|verify|status|logs|stop|start)$ ]] || die '未知操作，请运行 bash deploy.sh --help。'
[[ $(uname -s) == Linux ]] || die '此脚本应在 Ubuntu / Debian 服务器上运行。'
[[ $EUID == 0 ]] || die '请使用 sudo bash deploy.sh。'
[[ "$ROOT" != *$'\n'* && "$ROOT" != *'$'* && "$ROOT" != *'`'* && "$ROOT" != *'"'* && "$ROOT" != *'\'* ]] || die '安装目录不能包含换行、美元符号、反引号、双引号或反斜线。'
[[ -f "$ROOT/server.mjs" && -f "$ROOT/deploy/compose.yaml" ]] || die '源码不完整，请通过 GitHub 克隆完整项目。'
[[ ! -L "$STATE" ]] || die '.deployment 不能是符号链接。'
mkdir -p -- "$STATE"
chmod 700 -- "$STATE"
command -v flock >/dev/null || die '缺少 flock，请安装 util-linux。'
if [[ ${KOSMO_DEPLOY_LOCK_HELD:-} != "$STATE/deploy.lock" || $(readlink /proc/$$/fd/9 2>/dev/null || true) != "$STATE/deploy.lock" ]]; then
  exec 9>"$STATE/deploy.lock"
fi
flock -n 9 || die '另一项部署操作尚未结束。'
export KOSMO_DEPLOY_LOCK_HELD="$STATE/deploy.lock"
if [[ "$ACTION" == update && ${KOSMO_SOURCE_READY:-} != 1 ]]; then
  exec bash "$ROOT/update.sh"
fi
trap 'printf "部署在第 %s 行停止，未宣告成功。已生成的数据和凭据会保留，可排除问题后重试。\n" "$LINENO" >&2' ERR

validate_domain(){
  DOMAIN=${DOMAIN,,}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%/}
  [[ ${#DOMAIN} -le 253 && "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$ ]] || die '域名格式无效。请只输入域名，如 photos.example.com，不要带路径、端口或通配符。'
  [[ ! "$DOMAIN" =~ \.(localhost|local|internal|test|invalid)$ ]] || die '需要公网域名。'
}
if [[ -f "$STATE/deploy.env" ]]; then
  # Never source an environment file as shell code.
  DOMAIN=$(sed -n 's/^DOMAIN=//p' "$STATE/deploy.env")
  DEPLOYMENT_ID=$(sed -n 's/^DEPLOYMENT_ID=//p' "$STATE/deploy.env")
  validate_domain
  [[ "$DEPLOYMENT_ID" =~ ^[a-f0-9]{32}$ ]] || die '部署标识损坏，请从备份恢复 deploy.env。'
else
  [[ "$ACTION" == install ]] || die '尚未初始化，请先执行 sudo bash deploy.sh。'
  [[ ! -e "$STATE/deployment.json" && ! -e "$STATE/data/portfolio.sqlite" && ! -e "$STATE/data/admin.json" ]] || die '发现已有数据但缺少 deploy.env，请恢复配置，避免创建第二套部署。'
  read -r -p '请输入网站域名（如 photos.example.com）：' DOMAIN
  validate_domain
  DEPLOYMENT_ID=''
fi
export DOMAIN
export DEPLOYMENT_SOURCE="$ROOT"
# Prevent inherited Compose overrides from selecting another daemon/project/file.
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES DOCKER_HOST DOCKER_CONTEXT
COMPOSE=(docker --context default compose --project-name kosmoyonder --env-file "$STATE/deploy.env" -f "$ROOT/deploy/compose.yaml")
if [[ -f "$STATE/compose.override.yaml" ]]; then
  [[ ! -L "$STATE/compose.override.yaml" ]] || die '私密 Compose 配置不能是符号链接。'
  chmod 600 "$STATE/compose.override.yaml"
  COMPOSE+=(-f "$STATE/compose.override.yaml")
fi
dc(){ "${COMPOSE[@]}" "$@"; }
docker_local(){ docker --context default "$@"; }

install_docker(){
  . /etc/os-release
  case "$ID:$VERSION_ID" in ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;; *) die '自动安装支持 Ubuntu 22.04/24.04 和 Debian 12/13。';; esac
  [[ $(dpkg --print-architecture) =~ ^(amd64|arm64)$ ]] || die '自动安装仅支持 amd64 / arm64。'
  [[ -d /run/systemd/system ]] || die '需要正常启动的 systemd 服务器。'
  if command -v docker >/dev/null; then
    docker_local info >/dev/null 2>&1 || die '已有 Docker 无法连接。请先启动 Docker；脚本不会替换现有安装。'
    docker_local compose version >/dev/null 2>&1 || die '已有 Docker 缺少 Compose v2 插件，请先安装 docker-compose-plugin。'
    docker_local compose up --help | grep -q -- '--wait-timeout' || die '请更新 Docker Compose 插件，当前版本不支持健康等待。'
  else
    for package in docker.io docker-compose podman-docker containerd runc; do
      if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then die "发现冲突软件包 $package，未自动卸载。请先按 Docker 官方文档处理。"; fi
    done
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y ca-certificates curl iproute2 openssl
    install -m 0755 -d /etc/apt/keyrings
    curl --fail --silent --show-error --location --proto '=https' "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/kosmoyonder-docker.asc
    chmod 644 /etc/apt/keyrings/kosmoyonder-docker.asc
    cat > /etc/apt/sources.list.d/kosmoyonder-docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/kosmoyonder-docker.asc
EOF
    chmod 644 /etc/apt/sources.list.d/kosmoyonder-docker.sources
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  if ! command -v curl >/dev/null || ! command -v ss >/dev/null || ! command -v openssl >/dev/null; then
    apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl iproute2 openssl
  fi
  systemctl enable --now docker
}

check_project(){
  local container workdir
  while read -r container; do
    [[ -n "$container" ]] || continue
    workdir=$(docker_local inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container")
    [[ "$workdir" == "$ROOT/deploy/compose.yaml" ]] || die '发现另一目录的 kosmoyonder 部署，未修改。请回到原目录操作。'
  done < <(docker_local ps -aq --filter label=com.docker.compose.project=kosmoyonder)
}
check_ports(){
  local container ports
  while read -r container; do
    [[ -n "$container" ]] || continue
    ports=$(docker_local port "$container")
    if grep -Eq ':(80|443)$' <<< "$ports"; then
      [[ $(docker_local inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container") == kosmoyonder ]] || die '80/443 已被其他容器使用，未停止或覆盖。'
    fi
  done < <(docker_local ps -q)
  if [[ -z $(dc ps -q --status running caddy) ]] && [[ -n $(ss -H -ltn '( sport = :80 or sport = :443 )') ]]; then
    die '80/443 已被其他服务占用。请使用独立服务器，或先自行调整已有网站。'
  fi
}
write_env(){
  [[ -n "$DEPLOYMENT_ID" ]] || DEPLOYMENT_ID=$(openssl rand -hex 16)
  local temporary="$STATE/deploy.env.new"
  printf 'DOMAIN=%s\nDEPLOYMENT_ID=%s\nDEPLOYMENT_SOURCE="%s"\n' "$DOMAIN" "$DEPLOYMENT_ID" "$ROOT" > "$temporary"
  chmod 600 "$temporary"; mv -- "$temporary" "$STATE/deploy.env"
}
verify_https(){
  local attempt headers="$STATE/https-check.headers" local_ok=false public_ok=false
  printf '等待可信 HTTPS 证书和网站响应（最多约 5 分钟）…\n'
  for attempt in $(seq 1 30); do
    if curl --noproxy '*' --fail --silent --show-error --connect-timeout 3 --max-time 6 --resolve "$DOMAIN:443:127.0.0.1" -D "$headers" -o /dev/null "https://$DOMAIN/api/site" 2>/dev/null && grep -qi "^X-Kosmo-Instance: $DEPLOYMENT_ID" "$headers"; then
      local_ok=true
      if curl --noproxy '*' --fail --silent --show-error --connect-timeout 3 --max-time 6 -D "$headers" -o /dev/null "https://$DOMAIN/api/site" 2>/dev/null && grep -qi "^X-Kosmo-Instance: $DEPLOYMENT_ID" "$headers"; then public_ok=true; break; fi
    fi
    sleep 3
  done
  rm -f -- "$headers"
  if [[ "$local_ok" != true || "$public_ok" != true ]]; then
    printf '%s\n' '容器已保留，但 HTTPS 尚未验证，不能判定上线成功。' '请检查 A/AAAA 是否指向本机、云安全组 TCP 80/443、代理/CDN、CAA 和系统时间。' '查看日志：sudo bash deploy.sh logs；修复后运行：sudo bash deploy.sh verify。' "私密部署资料（若初始化完成）：$STATE/部署资料.md" >&2
    return 1
  fi
  dc run --rm --no-deps initialize node scripts/deploy-state.mjs verified
  printf '\n%s\n' "部署检查通过：https://$DOMAIN" "后台：https://$DOMAIN/admin" "请用 SFTP 下载并私下保存：$STATE/部署资料.md" '随机初始密码只保存在上述私密文件中，不会输出到终端。'
}

case "$ACTION" in
  status|logs|stop|start|verify)
    command -v docker >/dev/null || die 'Docker 尚未安装。'
    check_project
    case "$ACTION" in
      status) dc ps;;
      logs) dc logs --tail=100 portfolio caddy;;
      stop) dc stop;;
      start) check_ports; dc up -d --wait --wait-timeout 180 portfolio caddy; verify_https;;
      verify) verify_https;;
    esac
    exit 0;;
esac

getent ahosts "$DOMAIN" >/dev/null || die '域名还没有可解析的 A/AAAA 记录，请先解析到这台服务器。'
install_docker
write_env
check_project
check_ports
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 2097152 ]] || die '安装目录所在磁盘至少需要 2 GiB 可用空间；照片和备份需另外预留。'
dc config --quiet
printf '构建网站镜像并准备 HTTPS 服务…\n'
dc build --pull portfolio
dc pull caddy
if [[ -d "$ROOT/.git" ]]; then git -C "$ROOT" rev-parse HEAD > "$STATE/current-source-commit"; fi
# Only stop this site's writer after all images are ready; build failure leaves it running.
dc stop portfolio
dc run --rm --no-deps initialize
dc run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
dc up -d --wait --wait-timeout 180 portfolio caddy
verify_https
