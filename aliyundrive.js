/**
 * 阿里云盘 Web API 集成模块
 * 使用浏览器 Refresh Token 认证，无需注册开发者
 * 
 * 基于 tickstep/aliyunpan-api 逆向分析，使用与网页版一致的 API 端点
 * 
 * 功能：Token 刷新、Session 签名、文件上传同步、文件列表、分享链接
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const elliptic = require('elliptic');

// ========== 配置 ==========
const AUTH_URL = 'https://auth.aliyundrive.com';
const API_URL = 'https://api.aliyundrive.com';
const USER_URL = 'https://user.aliyundrive.com';
const TOKEN_FILE = path.join(__dirname, 'aliyundrive_tokens.json');

const APP_ID = '25dzX3vbYqktVxyX';
const API_ID = 'pJZInNHN2dZWk8qg';
const TARGET_FOLDER_NAME = '演唱会记忆收集站';

// ========== 签名字段（持久化） ==========

function loadState() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveState(state) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * 检查是否已连接
 */
function isConnected() {
  const state = loadState();
  return !!state && !!state.refresh_token;
}

/**
 * 获取当前连接状态信息
 */
function getConnectionStatus() {
  const state = loadState();
  if (!state || !state.refresh_token) {
    return { connected: false };
  }
  return {
    connected: true,
    hasSession: !!state.public_key,
    userId: state.user_id || null,
    nickName: state.nick_name || null,
    driveId: state.default_drive_id || null,
    targetFolderId: state.target_folder_id || null
  };
}

// ========== 签名系统 ==========

const EC = elliptic.ec;
const ec = new EC('secp256k1');

/**
 * 生成 secp256k1 密钥对并计算签名
 */
function generateSignature(deviceId, userId) {
  // 生成随机私钥
  const key = ec.genKeyPair();
  const privKey = key.getPrivate();
  const pubKey = key.getPublic();

  // 公钥格式: "04" + hex(x) + hex(y)
  const pubKeyHex = pubKey.encode('hex', false); // uncompressed, starts with 04

  // Nonce 从 0 开始
  const nonce = 0;

  // 签名数据: "AppId:DeviceId:UserId:Nonce"
  const data = `${APP_ID}:${deviceId}:${userId}:${nonce}`;
  const dataHash = crypto.createHash('sha256').update(data).digest('hex');
  
  // 使用 secp256k1 签名
  const signature = key.sign(dataHash, 'hex', { canonical: true });
  
  // 签名格式: hex(r) + hex(s) + "01"
  const sigHex = signature.r.toString('hex', 64) + signature.s.toString('hex', 64) + '01';

  return {
    privateKey: privKey.toString('hex'),
    publicKey: pubKeyHex,
    publicKeyHex: pubKeyHex,
    signature: sigHex,
    deviceId: deviceId,
    userId: userId,
    nonce: nonce
  };
}

/**
 * 创建或获取签名信息
 */
function getOrCreateSignature(state) {
  if (state.signature && state.public_key && state.private_key) {
    // 已有签名，直接使用
    return {
      deviceId: state.device_id,
      publicKey: state.public_key,
      signature: state.signature,
      userId: state.user_id,
      nonce: state.nonce || 0
    };
  }
  
  // 生成新签名
  const deviceId = state.device_id || crypto.randomUUID();
  const userId = state.user_id || '';
  
  const sig = generateSignature(deviceId, userId);
  
  state.device_id = deviceId;
  state.private_key = sig.privateKey;
  state.public_key = sig.publicKey;
  state.signature = sig.signature;
  state.nonce = sig.nonce;
  
  saveState(state);
  
  return sig;
}

// ========== HTTP 请求 ==========

/**
 * 构建通用请求头（模拟浏览器）
 */
function buildHeaders(extraHeaders = {}) {
  return {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'referer': 'https://www.aliyundrive.com/',
    'origin': 'https://www.aliyundrive.com',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...extraHeaders
  };
}

/**
 * 构建带签名的请求头（用于文件操作）
 */
