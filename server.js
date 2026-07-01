const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const aliyundrive = require('./aliyundrive');

const app = express();
const PORT = process.env.PORT || 3000;

// 持久化数据路径：Railway 使用 /data volume，本地使用 data/ 目录
const VOLUME_DIR = process.env.VOLUME_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(VOLUME_DIR, 'uploads');
const CATEGORIES_FILE = path.join(VOLUME_DIR, 'categories.json');
const FILE_META_FILE = path.join(VOLUME_DIR, 'file_metadata.json');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(VOLUME_DIR)) {
  fs.mkdirSync(VOLUME_DIR, { recursive: true });
}

// 预设默认分类
const DEFAULT_CATEGORIES = [
  { id: 'live', name: '演唱会现场', color: '#ff6b9d' },
  { id: 'backstage', name: '幕后花絮', color: '#c44dff' },
  { id: 'group', name: '合影留念', color: '#6bc5ff' },
  { id: 'other', name: '其他精彩', color: '#ffb347' }
];

// 数据文件操作
function loadJSON(filePath, defaultVal) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return defaultVal;
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// 初始化默认分类
if (!fs.existsSync(CATEGORIES_FILE)) {
  saveJSON(CATEGORIES_FILE, DEFAULT_CATEGORIES);
}

// 初始化文件元数据
if (!fs.existsSync(FILE_META_FILE)) {
  saveJSON(FILE_META_FILE, {});
}

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// 单独挂载上传目录（独立于 public，支持 Railway volume）
app.use('/uploads', express.static(UPLOAD_DIR));

// 健康检查（Railway 部署需要）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// 大文件上传：延长请求超时（10GB 文件需要足够时间）
app.use((req, res, next) => {
  if (req.path === '/api/upload') {
    req.setTimeout(0);
    res.setTimeout(0);
  }
  next();
});

