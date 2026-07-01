/**
 * 自动隧道模块
 * 使用 localtunnel CLI 将本地服务器暴露到公网
 * 自动重连，保持持久在线
 */

const { spawn } = require('child_process');
const http = require('http');

const PORT = process.env.PORT || 3000;
const SUBDOMAIN = 'concert-memory-2026';
const RETRY_DELAY = 5000;

let currentUrl = null;
let tunnelProcess = null;
let isReconnecting = false;

function log(message) {
  const time = new Date().toLocaleTimeString('zh-CN');
  console.log(`[隧道 ${time}] ${message}`);
}

function startTunnel() {
  if (isReconnecting) return;
  isReconnecting = true;

  log('正在建立隧道...');

  const args = ['--port', String(PORT), '--subdomain', SUBDOMAIN, '--print-requests'];

  // 尝试使用本地 node_modules 中的 localtunnel CLI
  const ltPath = require('path').join(__dirname, 'node_modules', 'localtunnel', 'bin', 'lt.js');
  
  tunnelProcess = spawn('node', [ltPath, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  let urlFound = false;

  tunnelProcess.stdout.on('data', (data) => {
    const text = data.toString();
    // 解析 URL
    const match = text.match(/your url is: (https:\/\/[^\s]+)/);
    if (match) {
      currentUrl = match[1];
      urlFound = true;
      isReconnecting = false;
      log(`✅ 公网地址: ${currentUrl}`);
      // 更新 CloudStudio 重定向页面
      updateRedirectUrl(currentUrl);
    }
  });

  tunnelProcess.stderr.on('data', (data) => {
    const text = data.toString();
    if (text.includes('taken') || text.includes('unavailable')) {
      // 子域名被占用，使用随机域名
      log('⚠️ 自定义域名被占用，使用随机域名');
    }
  });

  tunnelProcess.on('close', (code) => {
    log(`隧道断开 (code: ${code})`);
    tunnelProcess = null;
    if (currentUrl && !isReconnecting) {
      log(`${RETRY_DELAY/1000}s 后自动重连...`);
      setTimeout(startTunnel, RETRY_DELAY);
    }
  });

  tunnelProcess.on('error', (err) => {
    log(`隧道错误: ${err.message}`);
    tunnelProcess = null;
    if (!isReconnecting) {
      setTimeout(startTunnel, RETRY_DELAY);
    }
  });

  // 如果5秒内没收到URL，重试
  setTimeout(() => {
    if (!urlFound && tunnelProcess) {
      log('⚠️ 超时未获取到地址，重试...');
      tunnelProcess.kill();
      tunnelProcess = null;
      isReconnecting = false;
      startTunnel();
    }
  }, 15000);
}

function updateRedirectUrl(url) {
  // 更新 CloudStudio 重定向页面中的 URL
  const fs = require('fs');
  const path = require('path');
  const htmlPath = path.join(__dirname, 'public_cloudstudio', 'index.html');
  
  try {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/https:\/\/[^"'\s]+\.loca\.lt/g, url);
    fs.writeFileSync(htmlPath, html, 'utf8');
    log('已更新重定向地址');
  } catch (err) {
    // 静默失败
  }
}

function getCurrentUrl() {
  return currentUrl;
}

// 启动
startTunnel();

// 心跳保持
setInterval(() => {
  if (currentUrl) {
    const req = http.get(`http://localhost:${PORT}/api/health`, () => {});
    req.on('error', () => {});
    req.setTimeout(5000, () => req.destroy());
  }
}, 30000);

module.exports = { getCurrentUrl, startTunnel };