function buildSignedHeaders(state, extraHeaders = {}) {
  const sig = getOrCreateSignature(state);
  const headers = buildHeaders(extraHeaders);
  
  if (sig) {
    headers['x-device-id'] = sig.deviceId;
    headers['x-signature'] = sig.signature;
  }
  
  return headers;
}

async function fetchJSON(url, options) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { success: false, message: `解析响应失败: ${text.substring(0, 200)}`, httpStatus: response.status };
    }
    
    if (!response.ok) {
      return { 
        success: false, 
        message: data.message || data.code || `HTTP ${response.status}`, 
        code: data.code, 
        httpStatus: response.status 
      };
    }
    return { success: true, data };
  } catch (err) {
    return { success: false, message: `网络错误: ${err.message}` };
  }
}

// ========== Token 管理 ==========

/**
 * 保存用户输入的 refresh_token，立即获取 access_token
 * Token 刷新地址: POST https://auth.aliyundrive.com/v2/account/token
 */
async function connectWithRefreshToken(refreshToken) {
  if (!refreshToken || refreshToken.trim().length < 10) {
    return { success: false, message: 'Refresh Token 格式不正确' };
  }

  const result = await refreshAccessToken(refreshToken.trim());
  if (result.success) {
    return { success: true, message: '连接成功！阿里云盘已授权' };
  }
  return result;
}

/**
 * 刷新 access_token
 * Web API: POST https://auth.aliyundrive.com/v2/account/token
 */
async function refreshAccessToken(refreshTokenOverride) {
  const state = loadState();
  const refreshToken = refreshTokenOverride || (state ? state.refresh_token : null);

  if (!refreshToken) {
    return { success: false, message: '没有 refresh_token，请先连接阿里云盘' };
  }

  try {
    const url = `${AUTH_URL}/v2/account/token`;
    const body = {
      refresh_token: refreshToken,
      api_id: API_ID,
      grant_type: 'refresh_token'
    };

    const result = await fetchJSON(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body)
    });

    if (!result.success) {
      return { success: false, message: `刷新令牌失败: ${result.message}` };
    }

    const d = result.data;

    // 构建新的 state（保留已有的签名信息）
    const newState = {
      access_token: d.access_token,
      refresh_token: d.refresh_token || refreshToken,
      token_type: d.token_type || 'Bearer',
      expires_in: d.expires_in || 7200,
      expire_time: Date.now() + (d.expires_in || 7200) * 1000,
      user_id: d.user_id || state?.user_id || '',
      user_name: d.user_name || state?.user_name || '',
      nick_name: d.nick_name || state?.nick_name || '',
      default_drive_id: d.default_drive_id || state?.default_drive_id || '',
      device_id: d.device_id || state?.device_id || crypto.randomUUID(),
      // 保留已有的签名和文件夹信息
      private_key: state?.private_key || null,
      public_key: state?.public_key || null,
      signature: state?.signature || null,
      nonce: state?.nonce || 0,
      target_folder_id: state?.target_folder_id || null,
      session_created: state?.session_created || false
    };

    saveState(newState);
    return { success: true };
  } catch (err) {
    return { success: false, message: `网络错误: ${err.message}` };
  }
}

/**
 * 获取有效的 access_token（自动刷新）
 */
async function getValidToken() {
  const state = loadState();
  if (!state) return null;

  // 检查是否即将过期（提前5分钟刷新）
  if (state.expire_time && Date.now() > state.expire_time - 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken();
    if (!refreshed.success) return null;
    return loadState().access_token;
  }

  return state.access_token;
}

// ========== 用户信息 ==========

/**
 * 获取用户信息和 drive_id
 * GET/POST https://user.aliyundrive.com/v2/user/get
 */
