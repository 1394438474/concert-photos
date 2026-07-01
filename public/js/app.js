// ========== 配置 ==========
const API_BASE = ''; // 同源，留空即可

// ========== DOM 元素 ==========
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const uploadProgress = document.getElementById('uploadProgress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const galleryGrid = document.getElementById('galleryGrid');
const emptyState = document.getElementById('emptyState');
const filterSection = document.getElementById('filterSection');
const photoCountEl = document.getElementById('photoCount');
const videoCountEl = document.getElementById('videoCount');
const totalSizeEl = document.getElementById('totalSize');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxInfo = document.getElementById('lightboxInfo');
const lightboxClose = document.getElementById('lightboxClose');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');
const videoModal = document.getElementById('videoModal');
const videoPlayer = document.getElementById('videoPlayer');
const videoInfo = document.getElementById('videoInfo');
const videoClose = document.getElementById('videoClose');
const toastContainer = document.getElementById('toastContainer');

// ========== 状态 ==========
let allFiles = [];
let allCategories = [];
let currentFilter = 'all';
let currentLightboxIndex = 0;
let filteredFiles = [];
let apiAvailable = true;

// ========== 工具函数 ==========

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function getFileIcon(type) {
  return type === 'video' ? '🎬' : '📷';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== 上传功能 ==========

// 点击上传
uploadZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFiles(e.target.files);
    fileInput.value = ''; // 重置，允许重复选择同一文件
  }
});

// 拖拽上传
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) handleFiles(files);
});

