#!/bin/bash
# ============================================
#  演唱会记忆收集站 - 云服务器一键部署脚本
# ============================================
#  使用方法：
#    1. 将整个项目上传到云服务器（scp/ftp/git）
#    2. 在服务器上运行: bash deploy.sh
# ============================================

set -e

echo "========================================="
echo "  🎵 演唱会记忆收集站 - 部署脚本"
echo "========================================="

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ---------- 1. 安装 Node.js（如果没有） ----------
if ! command -v node &> /dev/null; then
  echo "[1/5] 安装 Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[1/5] Node.js 已安装: $(node -v)"
fi

# ---------- 2. 安装 PM2 ----------
if ! command -v pm2 &> /dev/null; then
  echo "[2/5] 安装 PM2 进程管理器..."
  sudo npm install -g pm2
else
  echo "[2/5] PM2 已安装: $(pm2 -v)"
fi

# ---------- 3. 安装项目依赖 ----------
echo "[3/5] 安装项目依赖..."
npm install --production

# ---------- 4. 创建上传目录 ----------
echo "[4/5] 创建上传目录..."
mkdir -p public/uploads

# ---------- 5. 启动服务 ----------
echo "[5/5] 启动服务..."
pm2 delete concert-memory 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "========================================="
echo "  ✅ 部署完成！"
echo "========================================="
echo ""
echo "  服务地址: http://<服务器IP>:3000"
echo ""
echo "  常用命令："
echo "    pm2 logs concert-memory   # 查看日志"
echo "    pm2 restart concert-memory # 重启服务"
echo "    pm2 stop concert-memory    # 停止服务"
echo ""
echo "  推荐配置 Nginx 反向代理（80/443端口 + HTTPS）："
echo "    参见下方 Nginx 配置示例"
echo ""

# ---------- Nginx 配置提示 ----------
echo '---------- Nginx 配置示例 ----------'
cat << 'NGINX_CONF'
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名或IP

    client_max_body_size 10G;     # 允许上传10G文件

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;

        # 大文件上传超时配置
        proxy_read_timeout 0;
        proxy_send_timeout 0;
    }
}
NGINX_CONF

echo ""
echo "  防火墙：确保开放 3000 端口（或 Nginx 的 80/443）"
echo "    sudo ufw allow 3000"
echo "    # 或 sudo ufw allow 80"
echo ""