async function getUserInfo() {
  const state = loadState();
  const token = await getValidToken();
  if (!token) return { success: false, message: '未授权' };

  const result = await fetchJSON(`${USER_URL}/v2/user/get`, {
    method: 'POST',
    headers: buildHeaders({
      'authorization': `${state.token_type || 'Bearer'} ${token}`
    }),
    body: JSON.stringify({})
  });

  if (result.success) {
    const d = result.data;
    // 更新 drive_id
    state.default_drive_id = d.default_drive_id || d.backup_drive_id;
    state.user_id = d.user_id;
    saveState(state);
    
    return {
      success: true,
      drive_id: state.default_drive_id,
      user_id: d.user_id,
      nick_name: d.nick_name || d.nickname,
      user_name: d.user_name || d.username
    };
  }
  return result;
}

/**
 * 获取 drive_id（优先使用缓存的，否则调用 API 获取）
 */
async function getDriveId() {
  const state = loadState();
  if (state?.default_drive_id) {
    return { success: true, drive_id: state.default_drive_id };
  }
  return await getUserInfo();
}

// ========== Session 创建 ==========

/**
 * 创建签名会话（上传公钥到服务器）
 * POST https://api.aliyundrive.com/users/v1/users/device/create_session
 */
async function createSession() {
  const state = loadState();
  const token = await getValidToken();
  if (!token) return { success: false, message: '未授权' };

  const sig = getOrCreateSignature(state);

  if (!sig.publicKey) {
    return { success: false, message: '无法生成签名公钥' };
  }

  const result = await fetchJSON(`${API_URL}/users/v1/users/device/create_session`, {
    method: 'POST',
    headers: buildSignedHeaders(state, {
      'authorization': `${state.token_type || 'Bearer'} ${token}`
    }),
    body: JSON.stringify({
      deviceName: 'Chrome浏览器',
      modelName: 'Windows网页版',
      pubKey: sig.publicKey
    })
  });

  if (result.success) {
    state.session_created = true;
    saveState(state);
    return { success: true, message: '会话创建成功' };
  }
  
  return { success: false, message: `创建会话失败: ${result.message}` };
}

/**
 * 确保会话有效（自动创建）
 */
async function ensureSession() {
  const state = loadState();
  if (state?.session_created && state?.signature) {
    return { success: true };
  }
  return await createSession();
}

// ========== 文件夹操作 ==========

/**
 * 确保目标文件夹存在（不存在则创建）
 */
async function ensureTargetFolder() {
  const state = loadState();

  // 如果已缓存 folder_id，直接返回
  if (state?.target_folder_id) {
    return { success: true, folder_id: state.target_folder_id };
  }

  const driveResult = await getDriveId();
  if (!driveResult.success) return driveResult;

  const driveId = driveResult.drive_id;
  const token = await getValidToken();
  if (!token) return { success: false, message: '未授权' };

  // 确保会话已创建
  await ensureSession();

  // 列出根目录下的文件夹，查找目标
  const listResult = await fetchJSON(`${API_URL}/adrive/v3/file/list`, {
    method: 'POST',
    headers: buildSignedHeaders(state, {
      'authorization': `${state.token_type || 'Bearer'} ${token}`
    }),
    body: JSON.stringify({
      drive_id: driveId,
      parent_file_id: 'root',
      limit: 100,
      all: false,
      url_expire_sec: 1600,
      image_thumbnail_process: 'image/resize,w_400/format,jpeg',
      image_url_process: 'image/resize,w_1920/format,jpeg',
      video_thumbnail_process: 'video/snapshot,t_0,f_jpg,ar_auto,w_800',
      fields: '*',
      order_by: 'name',
      order_direction: 'ASC'
    })
  });

  if (listResult.success && listResult.data.items) {
    const existing = listResult.data.items.find(
      item => item.name === TARGET_FOLDER_NAME && item.type === 'folder'
    );
    if (existing) {
      state.target_folder_id = existing.file_id;
      saveState(state);
      return { success: true, folder_id: existing.file_id };
    }
  }

  // 创建文件夹
  const createResult = await fetchJSON(`${API_URL}/adrive/v2/file/createWithFolders`, {
    method: 'POST',
    headers: buildSignedHeaders(state, {
      'authorization': `${state.token_type || 'Bearer'} ${token}`
    }),
    body: JSON.stringify({
      drive_id: driveId,
      parent_file_id: 'root',
      name: TARGET_FOLDER_NAME,
      type: 'folder',
      check_name_mode: 'auto_rename'
    })
  });

  if (createResult.success) {
    state.target_folder_id = createResult.data.file_id;
    saveState(state);
    return { success: true, folder_id: createResult.data.file_id };
  }

  return { success: false, message: `创建文件夹失败: ${createResult.message}` };
}