// 文件存储配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e6);
    cb(null, `${name}_${timestamp}_${random}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件类型，仅支持图片和视频'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }
});

// ========== 文件上传 API ==========

// 上传文件（支持多文件，上传后自动同步到阿里云盘）
app.post('/api/upload', upload.array('files', 50), async (req, res) => {
  try {
    const files = req.files.map(file => ({
      name: file.filename,
      originalName: file.originalname,
      url: `/uploads/${file.filename}`,
      type: file.mimetype.startsWith('image/') ? 'image' : 'video',
      mimeType: file.mimetype,
      size: file.size,
      uploadTime: new Date().toISOString()
    }));
    res.json({ success: true, files });

    // 异步同步到阿里云盘（不阻塞响应）
    if (aliyundrive.isConnected()) {
      for (const file of req.files) {
        try {
          const result = await aliyundrive.uploadFile(file.path, file.filename);
          if (result.success) {
            console.log(`  ✅ 已同步到阿里云盘: ${file.filename}`);
          } else {
            console.log(`  ❌ 同步失败: ${file.filename} - ${result.message}`);
          }
        } catch (err) {
          console.log(`  ❌ 同步出错: ${file.filename} - ${err.message}`);
        }
      }
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Multer 错误处理
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: '文件大小超过 10GB 限制' });
    }
    return res.status(400).json({ success: false, message: '上传错误: ' + err.message });
  }
  if (err.message === '不支持的文件类型，仅支持图片和视频') {
    return res.status(400).json({ success: false, message: err.message });
  }
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// 获取所有文件列表（含分类信息）
app.get('/api/files', (req, res) => {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      return res.json({ success: true, files: [], categories: [] });
    }
    const fileMeta = loadJSON(FILE_META_FILE, {});
    const categories = loadJSON(CATEGORIES_FILE, DEFAULT_CATEGORIES);
    
    const files = fs.readdirSync(UPLOAD_DIR).map(filename => {
      const filePath = path.join(UPLOAD_DIR, filename);
      const stat = fs.statSync(filePath);
      const ext = path.extname(filename).toLowerCase();
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
      const videoExts = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
      let type = 'image';
      if (videoExts.includes(ext)) type = 'video';
      const meta = fileMeta[filename] || {};
      return {
        name: filename,
        url: `/uploads/${filename}`,
        type,
        size: stat.size,
        uploadTime: stat.mtime.toISOString(),
        categoryId: meta.category || null
      };
    }).sort((a, b) => new Date(b.uploadTime) - new Date(a.uploadTime));
    
    res.json({ success: true, files, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 删除文件（同时清理元数据）
app.delete('/api/files/:filename', (req, res) => {
  try {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      // 清理文件元数据
      const fileMeta = loadJSON(FILE_META_FILE, {});
      delete fileMeta[req.params.filename];
      saveJSON(FILE_META_FILE, fileMeta);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, message: '文件不存在' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 分类管理 API ==========

// 获取所有分类
app.get('/api/categories', (req, res) => {
  const categories = loadJSON(CATEGORIES_FILE, DEFAULT_CATEGORIES);
  res.json({ success: true, categories });
});

// 创建分类（任何人可操作）
app.post('/api/categories', (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: '分类名称不能为空' });
  }
  const categories = loadJSON(CATEGORIES_FILE, DEFAULT_CATEGORIES);
  const id = 'cat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const category = {
    id,
    name: name.trim(),
    color: color || '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
    createdAt: new Date().toISOString()
  };
  categories.push(category);
  saveJSON(CATEGORIES_FILE, categories);
  res.json({ success: true, category });
});

// 删除分类（任何人可操作—同步清理文件分类）
app.delete('/api/categories/:id', (req, res) => {
  let categories = loadJSON(CATEGORIES_FILE, DEFAULT_CATEGORIES);
  const before = categories.length;
  categories = categories.filter(c => c.id !== req.params.id);
  if (categories.length === before) {
    return res.status(404).json({ success: false, message: '分类不存在' });
  }
  saveJSON(CATEGORIES_FILE, categories);
  
  // 清理所有引用此分类的文件
  const fileMeta = loadJSON(FILE_META_FILE, {});
  let cleaned = 0;
  for (const key of Object.keys(fileMeta)) {
    if (fileMeta[key].category === req.params.id) {
      delete fileMeta[key].category;
      cleaned++;
    }
  }
  saveJSON(FILE_META_FILE, fileMeta);
  
  res.json({ success: true, cleanedFiles: cleaned });
});

// 设置文件的分类（任何人可操作）
app.put('/api/files/:filename/category', (req, res) => {
  const { categoryId } = req.body;
  const fileMeta = loadJSON(FILE_META_FILE, {});
  
  if (!fileMeta[req.params.filename]) {
    fileMeta[req.params.filename] = {};
  }
  
  if (categoryId === null || categoryId === '') {
    delete fileMeta[req.params.filename].category;
  } else {
    // 验证分类是否存在
    const categories = loadJSON(CATEGORIES_FILE, DEFAULT_CATEGORIES);
    if (!categories.find(c => c.id === categoryId)) {
      return res.status(400).json({ success: false, message: '分类不存在' });
    }
    fileMeta[req.params.filename].category = categoryId;
  }
  
  saveJSON(FILE_META_FILE, fileMeta);
  res.json({ success: true, categoryId: fileMeta[req.params.filename].category || null });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '服务运行中',
    aliyundrive_connected: aliyundrive.isConnected()
  });
});

// ========== 阿里云盘 API 路由 ==========

// 检查连接状态（返回详细信息）
app.get('/aliyundrive/status', (req, res) => {
  const status = aliyundrive.getConnectionStatus();
  res.json({ success: true, ...status });
});

// 用 refresh_token 连接阿里云盘
app.post('/aliyundrive/connect', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ success: false, message: '请填写 Refresh Token' });
  }
  const result = await aliyundrive.connectWithRefreshToken(refresh_token);
  res.json(result);
});

// 创建分享链接
app.post('/aliyundrive/share', async (req, res) => {
  const result = await aliyundrive.createShareLink();
  res.json(result);
});

// 断开连接（清除 token）
app.post('/aliyundrive/disconnect', (req, res) => {
  try {
    if (fs.existsSync(path.join(__dirname, 'aliyundrive_tokens.json'))) {
      fs.unlinkSync(path.join(__dirname, 'aliyundrive_tokens.json'));
    }
    res.json({ success: true, message: '已断开阿里云盘连接' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 启动服务器 ==========

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`  🎵 演唱会记忆收集站已启动！`);
  console.log(`========================================`);
  console.log(`  本地访问:  http://localhost:${PORT}`);
  console.log(`  局域网:    http://<你的IP>:${PORT}`);
  console.log(`  阿里云盘:  ${aliyundrive.isConnected() ? '✅ 已连接' : '❌ 未连接'}`);
  console.log(`========================================\n`);
  
  // 自动启动公网隧道
  try {
    require('./tunnel');
    console.log('  🌐 正在建立公网隧道...');
  } catch (err) {
    console.log('  ⚠️ 隧道启动失败:', err.message);
  }
});
