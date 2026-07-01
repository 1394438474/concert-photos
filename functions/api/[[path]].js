// ========== 演唱会照片分享 — Cloudflare Workers API ==========
// 处理所有 /api/* 路由，替代原 Express 后端

const DEFAULT_CATEGORIES = [
  { id: 'live', name: '演唱会现场', color: '#ff6b9d' },
  { id: 'backstage', name: '幕后花絮', color: '#c44dff' },
  { id: 'group', name: '合影留念', color: '#6bc5ff' },
  { id: 'other', name: '其他精彩', color: '#ffb347' }
];

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'
]);

const MAX_FILE_SIZE = 100 * 1024 * 1024; // Workers 免费计划单请求上限 100MB

// ---------- 工具函数 ----------

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

function safeName(original) {
  const ext = (original || 'file').split('.').pop().toLowerCase();
  const base = (original || 'file').replace(/\.[^.]+$/, '');
  return `uploads/${base}_${Date.now()}_${Math.round(Math.random() * 1e6)}.${ext}`;
}

function isVideo(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  return ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
}

// ---------- KV 元数据 ----------

async function getCategories(env) {
  const raw = await env.META.get('categories');
  if (raw) return JSON.parse(raw);
  await env.META.put('categories', JSON.stringify(DEFAULT_CATEGORIES));
  return [...DEFAULT_CATEGORIES];
}

async function saveCategories(env, cats) {
  await env.META.put('categories', JSON.stringify(cats));
}

async function getMeta(env, filename) {
  const raw = await env.META.get(`file:${filename}`);
  return raw ? JSON.parse(raw) : {};
}

async function saveMeta(env, filename, meta) {
  await env.META.put(`file:${filename}`, JSON.stringify(meta));
}

async function delMeta(env, filename) {
  await env.META.delete(`file:${filename}`);
}

// ---------- API 处理函数 ----------

async function listFiles(env) {
  const categories = await getCategories(env);
  const files = [];
  const list = await env.FILES.list({ prefix: 'uploads/' });

  for (const obj of list.objects) {
    const name = obj.key.replace('uploads/', '');
    if (!name) continue;
    const meta = await getMeta(env, name);
    files.push({
      name,
      url: `/uploads/${encodeURIComponent(name)}`,
      type: meta.type || (isVideo(name) ? 'video' : 'image'),
      size: meta.size || 0,
      uploadTime: meta.uploadTime || obj.uploaded.toISOString(),
      categoryId: meta.categoryId || null,
    });
  }

  files.sort((a, b) => new Date(b.uploadTime) - new Date(a.uploadTime));
  return reply({ success: true, files, categories });
}

async function uploadFiles(request, env) {
  try {
    const form = await request.formData();
    const entries = form.getAll('files');
    if (!entries.length) return reply({ success: false, message: '没有选择文件' }, 400);

    const results = [];
    for (const f of entries) {
      if (!(f instanceof File)) continue;
      if (!ALLOWED_MIME.has(f.type)) continue;
      if (f.size > MAX_FILE_SIZE) {
        return reply({ success: false, message: `"${f.name}" 超过 100MB 限制`, oversized: f.name }, 413);
      }

      const key = safeName(f.name);
      const filename = key.replace('uploads/', '');

      await env.FILES.put(key, f.stream(), {
        httpMetadata: { contentType: f.type },
        customMetadata: { originalName: f.name },
      });

      const meta = {
        originalName: f.name,
        type: f.type.startsWith('image/') ? 'image' : 'video',
        mimeType: f.type,
        size: f.size,
        uploadTime: new Date().toISOString(),
        categoryId: null,
      };
      await saveMeta(env, filename, meta);

      results.push({
        name: filename,
        originalName: f.name,
        url: `/uploads/${encodeURIComponent(filename)}`,
        type: meta.type,
        mimeType: meta.mimeType,
        size: meta.size,
        uploadTime: meta.uploadTime,
      });
    }

    return reply({ success: true, files: results });
  } catch (err) {
    return reply({ success: false, message: '上传失败: ' + err.message }, 500);
  }
}

async function deleteFile(filename, env) {
  try {
    await env.FILES.delete(`uploads/${filename}`);
    await delMeta(env, filename);
    return reply({ success: true });
  } catch (err) {
    return reply({ success: false, message: err.message }, 500);
  }
}

async function getCategoriesHandler(env) {
  return reply({ success: true, categories: await getCategories(env) });
}

async function createCategory(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply({ success: false, message: '无效的请求体' }, 400); }

  const { name, color } = body;
  if (!name?.trim()) return reply({ success: false, message: '分类名称不能为空' }, 400);

  const cats = await getCategories(env);
  const cat = {
    id: 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    color: color || '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
    createdAt: new Date().toISOString(),
  };
  cats.push(cat);
  await saveCategories(env, cats);
  return reply({ success: true, category: cat });
}

async function deleteCategory(id, env) {
  let cats = await getCategories(env);
  const before = cats.length;
  cats = cats.filter(c => c.id !== id);
  if (cats.length === before) return reply({ success: false, message: '分类不存在' }, 404);
  await saveCategories(env, cats);
  return reply({ success: true, cleanedFiles: 0 });
}

async function setFileCategory(filename, request, env) {
  let body;
  try { body = await request.json(); } catch { return reply({ success: false, message: '无效的请求体' }, 400); }

  const { categoryId } = body;
  const meta = await getMeta(env, filename);

  if (!categoryId) {
    delete meta.categoryId;
  } else {
    const cats = await getCategories(env);
    if (!cats.find(c => c.id === categoryId)) {
      return reply({ success: false, message: '分类不存在' }, 400);
    }
    meta.categoryId = categoryId;
  }

  await saveMeta(env, filename, meta);
  return reply({ success: true, categoryId: meta.categoryId || null });
}

// ---------- 路由入口 ----------

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { headers: cors() });

  try {
    // GET /api/health
    if (method === 'GET' && path === '/api/health') return reply({ status: 'ok', platform: 'cloudflare' });
    // GET /api/files
    if (method === 'GET' && path === '/api/files') return listFiles(env);
    // POST /api/upload
    if (method === 'POST' && path === '/api/upload') return uploadFiles(request, env);
    // DELETE /api/files/{filename}
    if (method === 'DELETE' && path.startsWith('/api/files/')) return deleteFile(decodeURIComponent(path.slice(11)), env);
    // PUT /api/files/{filename}/category
    if (method === 'PUT' && path.startsWith('/api/files/') && path.endsWith('/category')) {
      const filename = decodeURIComponent(path.slice(11, -9));
      return setFileCategory(filename, request, env);
    }
    // GET /api/categories
    if (method === 'GET' && path === '/api/categories') return getCategoriesHandler(env);
    // POST /api/categories
    if (method === 'POST' && path === '/api/categories') return createCategory(request, env);
    // DELETE /api/categories/{id}
    if (method === 'DELETE' && path.startsWith('/api/categories/')) return deleteCategory(path.slice(16), env);

    return reply({ success: false, message: 'Not found' }, 404);
  } catch (err) {
    return reply({ success: false, message: 'Server error: ' + err.message }, 500);
  }
}