// ========== 文件上传（三步流程） ==========

/**
 * 上传文件到阿里云盘
 * @param {string} filePath - 本地文件路径
 * @param {string} fileName - 文件名
 */
async function uploadFile(filePath, fileName) {
  const state = loadState();
  const token = await getValidToken();
  if (!token) return { success: false, message: '未授权阿里云盘' };

  const driveResult = await getDriveId();
  if (!driveResult.success) return driveResult;

  const driveId = driveResult.drive_id;
  const folderResult = await ensureTargetFolder();
  if (!folderResult.success) return folderResult;

  const parentFileId = folderResult.folder_id;
  const fileSize = fs.statSync(filePath).size;

  // 确保会话已创建
  await ensureSession();

  // Step 1: 创建上传文件
  const createResult = await fetchJSON(`${API_URL}/adrive/v2/file/createWithFolders`, {
    method: 'POST',
    headers: buildSignedHeaders(state, {
      'authorization': `${state.token_type || 'Bearer'} ${token}`
    }),
    body: JSON.stringify({
      drive_id: driveId,
      parent_file_id: parentFileId,
      name: fileName,
      type: 'file',
      size: fileSize,
      check_name_mode: 'auto_rename',
      content_hash_name: 'sha1',
      proof_version: 'v1',
      part_info_list: [{ part_number: 1 }]
    })
  });

  if (!createResult.success) {
    return { success: false, message: `创建文件失败: ${createResult.message}` };
  }

  const fileId = createResult.data.file_id;
  const uploadId = createResult.data.upload_id;
  
  // 快速上传（秒传）的情况
  if (createResult.data.rapid_upload || createResult.data.exist) {
    return {
      success: true,
      file_id: fileId,
      rapid: true,
      message: `文件已秒传到阿里云盘「${TARGET_FOLDER_NAME}」文件夹`
    };
  }

  let uploadUrl = createResult.data.part_info_list?.[0]?.upload_url;

  // 如果创建时没返回上传链接，单独获取
  if (!uploadUrl) {
    const getUrlResult = await fetchJSON(`${API_URL}/v2/file/get_upload_url`, {
      method: 'POST',
      headers: buildSignedHeaders(state, {
        'authorization': `${state.token_type || 'Bearer'} ${token}`
      }),
      body: JSON.stringify({
        drive_id: driveId,
        file_id: fileId,
        upload_id: uploadId,
        part_info_list: [{ part_number: 1 }]
      })
    });

    if (!getUrlResult.success) {
      return { success: false, message: `获取上传链接失败: ${getUrlResult.message}` };
    }
    uploadUrl = getUrlResult.data.part_info_list?.[0]?.upload_url;
  }

  // Step 2: 上传文件内容（PUT 到阿里云 OSS）
  if (uploadUrl) {
    const fileBuffer = fs.readFileSync(filePath);
    try {
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: fileBuffer,
        headers: {
          'Content-Length': fileSize.toString(),
          'referer': 'https://www.aliyundrive.com/'
        }
      });
      
      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        return { success: false, message: `上传文件内容失败: HTTP ${uploadResponse.status} - ${errText.substring(0, 100)}` };
      }
    } catch (err) {
      return { success: false, message: `上传文件内容失败: ${err.message}` };
    }
  } else {
    return { success: false, message: '无法获取上传链接' };
  }

  // Step 3: 完成上传
  const completeResult = await fetchJSON(`${API_URL}/v2/file/complete`, {
    method: 'POST',
    headers: buildSignedHeaders(state, {
      'authorization': `${state.token_type || 'Bearer'} ${token}`
    }),
    body: JSON.stringify({
      drive_id: driveId,
      file_id: fileId,
      upload_id: uploadId,
      ignoreError: true
    })
  });

  if (!completeResult.success) {
    return { success: false, message: `完成上传失败: ${completeResult.message}` };
  }

  return {
    success: true,
    file_id: fileId,
    message: `文件已同步到阿里云盘「${TARGET_FOLDER_NAME}」文件夹`
  };
}