async function handleFiles(fileList) {
  if (!apiAvailable) {
    showToast('当前为静态预览模式，上传功能需要后端服务', 'error');
    return;
  }
  const files = Array.from(fileList);
  // 过滤：只允许图片和视频
  const validFiles = files.filter(f => {
    const isImage = f.type.startsWith('image/');
    const isVideo = f.type.startsWith('video/');
    return isImage || isVideo;
  });

  if (validFiles.length === 0) {
    showToast('请选择图片或视频文件', 'error');
    return;
  }

  // 上传
  uploadProgress.style.display = 'block';
  progressFill.style.width = '0%';
  progressText.textContent = `准备上传 ${validFiles.length} 个文件...`;

  const formData = new FormData();
  validFiles.forEach(file => formData.append('files', file));

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/upload`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = percent + '%';
        progressText.textContent = `上传中... ${percent}% (${formatSize(e.loaded)} / ${formatSize(e.total)})`;
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const res = JSON.parse(xhr.responseText);
        if (res.success) {
          showToast(`成功上传 ${res.files.length} 个文件！`, 'success');
          loadFiles();
        } else {
          showToast('上传失败: ' + (res.message || '未知错误'), 'error');
        }
      } else {
        showToast('上传失败，请重试', 'error');
      }
      uploadProgress.style.display = 'none';
    });

    xhr.addEventListener('error', () => {
      showToast('网络错误，上传失败', 'error');
      uploadProgress.style.display = 'none';
    });

    xhr.send(formData);
  } catch (err) {
    showToast('上传出错: ' + err.message, 'error');
    uploadProgress.style.display = 'none';
  }
}

// ========== 加载文件列表 ==========

async function loadFiles() {
  try {
    const res = await fetch(`${API_BASE}/api/files`);
    const data = await res.json();
    if (data.success) {
      allFiles = data.files;
      allCategories = data.categories || [];
      apiAvailable = true;
      updateStats();
      renderCategoryTabs();
      renderGallery();
    }
  } catch (err) {
    apiAvailable = false;
    allFiles = [];
    allCategories = [];
    updateStats();
    renderGallery();
    showStaticNotice();
  }
}

// 静态部署提示
function showStaticNotice() {
  const banner = document.createElement('div');
  banner.style.cssText = `
    background: linear-gradient(135deg, rgba(255,190,11,0.15), rgba(255,0,110,0.15));
    border: 1px solid rgba(255,190,11,0.3);
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 14px;
    color: rgba(255,255,255,0.8);
    backdrop-filter: blur(20px);
  `;
  banner.innerHTML = `
    <span style="font-size:24px;">💡</span>
    <div>
      <strong>预览模式</strong>：当前为静态部署，可浏览已上传的内容。如需上传新文件，请在本地运行完整版本
      <code style="background:rgba(255,255,255,0.1);padding:2px 8px;border-radius:4px;margin:0 4px;">npm start</code>
    </div>
  `;
  const main = document.querySelector('.main');
  main.insertBefore(banner, main.firstChild);
}

// ========== 更新统计 ==========

function updateStats() {
  const photos = allFiles.filter(f => f.type === 'image');
  const videos = allFiles.filter(f => f.type === 'video');
  const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);

  photoCountEl.textContent = photos.length;
  videoCountEl.textContent = videos.length;
  totalSizeEl.textContent = formatSize(totalSize);
}

// ========== 渲染画廊 ==========

function renderGallery() {
  // 筛选
  const isCategoryFilter = allCategories.some(c => c.id === currentFilter);
  if (isCategoryFilter) {
    filteredFiles = allFiles.filter(f => f.categoryId === currentFilter);
  } else {
    filteredFiles = currentFilter === 'all'
      ? allFiles
      : allFiles.filter(f => f.type === currentFilter);
  }

  // 显示/隐藏筛选栏
  filterSection.style.display = allFiles.length > 0 ? 'flex' : 'none';

  // 空状态
  if (filteredFiles.length === 0) {
    galleryGrid.innerHTML = '';
    emptyState.classList.add('show');
    return;
  }

  emptyState.classList.remove('show');

  // 渲染
  galleryGrid.innerHTML = filteredFiles.map((file, index) => {
    const isVideo = file.type === 'video';
    const thumb = isVideo
      ? `<video src="${file.url}" preload="metadata" muted></video>`
      : `<img src="${file.url}" loading="lazy" alt="${file.name}">`;

    // 分类信息
    const cat = allCategories.find(c => c.id === file.categoryId);
    const catBadge = cat ? `<span class="cat-badge" style="background:${cat.color}">${cat.name}</span>` : '';
    
    // 分类选择器
    const catOptions = allCategories.map(c =>
      `<option value="${c.id}" ${file.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`
    ).join('');
    const catSelect = allCategories.length > 0 ? `
      <div class="cat-select-wrapper" onclick="event.stopPropagation()">
        <select class="cat-select" data-filename="${escapeHtml(file.name)}">
          <option value="">📂 分类...</option>
          ${catOptions}
        </select>
      </div>` : '';

    return `
      <div class="gallery-item" data-index="${index}" data-type="${file.type}" data-url="${file.url}" data-name="${file.name}">
        ${thumb}
        ${catBadge}
        ${catSelect}
        ${isVideo ? '<div class="video-badge">🎬 视频</div>' : ''}
        <button class="delete-btn" data-name="${file.name}" title="删除">&times;</button>
        <a class="download-btn" href="${file.url}" download="${file.name}" title="下载">⬇</a>
        <div class="overlay">
          <div class="item-name">${file.name}</div>
          <div class="item-meta">${formatSize(file.size)} · ${formatDate(file.uploadTime)}</div>
        </div>
      </div>
    `;
  }).join('');

  // 绑定点击事件
  document.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn') || e.target.closest('.download-btn') || e.target.closest('.cat-select-wrapper')) return;
      const index = parseInt(item.dataset.index);
      const type = item.dataset.type;
      if (type === 'video') {
        openVideo(index);
      } else {
        openLightbox(index);
      }
    });
  });

  // 删除按钮
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      if (!confirm(`确定要删除 "${name}" 吗？`)) return;
      await deleteFile(name);
    });
  });

  // 分类下拉框
  document.querySelectorAll('.cat-select').forEach(sel => {
    sel.addEventListener('change', function() {
      const filename = this.dataset.filename;
      setFileCategory(filename, this.value);
    });
  });
}

// ========== 筛选 ==========

function renderCategoryTabs() {
  const filterTabs = document.getElementById('filterTabs');
  if (!filterTabs) return;
  
  // 移除旧的分类标签
  filterTabs.querySelectorAll('.cat-tab').forEach(el => el.remove());
  
  // 添加分类标签
  allCategories.forEach(cat => {
    const count = allFiles.filter(f => f.categoryId === cat.id).length;
    const btn = document.createElement('button');
    btn.className = 'filter-tab cat-tab';
    btn.dataset.filter = cat.id;
    btn.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cat.color};margin-right:4px;"></span>${cat.name} (${count})`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = cat.id;
      renderGallery();
    });
    filterTabs.appendChild(btn);
  });

  // 重新绑定内置标签事件
  filterTabs.querySelectorAll('.filter-tab:not(.cat-tab)').forEach(tab => {
    const newTab = tab.cloneNode(true);
    tab.parentNode.replaceChild(newTab, tab);
    newTab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      newTab.classList.add('active');
      currentFilter = newTab.dataset.filter;
      renderGallery();
    });
  });
}

