module.exports = {
  apps: [{
    name: 'concert-memory',
    script: 'server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // 大文件上传：不限制日志大小，避免上传中断
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '1G',
    instances: 1,
    autorestart: true,
    watch: false
  }]
};