// ========== 文件列表 ==========

/**
 * 获取阿里云盘中的文件列表
 */
async function listCloudFiles() {
  const state = loadState();
  const token = await getValidToken();
  if (!token) return { success: false, message: '未授权', files: [] };

  const driveResult = await getDriveId();
  if (!driveResult.success) return { success: false, files: [], message: driveResult.message };

  const folderResult = await ensureTargetFolder();
  if (!folderResult.success) return { success: false, files: [], message: folderResult.message };

  await ensureSession();

  const result = await fetchJSON(`${API_URL}/adrive/v3/file/list`, {
    method: 'POST',
    headers: buildSignedHeaders(state, {
      'authorization': `${state.token_type || 'Bearer'} ${token}`
    }),
    body: JSON.stringify({
      drive_id: driveResult.drive_id,
      parent_file_id: folderResult.folder_id,
      limit: 200,
      all: false,
      url_expire_sec: 1600,
      image_thumbnail_process: 'image/resize,w_400/format,jpeg',
      image_url_process: 'image/resize,w_1920/format,jpeg',
      video_thumbnail_process: 'video/snapshot,t_0,f_jpg,ar_auto,w_800',
      fields: '*',
      order_by: 'updated_at',
      order_direction: 'DESC'
    })
  });

  if (result.success) {
    const files = (result.data.items || []).map(item => ({
      name: item.name,
      file_id: item.file_id,
      type: item.type === 'file' 
        ? (item.content_type?.startsWith('video/') ? 'video' : 'image') 
        : 'folder',
      size: item.size || 0,
      uploadTime: item.updated_at || new Date().toISOString(),
      thumbnail: item.thumbnail || item.url || null
    }));
    return { success: true, files };
  }

  return { success: false, files: [], message: result.message };
}

// ========== 分享链接 ==========

/**
 * 创建分享链接（快传）
 * POST https://api.aliyundrive.com/adrive/v1/share/create
 */
async function createShareLink() {
  const state = loadState();
  const token = await getValidToken();
  if (!token) return { success: false, message: '未授权' };

  const driveResult = await getDriveId();
  if (!driveResult.success) return driveResult;

  const folderResult = await ensureTargetFolder();
  if (!folderResult.success) return folderResult;

  await ensureSession();

  const result = await fetchJSON(`${API_URL}/adrive/v1/share/create`, {
    method: 'POST',
    headers: buildSignedHeaders(state, {
      'authorization': `${state.token_type || 'Bearer'} ${token}`
    }),
    body: JSON.stringify({
      drive_file_list: [{
        drive_id: driveResult.drive_id,
        file_id: folderResult.folder_id
      }]
    })
  });

  if (result.success) {
    const d = result.data;
    return {
      success: true,
      share_url: d.share_url,
      share_id: d.share_id,
      share_name: d.share_name,
      share_title: d.share_title,
      full_share_msg: d.full_share_msg,
      expiration: d.expiration
    };
  }

  return { success: false, message: `创建分享链接失败: ${result.message}` };
}

// ========== 导出 ==========

module.exports = {
  loadState,
  saveState,
  isConnected,
  getConnectionStatus,
  connectWithRefreshToken,
  refreshAccessToken,
  getValidToken,
  getUserInfo,
  getDriveId,
  createSession,
  ensureSession,
  ensureTargetFolder,
  uploadFile,
  listCloudFiles,
  createShareLink,
  TARGET_FOLDER_NAME
};