function setupFilterTabs() {
  // 使用事件委托处理筛选标签点击
  document.getElementById('filterTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    renderGallery();
  });
}

// 初始化筛选
setupFilterTabs();

// ========== 灯箱（图片预览）==========

function openLightbox(index) {
  currentLightboxIndex = index;
  showLightboxImage();
  lightbox.classList.add('show');
}

function showLightboxImage() {
  const file = filteredFiles[currentLightboxIndex];
  lightboxImg.src = file.url;
  lightboxInfo.textContent = `${file.name} · ${formatSize(file.size)} · ${formatDate(file.uploadTime)}`;
}

lightboxClose.addEventListener('click', () => lightbox.classList.remove('show'));
lightboxPrev.addEventListener('click', () => {
  currentLightboxIndex = (currentLightboxIndex - 1 + filteredFiles.length) % filteredFiles.length;
  showLightboxImage();
});
lightboxNext.addEventListener('click', () => {
  currentLightboxIndex = (currentLightboxIndex + 1) % filteredFiles.length;
  showLightboxImage();
});

// 键盘导航
document.addEventListener('keydown', (e) => {
  if (lightbox.classList.contains('show')) {
    if (e.key === 'Escape') lightbox.classList.remove('show');
    if (e.key === 'ArrowLeft') lightboxPrev.click();
    if (e.key === 'ArrowRight') lightboxNext.click();
  }
  if (videoModal.classList.contains('show') && e.key === 'Escape') {
    closeVideo();
  }
});

// ========== 视频播放 ==========

function openVideo(index) {
  const file = filteredFiles[index];
  videoPlayer.src = file.url;
  videoInfo.textContent = `${file.name} · ${formatSize(file.size)} · ${formatDate(file.uploadTime)}`;
  videoModal.classList.add('show');
  videoPlayer.play().catch(() => {});
}

function closeVideo() {
  videoPlayer.pause();
  videoPlayer.src = '';
  videoModal.classList.remove('show');
}

videoClose.addEventListener('click', closeVideo);
videoModal.addEventListener('click', (e) => {
  if (e.target === videoModal) closeVideo();
});

lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) lightbox.classList.remove('show');
});

// ========== 删除文件 ==========

async function deleteFile(name) {
  try {
    const res = await fetch(`${API_BASE}/api/files/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast('已删除', 'success');
      loadFiles();
    } else {
      showToast('删除失败: ' + (data.message || ''), 'error');
    }
  } catch (err) {
    showToast('删除出错', 'error');
  }
}

// ========== 初始化 ==========

loadFiles();
checkDriveStatus();

// ========== 阿里云盘对接 ==========

async function checkDriveStatus() {
  try {
    const res = await fetch(`${API_BASE}/aliyundrive/status`);
    const data = await res.json();
    const btn = document.getElementById('cloudDriveBtn');
    const icon = document.getElementById('driveStatusIcon');
    const text = document.getElementById('driveStatusText');
    if (data.connected) {
      btn.classList.add('connected');
      icon.textContent = '✅';
      text.textContent = '云盘已连接';
      showDriveConnected();
    } else {
      btn.classList.remove('connected');
      icon.textContent = '☁️';
      text.textContent = '阿里云盘';
    }
  } catch (err) {
    // API 不可用时不更新状态
  }
}

function toggleDrivePanel() {
  const panel = document.getElementById('drivePanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') {
    checkDriveStatus();
  }
}

function copyCode(el) {
  const code = el.querySelector('code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const hint = el.querySelector('.copy-hint');
    const original = hint.textContent;
    hint.textContent = '✅ 已复制';
    setTimeout(() => { hint.textContent = original; }, 2000);
  });
}

async function connectDrive() {
  const refresh_token = document.getElementById('refreshTokenInput').value.trim();
  if (!refresh_token) {
    showToast('请先粘贴 Refresh Token', 'error');
    return;
  }
  const btn = document.querySelector('#driveConnectArea .drive-btn');
  btn.textContent = '连接中...';
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/aliyundrive/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token })
    });
    const data = await res.json();
    if (data.success) {
      showToast('阿里云盘连接成功！', 'success');
      checkDriveStatus();
    } else {
      showToast(data.message || '连接失败，请检查 Token 是否正确', 'error');
    }
  } catch (err) {
    showToast('网络错误', 'error');
  }
  btn.textContent = '连接阿里云盘';
  btn.disabled = false;
}

function showDriveConnected() {
  document.getElementById('driveConnectArea').style.display = 'none';
  document.getElementById('driveConnected').style.display = 'block';
}

async function createShareLink() {
  try {
    const res = await fetch(`${API_BASE}/aliyundrive/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      const result = document.getElementById('shareResult');
      result.style.display = 'block';
      document.getElementById('shareLink').href = data.share_url;
      document.getElementById('shareLink').textContent = data.share_url;
      document.getElementById('sharePwd').textContent = data.share_pwd ? `提取码: ${data.share_pwd}` : '';
      showToast('分享链接已创建', 'success');
    } else {
      showToast(data.message || '创建分享链接失败', 'error');
    }
  } catch (err) {
    showToast('网络错误', 'error');
  }
}

async function disconnectDrive() {
  try {
    const res = await fetch(`${API_BASE}/aliyundrive/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      showToast('已断开阿里云盘', 'info');
      document.getElementById('driveConnectArea').style.display = 'block';
      document.getElementById('driveConnected').style.display = 'none';
      document.getElementById('shareResult').style.display = 'none';
      document.getElementById('refreshTokenInput').value = '';
      checkDriveStatus();
    }
  } catch (err) {
    showToast('断开失败', 'error');
  }
}

// ========== 分类管理 ==========

// 为文件设置分类
async function setFileCategory(filename, categoryId) {
  try {
    const res = await fetch(`${API_BASE}/api/files/${encodeURIComponent(filename)}/category`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: categoryId || null })
    });
    const data = await res.json();
    if (data.success) {
      showToast(categoryId ? '已设置分类' : '已取消分类', 'success');
      loadFiles(); // 刷新
    } else {
      showToast(data.message || '设置失败', 'error');
    }
  } catch (err) {
    showToast('网络错误', 'error');
  }
}

// 打开分类管理器
document.getElementById('manageCatBtn').addEventListener('click', async () => {
  document.getElementById('catManagerOverlay').style.display = 'flex';
  await refreshCatManager();
});

// 关闭分类管理器
document.getElementById('catCloseBtn').addEventListener('click', () => {
  document.getElementById('catManagerOverlay').style.display = 'none';
});
document.getElementById('catManagerOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('catManagerOverlay').style.display = 'none';
  }
});

// 刷新分类管理器内容
async function refreshCatManager() {
  try {
    const res = await fetch(`${API_BASE}/api/categories`);
    const data = await res.json();
    if (!data.success) return;
    
    allCategories = data.categories;
    const catList = document.getElementById('catList');
    
    catList.innerHTML = allCategories.map(cat => {
      const count = allFiles.filter(f => f.categoryId === cat.id).length;
      return `
        <div class="cat-item">
          <span class="cat-color-dot" style="background:${cat.color}"></span>
          <span class="cat-item-name">${cat.name}</span>
          <span class="cat-item-count">${count} 个文件</span>
          <button class="cat-delete-btn" onclick="deleteCategory('${cat.id}')" title="删除分类">×</button>
        </div>
      `;
    }).join('') || '<p style="color:var(--text-muted);text-align:center;padding:20px;">还没有自定义分类</p>';
  } catch (err) {
    // ignore
  }
}

// 添加分类
document.getElementById('addCatBtn').addEventListener('click', async () => {
  const name = document.getElementById('newCatName').value.trim();
  if (!name) {
    showToast('请输入分类名称', 'error');
    return;
  }
  const color = document.getElementById('newCatColor').value;
  
  try {
    const res = await fetch(`${API_BASE}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('newCatName').value = '';
      document.getElementById('newCatColor').value = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
      showToast(`分类「${name}」已创建`, 'success');
      await loadFiles();
      await refreshCatManager();
    } else {
      showToast(data.message || '创建失败', 'error');
    }
  } catch (err) {
    showToast('网络错误', 'error');
  }
});

// 删除分类
async function deleteCategory(catId) {
  const cat = allCategories.find(c => c.id === catId);
  if (!cat) return;
  const count = allFiles.filter(f => f.categoryId === catId).length;
  const confirmMsg = count > 0 
    ? `确定要删除分类「${cat.name}」吗？\n\n该分类下有 ${count} 个文件，删除后这些文件的分类将被清除。`
    : `确定要删除分类「${cat.name}」吗？`;
  
  if (!confirm(confirmMsg)) return;
  
  try {
    const res = await fetch(`${API_BASE}/api/categories/${catId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`分类「${cat.name}」已删除`, 'success');
      await loadFiles();
      await refreshCatManager();
    } else {
      showToast(data.message || '删除失败', 'error');
    }
  } catch (err) {
    showToast('网络错误', 'error');
  }
}

// Enter 键添加分类
document.getElementById('newCatName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('addCatBtn').click();
});
