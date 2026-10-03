/* ================================================================
   像素蜘蛛 · 主逻辑
   严格对齐 index.html 的真实 DOM（id / class 以 index.html 为准）
   ================================================================ */

/* ---------- 版本号（由 bump.sh 自动维护，勿手改） ---------- */
const LOCAL_VERSION = '1.0.5';
const LOCAL_BUILD   = 5;

/* ---------- 常量 / 存储键 ---------- */
const API_URL = 'https://api.deepseek.com/chat/completions';

const K_APIKEY   = 'pixelspider_apikey';
const K_BOCHA    = 'pixelspider_bocha_key'; // 博查搜索 Key（独立键，设备级，不参与多账号隔离）
const K_WEBON    = 'pixelspider_web_on';   // 联网搜索开关（手动开启，不自动关闭；无 Key 时禁止开启）
const K_MODEL    = 'pixelspider_model';
const K_SESSIONS = 'pixelspider_sessions';
const K_CURRENT  = 'pixelspider_current';
const K_HISTORY  = 'pixelspider_history';   // 旧键，仅用于迁移
const K_NAME     = 'pixelspider_name';
const K_PROMPT   = 'pixelspider_prompt';
const K_CTX      = 'pixelspider_ctx';
const K_TEMP     = 'pixelspider_temp';        // 温度
const K_MAXTOK   = 'pixelspider_maxtok';      // 最大回复长度（0=不限）
const K_FONTSIZE = 'pixelspider_fontsize';    // 字体档位 small/normal/large
const K_STANCE   = 'pixelspider_stance';      // 对话姿态：serious|confide|roleplay|detach
const K_UNREAD   = 'pixelspider_unread';      // 未读会话 id 数组（JSON）
const K_STOREWARN= 'pixelspider_storewarn';   // 存储预警：上次已忽略的占用率（%），避免反复弹
const K_PROFILE  = 'pixelspider_profile';   // 个人资料（JSON）
const K_MOMENTS  = 'pixelspider_moments';   // 动态（朋友圈）
const K_KEYS     = 'pixelspider_keys';      // 多 API Key：{ list:[{id,name,key}], cur:id }
const K_SKIN     = 'pixelspider_skin';     // 皮肤：仅 b（p40 起锁定，A/C/默认已删）
const K_RADIUS   = 'pixelspider_radius';   // 圆角风格：default / round / square
const K_BUBBLE   = 'pixelspider_bubble';   // 气泡形状：default / sym / soft / tail
const K_LANG     = 'pixelspider_lang';     // 界面语言：zh / zhHant / en
const K_FONTYPE  = 'pixelspider_fontype';  // 字体样式：system / hei / song
const K_TEXTBOLD = 'pixelspider_textbold'; // 字体加粗：on / off
const K_TEXTITAL = 'pixelspider_textital'; // 斜体：on / off
const K_CHATBG   = 'pixelspider_chatbg';   // 聊天背景（旧键，仅用于迁移）
const K_CHATBG_P = 'pixelspider_chatbg_';  // 聊天背景（按皮肤分键：+default/a/b/c）
const K_PAGEBG_P = 'pixelspider_pagebg_b_'; // 第 28 轮：B 皮肤页面背景（按页面分键：+msg/contacts/moments/me）

/* ---------- 【联网工具】工具声明（第 29 轮） ----------
   路线②：每次对话都把这套声明注入 system，让模型自己决定要不要调工具。
   模型只需输出一行形如 [SEARCH: 关键词] 的标记即可，前端拦截调接口、回填再问一轮。
   共 4 项：搜索 / 天气 / 汇率 / 国家信息——全部无 Key 或独立 Key，不影响模型 Key。 */
const TOOL_DECL = [
  '【工具能力】你可以在需要时「调用工具」来获取实时信息。规则如下：',
  '1. 需要实时信息（新闻、时效性事实、最新数据、你不确定的内容）时，先输出一行工具标记，不要直接编造答案。',
  '2. 工具标记必须单独占一行，格式严格如下（方括号 + 英文大写工具名 + 英文冒号 + 空格 + 参数）：',
  '   [SEARCH: 搜索关键词]            —— 联网搜索（例：[SEARCH: 今天北京天气]）',
  '   [WEATHER: 城市名]               —— 查天气（例：[WEATHER: 上海]）',
  '   [RATE: 100 USD CNY]             —— 查汇率（例：[RATE: 100 USD CNY]）',
  '   [COUNTRY: 国家名]               —— 查国家信息（例：[COUNTRY: 日本]）',
  '3. 只输出工具标记那一行，不要额外解释、不要加括号或引号。系统会自动执行并把结果回传给你。',
  '4. 拿到工具结果后，用你当前的人设口吻自然地转述给用户，结尾附上信息来源（如网站名）。',
  '5. 不需要实时信息时（闲聊、写作、解释概念、代码等）正常回答，不要调用工具。',
  '6. 一次只调用一个工具；若确实需要多个，先调最关键的，拿到结果后视情况再调下一个。'
].join('\n');

function buildToolDecl() {
  return TOOL_DECL;
}

/* ---------- 【多账号隔离】账号作用域（第 4 轮） ----------
   目标：聊天记录/人设卡/资料等「账号数据」按账号独立；
        API Key / 邮箱列表 / 皮肤字体背景等「设备级」保持全局。
   实现：白名单前缀 + ACC_SCOPE 后缀，读写统一走 LS.*
   注意：localStorage.clear() / length / key(i) 不走本封装。 */
var K_ACC_SCOPE = 'pixelspider_acc_scope';  // 设备级键：记住上次的作用域（不隔离）
var ACC_SCOPE = ':local';            // 未登录 = ':local'；登录后 = ':u-<uid>'
/* 启动时从设备级键恢复作用域。
   必须在此处（任何 LS 读写之前）恢复，否则每次加载都会退回 :local，
   导致 initAuth 里 getAccScopeUid() 恒为 null → 反复 reload（页面卡在 splash）。 */
try {
  var _sv = localStorage.getItem(K_ACC_SCOPE);
  if (_sv && _sv.indexOf(':u-') === 0) ACC_SCOPE = _sv;
} catch (e) {}

/* 需要按账号隔离的键（完整键名 或 前缀，前缀以 _ 结尾即视为前缀族） */
var ACC_PREFIX_KEYS = [
  'pixelspider_sessions',
  'pixelspider_current',
  'pixelspider_personas',
  'pixelspider_persona_cur',
  'pixelspider_profile',
  'pixelspider_name',
  'pixelspider_moments',
  'pixelspider_moment_imgs',
  'pixelspider_unread',
  'pixelspider_helpmsgs',
  'pixelspider_prompt',
  'pixelspider_ctx',
  'pixelspider_temp',
  'pixelspider_maxtok',
  'pixelspider_stance',
  'pixelspider_psy_',
  'pixelspider_think_',
  'pixelspider_mom_auto',
  'pixelspider_mom_cmt'
];

function isAccKey(k) {
  if (!k) return false;
  for (var i = 0; i < ACC_PREFIX_KEYS.length; i++) {
    var p = ACC_PREFIX_KEYS[i];
    if (p.charAt(p.length - 1) === '_') {          // 前缀族
      if (k.indexOf(p) === 0) return true;
    } else {                                        // 完整键名
      if (k === p) return true;
      /* 兼容 mom_auto / mom_cmt 后面直接拼 id 的写法 */
      if (k.indexOf(p) === 0 && k.charAt(p.length) === '_') return true;
    }
  }
  return false;
}

function scoped(k) {
  return isAccKey(k) ? (k + ACC_SCOPE) : k;
}

var LS = {
  get: function (k) {
    try { return localStorage.getItem(scoped(k)); } catch (e) { return null; }
  },
  set: function (k, v) {
    try { localStorage.setItem(scoped(k), v); } catch (e) {}
  },
  del: function (k) {
    try { localStorage.removeItem(scoped(k)); } catch (e) {}
  },
  /* 原始读写（绕过作用域），仅用于迁移/管理场景 */
  rawGet: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  rawSet: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  rawDel: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* 当前账号作用域（登录时由 onCloudLogin 调用）
   ⚠️ 必须持久化到设备级键，否则页面 reload 后 ACC_SCOPE 会退回 ':local'，
   initAuth / onAuthSuccess 里 getAccScopeUid() !== uid 恒成立 → 无限 reload。 */
function setAccScope(uid) {
  ACC_SCOPE = uid ? (':u-' + uid) : ':local';
  try {
    if (uid) localStorage.setItem(K_ACC_SCOPE, ACC_SCOPE);
    else localStorage.removeItem(K_ACC_SCOPE);
  } catch (e) {}
}

/* 默认 API Key：留空，请在左侧菜单「API Key」中自行填写。
   不要在此硬编码真实 key —— 打包/分享时会把密钥一起带出去。 */
const DEFAULT_APIKEY = '';
const DEFAULT_NAME   = '像素蜘蛛';

/* ---------- 厂商注册表（多厂商模型） ----------
   模型 key 统一写作「厂商/模型」形式，如 deepseek/deepseek-flash。
   base 写完整 URL（各家路径差异大，不拼接）。
   models[模型名] = { tag:'能力/价格简述', desc:'一句话说明' } */
const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek 深度求索',
    site: 'https://platform.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    base: 'https://api.deepseek.com/chat/completions',
    keyHint: 'sk- 开头',
    keyGuard: /^sk-/,
    models: {
      'deepseek-flash':  { tag: 'V4.1 Flash · 支持看图 · 便宜', desc: '1M 上下文，日常首选' },
      'deepseek-v4-pro': { tag: 'V4 Pro · 推理更强 · 较贵', desc: '复杂任务，不支持看图' }
    }
  },
  zhipu: {
    name: '智谱 GLM',
    site: 'https://open.bigmodel.cn',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    base: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    keyHint: '形如 xxxxxxxx.xxxxxxxx（含一个点）',
    keyGuard: /^[0-9a-zA-Z]{16,}\.[0-9a-zA-Z]{16,}$/,
    models: {
      'glm-5.1': { tag: 'GLM 5.1 · 均衡', desc: '通用对话，中文表现好' },
      'glm-5.2': { tag: 'GLM 5.2 · 更强', desc: '复杂任务，能力更强' }
    }
  },
  gemini: {
    name: 'Google Gemini',
    site: 'https://aistudio.google.com',
    keyUrl: 'https://aistudio.google.com/apikey',
    base: 'https://generativelanguage.googleapis.com/v1beta/models',
    keyHint: 'AIza 开头',
    keyGuard: /^AIza/,
    models: {
      'gemini-2.5-pro':       { tag: 'Gemini 2.5 Pro · 强推理', desc: '长上下文，复杂任务' },
      'gemini-3.1-flash-lite':{ tag: 'Gemini 3.1 Flash Lite · 快而省', desc: '轻量任务，响应最快' },
      'gemini-3.1-pro':       { tag: 'Gemini 3.1 Pro · 旗舰', desc: '综合能力最强' },
      'gemini-3.5-flash':     { tag: 'Gemini 3.5 Flash · 快', desc: '速度与质量兼顾' }
    }
  },
  anthropic: {
    name: 'Anthropic Claude',
    site: 'https://console.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    base: 'https://api.anthropic.com/v1/messages',
    keyHint: 'sk-ant- 开头',
    keyGuard: /^sk-ant-/,
    models: {
      'claude-haiku-4.5':  { tag: 'Haiku 4.5 · 快而省', desc: '轻量任务，低成本' },
      'claude-sonnet-4.5': { tag: 'Sonnet 4.5 · 均衡', desc: '日常主力，性价比高' },
      'claude-sonnet-4.6': { tag: 'Sonnet 4.6 · 更强', desc: '复杂任务，能力提升' },
      'claude-opus-4.5':   { tag: 'Opus 4.5 · 旗舰', desc: '最强推理，价格最高' },
      'claude-opus-4.6':   { tag: 'Opus 4.6 · 旗舰', desc: '最强推理，价格最高' },
      'claude-opus-4.7':   { tag: 'Opus 4.7 · 旗舰', desc: '最强推理，价格最高' }
    }
  },
  openai: {
    name: 'OpenAI GPT',
    site: 'https://platform.openai.com',
    keyUrl: 'https://platform.openai.com/api-keys',
    base: 'https://api.openai.com/v1/chat/completions',
    keyHint: 'sk- 开头',
    keyGuard: /^sk-/,
    models: {
      'gpt-4.1-mini': { tag: 'GPT 4.1 Mini · 快而省', desc: '轻量任务，成本低' },
      'gpt-5.4-mini': { tag: 'GPT 5.4 Mini · 均衡', desc: '日常对话，性价比高' },
      'gpt-5.4':      { tag: 'GPT 5.4 · 强', desc: '复杂任务，能力更强' },
      'gpt-5.5':      { tag: 'GPT 5.5 · 旗舰', desc: '综合能力最强' }
    }
  }
};
/* 旧代码兼容：模型名（不带前缀）→ tag 的扁平表 */
const MODELS = (() => {
  const m = {};
  Object.keys(PROVIDERS).forEach(pid => {
    Object.keys(PROVIDERS[pid].models).forEach(mid => {
      m[mid] = PROVIDERS[pid].models[mid];
    });
  });
  return m;
})();
/* 拆分「厂商/模型」；旧裸值（如 deepseek-flash）自动补 deepseek/ 前缀 */
function parseModel(v) {
  v = (v || '').trim();
  if (!v) return { pid: 'deepseek', mid: 'deepseek-flash' };
  const i = v.indexOf('/');
  if (i > 0) {
    const pid = v.slice(0, i), mid = v.slice(i + 1);
    if (PROVIDERS[pid]) return { pid, mid };
  }
  // 旧格式：在 deepseek 里找得到就用 deepseek
  if (PROVIDERS.deepseek.models[v]) return { pid: 'deepseek', mid: v };
  // 在其它厂商里找同名模型
  for (const pid in PROVIDERS) {
    if (PROVIDERS[pid].models[v]) return { pid, mid: v };
  }
  return { pid: 'deepseek', mid: v };
}
/* 拼回存储字符串 */
function joinModel(pid, mid) { return pid + '/' + mid; }
/* 取当前模型字符串（含迁移） */
function curModelStr() {
  const raw = LS.get(K_MODEL) || 'deepseek/deepseek-flash';
  const p = parseModel(raw);
  const full = joinModel(p.pid, p.mid);
  if (full !== raw) { try { LS.set(K_MODEL, full); } catch (e) {} }
  return full;
}
/* 按厂商 baseURL 取请求地址 */
function modelBase(v) {
  const p = parseModel(v);
  return (PROVIDERS[p.pid] || PROVIDERS.deepseek).base;
}
/* 厂商识别顺序：前缀越独特的排前面（sk-ant- 必须先于 sk-） */
const PROVIDER_ORDER = ['anthropic', 'gemini', 'zhipu', 'openai', 'deepseek'];
/* 猜厂商（Key 前缀 → 厂商 id；猜不准回落 deepseek） */
function guessProvider(key) {
  key = (key || '').trim();
  if (!key) return 'deepseek';
  for (const pid of PROVIDER_ORDER) {
    const p = PROVIDERS[pid];
    if (p && p.keyGuard && p.keyGuard.test(key)) return pid;
  }
  return 'deepseek';
}
/* 校验 Key 是否与所选厂商匹配；返回 {ok, guessed, msg} */
function checkKeyForProvider(key, pid) {
  key = (key || '').trim();
  const p = PROVIDERS[pid];
  if (!p) return { ok: false, guessed: 'deepseek', msg: '未知厂商' };
  if (!key) return { ok: false, guessed: pid, msg: '' };  // 空 Key 由调用方另行提示
  const guessed = guessProvider(key);
  if (guessed === pid) return { ok: true, guessed, msg: '' };
  const want = PROVIDERS[pid] ? PROVIDERS[pid].name : pid;
  const have = PROVIDERS[guessed] ? PROVIDERS[guessed].name : guessed;
  /* 特例：openai 与 deepseek 都是 sk- 开头，互认，不报错 */
  if (pid === 'deepseek' && guessed === 'openai') return { ok: true, guessed: pid, msg: '' };
  if (pid === 'openai' && guessed === 'deepseek') return { ok: true, guessed: pid, msg: '' };
  return {
    ok: false,
    guessed,
    msg: 'Key 与厂商不匹配：\n\n你选的是「' + want + '」，\n但这把 Key 看起来属于「' + have + '」。\n\n' + want + ' 的 Key ' + (p.keyHint ? '应形如 ' + p.keyHint : '格式不符') + '。\n请确认厂商，或换成对应厂商的 Key。'
  };
}

/* ---------- 运行期状态 ---------- */
let msgList  = [];     // 当前会话消息列表
let sessions = [];     // 全部会话
let curSid   = '';     // 当前会话 id
let sending  = false;  // 是否正在发送
let __abortCtrl = null; // 当前请求的 AbortController（用于「停止生成」）
let editing  = -1;     // 正在编辑（重发）的消息索引，-1 表示无

/* 由 init() 赋值：打开人设卡页时把已存人设填回表单 */
let loadPromptToForm = function () {};

/* 正在编辑的卡 id（从联系人详情页进入编辑页时设置；空 = 跟随当前使用卡） */
let editingPersonaId = '';
function targetPersonaId() {
  if (editingPersonaId && getPersonaById(editingPersonaId)) return editingPersonaId;
  return curPersonaId();
}

/* ---------- 工具函数 ---------- */
function $(id) { return document.getElementById(id); }

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* 时间戳格式化：今天 M月D日 HH:MM / 跨年 YYYY年M月D日 HH:MM
   withSec=true 时精确到秒（目前仅聊天页消息气泡用），其余场景保持到分 */
function fmtTime(ts, withSec) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const hm = p(d.getHours()) + ':' + p(d.getMinutes()) + (withSec ? ':' + p(d.getSeconds()) : '');
  const md = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  if (d.getFullYear() === now.getFullYear()) return md;
  return d.getFullYear() + '年' + md;
}

/* 粗略估算 token：中文 1 字 ≈ 1 token，其他 4 字符 ≈ 1 token */
function estTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of String(text)) {
    if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch)) cjk++;
  }
  const other = String(text).length - cjk;
  return Math.ceil(cjk + other / 4);
}

/* 转义 HTML（用户消息 / 兜底显示） */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

/* Markdown 渲染（marked 本地化后挂 window.marked） */
function mdRender(text) {
  const t = text || '';
  if (window.marked && typeof marked.parse === 'function') {
    try { return marked.parse(t); } catch (e) { return esc(t); }
  }
  return esc(t);
}

/* ---------- 会话读取 / 保存 ---------- */
function loadAll() {
  try {
    sessions = JSON.parse(LS.get(K_SESSIONS) || '[]');
  } catch (e) { sessions = []; }

  if (!Array.isArray(sessions) || !sessions.length) {
    // 空会话时不再自动造「新对话」空壳，保持为空，用户从联系人页进入聊天。
    // 仅当存在旧版单条历史（K_HISTORY）时才迁移成一条会话。
    let old = [];
    try { old = JSON.parse(LS.get(K_HISTORY) || '[]'); } catch (e) { old = []; }
    if (Array.isArray(old) && old.length) {
      const sid = uid();
      sessions = [{ id: sid, title: '新对话', msgs: old, ts: Date.now() }];
      curSid = sid;
    } else {
      sessions = [];
      curSid = '';
    }
    persist();
  } else {
    curSid = LS.get(K_CURRENT) || sessions[0].id;
    if (!sessions.some(s => s.id === curSid)) curSid = sessions[0].id;
  }

  const cur = sessions.find(s => s.id === curSid);
  msgList = (cur && Array.isArray(cur.msgs)) ? cur.msgs : [];
}

/* 图片已在选图时压缩到几十 KB（compressImage），可直接存入 localStorage，
   不再剥离，确保会话重开后旧图仍能显示、可点击放大。 */
function stripImages(list) {
  return list;
}
function persist() {
  const slim = sessions.map(s => Object.assign({}, s, { msgs: stripImages(s.msgs || []) }));
  try {
    LS.set(K_SESSIONS, JSON.stringify(slim));
    LS.set(K_CURRENT, curSid);
  } catch (e) {
    console.warn('存储写入失败（可能超限）', e);
  }
  // 云同步钩子（仅当开启「聊天记录同步」且已登录时才真正发请求）
  if (typeof cloudOnLocalChange === 'function') { try { cloudOnLocalChange('chats'); } catch (e) {} }
}

function save() {
  const cur = sessions.find(s => s.id === curSid);
  if (cur) {
    const grew = (msgList.length !== (cur.msgs ? cur.msgs.length : 0));
    cur.msgs = msgList;
    // 仅当消息条数发生变化（真的聊了新内容）才推进会话时间，
    // 避免「点开会话 / 改标题」这类操作把时间戳刷成当前时刻
    if (grew) cur.ts = Date.now();
  }
  persist();
}

/* 自动命名：取第一条用户消息前 12 字 */
function autoTitle(sid) {
  const s = sessions.find(x => x.id === sid);
  if (!s) return;
  if (s.title && s.title !== '新对话') return;
  const first = (s.msgs || []).find(m => m.role === 'user');
  if (first && first.content) {
    const c = String(first.content).replace(/\n/g, ' ');
    s.title = c.slice(0, 12) + (c.length > 12 ? '…' : '');
  }
}

/* ---------- 未读红点 ---------- */
function getUnread() {
  try { return JSON.parse(LS.get(K_UNREAD) || '[]') || []; }
  catch (e) { return []; }
}
function isUnread(sid) {
  return getUnread().indexOf(sid) >= 0;
}
function setUnread(sid, on) {
  let list = getUnread().filter(x => x !== sid);
  if (on) list.push(sid);
  try { LS.set(K_UNREAD, JSON.stringify(list)); } catch (e) {}
}
/* ---------- 渲染 ---------- */

/* 剥离括号心理描写：
   逐行扫描，维护「是否在括号块内」的状态。
   - 行首出现（或( → 进入括号块；
   - 行尾出现）或) → 退出括号块（该行 ] 之后若还有正文，保留尾部正文）；
   - 块内所有行整行丢弃；块外的行原样保留。
   这样能同时吃掉①独立成行 ②跨多行 的括号心理描写。*/
function stripPsyForSplit(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const keep = [];
  let inPsy = false;              // 是否处于括号块内部
  for (const line of lines) {
    const t = line.trim();
    if (!inPsy) {
      const openCh = t.charAt(0);
      if (t && (openCh === '（' || openCh === '(')) {
        // 本行是否同时闭合（同行有右括号）
        const closeAt = t.search(/[）)]/);
        if (closeAt >= 0) {
          // 同行闭合：抠掉（…）这段，保留其前后的正文
          const head = t.slice(0, 0);                       // 左括号前的字符（开头即括号时为空）
          const tail = t.slice(closeAt + 1).trim();         // 右括号后的正文
          const rest = (head + (tail ? ' ' + tail : '')).trim();
          if (rest) keep.push(rest);
        } else {
          // 只开了没闭合 → 进入括号块，本行整行丢弃
          inPsy = true;
        }
        continue;
      }
      keep.push(line);            // 普通行照常保留
    } else {
      // 括号块内：找右括号，找到就退出；该行右括号之后的正文保留
      const closeAt = t.search(/[）)]/);
      if (closeAt >= 0) {
        inPsy = false;
        const tail = t.slice(closeAt + 1).trim();
        if (tail) keep.push(tail);
      }
      // 块内且无右括号 → 整行丢弃
    }
  }
  return keep.join('\n').trim();
}

/* 流式专用：剥离「正在生成中」的括号心理描写。
   与 stripPsyForSplit 的差别：不要求括号闭合 —— 一行只要以（或( 开头，
   整行即视为心理描写（防止流式中间态正则认不出、导致括号内容一闪而过）。
   只要「显示思考」关着，就从流式源头把括号内容掐掉，全程不出现。 */
function stripPsyLive(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const keep = [];
  let inPsy = false;
  for (const line of lines) {
    const t = line.trim();
    if (inPsy) {
      const closeAt = t.search(/[）)]/);
      if (closeAt >= 0) {
        inPsy = false;
        const tail = t.slice(closeAt + 1).trim();
        if (tail) keep.push(tail);
      }
      continue;                       // 块内且未闭合 → 整行丢弃
    }
    const c0 = t.charAt(0);
    if (t && (c0 === '（' || c0 === '(')) {
      const closeAt = t.search(/[）)]/);
      if (closeAt >= 0) {
        const tail = t.slice(closeAt + 1).trim();   // 同行闭合：保留右括号后正文
        if (tail) keep.push(tail);
      } else {
        inPsy = true;                 // 只开了没闭合 → 吞掉后续行直到出现右括号
      }
      continue;
    }
    keep.push(line);
  }
  return keep.join('\n').trim();
}

/* v3.1：原先这里有个「打字机」函数（逐字打进气泡 + 25ms/字延迟），
   模拟真人打字。按用户要求已整体移除——回复现在由流式接口原样、即时渲染。 */

function buildMsgEl(m, idx) {
  const wrap = document.createElement('div');
  // 思考链默认收起：点一下正文里的 Thinking 才展开（见下方 m.think 分支）
  wrap.className = 'msg ' + (m.role === 'user' ? 'user' : 'ai');
  wrap.dataset.idx = idx;

  // ---- v6: 会话内搜索命中标记 ----
  const cfHitMsg = !!(cfQuery && (m.content || '').toLowerCase().indexOf(cfQuery.toLowerCase()) >= 0);
  if (cfHitMsg) wrap.classList.add('msg-hit');

  // ---- 气泡内容都塞进 .msg-body（气泡 + 时间）----
  // 【v7 改动】聊天气泡不再显示头像：移除了 .msg-side 头像竖列。
  // 原因：有无头像时气泡起点不一致（0px vs 48px），导致气泡左边缘参差。
  // 去掉头像后所有气泡统一起点，短句贴合、长句到 78% 封顶。
  const body = document.createElement('div');
  body.className = 'msg-body';

  // 图片（如果有）
  if (m.image) {
    const iw = document.createElement('div');
    iw.className = 'msg-img';
    const img = document.createElement('img');
    img.src = m.image;
    iw.appendChild(img);
    iw.onclick = () => openPreview(m.image);
    body.appendChild(iw);
  } else if (m.hasImage) {
    // 兼容旧数据：早期版本剥离过图片，只剩标记
    const ph = document.createElement('div');
    ph.className = 'msg-img-gone';
    ph.textContent = T('🖼 图片已清理（旧数据）');
    body.appendChild(ph);
  }

  // ---- 渲染：一条消息永远只画一个气泡（历史记录绝不拆条） ----
  // 开关归属：按「这条消息写下来时所属的人设卡」判定，不是当前对话卡。
  // 老数据没有 pid（那时没记），一律按「无卡」处理 → 全部特性关闭，只画纯正文。
  const mPid = msgPidOf(m);
  if (m.content) {
    // 思考链：气泡上方，默认收起（只对 AI 消息、且有 think 时）
    if (m.role === 'assistant') {
      // Thinking 块：只放模型思考链原文（受「显示推理过程」开关控制）
      if (thinkOn(mPid) && m.think && String(m.think).trim()) {
        const tk = buildThinkEl(String(m.think).trim());
        if (tk) body.appendChild(tk);
      }
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    paintBubbleContent(bubble, m.content, m, cfHitMsg);
    body.appendChild(bubble);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const t = fmtTime(m.ts, true);
  const len = (m.content || '').length;
  meta.textContent = (t ? t + ' · ' : '') + len + T(' 字');

  body.appendChild(meta);   /* meta 放进 msg-body：竖排 = 气泡 + 时间戳，避免 wrap 布局抢宽 */
  wrap.appendChild(body);

  bindMsgLongPress(wrap, idx);
  return wrap;
}

/* 把一段文本渲染进气泡（用户原文 / AI 走 psyRender + 高亮） */
function paintBubbleContent(bubble, text, m, cfHitMsg) {
  if (m.quote && m.quote.text) {
    const q = document.createElement('div');
    q.className = 'q-inner';
    const who = document.createElement('span');
    who.textContent = (m.quote.who || '') + '：';
    q.appendChild(who);
    q.appendChild(document.createTextNode(String(m.quote.text).slice(0, 60)));
    bubble.appendChild(q);
  }
  if (m.role === 'user') {
    if (cfHitMsg) bubble.innerHTML = hlText(text, cfQuery);
    else bubble.appendChild(document.createTextNode(text));
  } else {
    const cw = document.createElement('div');
    cw.innerHTML = psyRender(text || '', psyOn(msgPidOf(m)));
    while (cw.firstChild) bubble.appendChild(cw.firstChild);
    if (cfHitMsg) hlInNode(bubble, cfQuery);
  }
}

/* 长按菜单绑定：绑在单个 .msg 上 */
function bindMsgLongPress(el, idx) {
  let pressTimer = null;
  el.addEventListener('touchstart', () => {
    pressTimer = setTimeout(() => showMsgMenu(idx), 500);
  }, { passive: true });
  el.addEventListener('touchend', () => { if (pressTimer) clearTimeout(pressTimer); }, { passive: true });
  el.addEventListener('touchmove', () => { if (pressTimer) clearTimeout(pressTimer); }, { passive: true });
}

/* 渲染消息列表。
   mode==='enter'：开屏 / 切换会话 —— 渲染并定位到底部后，
                   给「当前屏幕可见的那几条」挂 .msg-anim 播一次整齐入场；
                   屏幕外的消息不挂（看不见，也避免整屏重排导致跳动）。
   其它情况（发消息 / 流式重渲 / 操作后刷新）：历史消息一律静止不播动画。
   新消息的入场动画由发送流程单独处理（见 sendMsg）。*/
function renderAll(mode) {
  const box = $('chat');
  if (!box) return;
  box.innerHTML = '';
  let lastDay = null;
  msgList.forEach((m, i) => {
    // ---- 日期分隔标签（今天 / 昨天 / MM-DD / YYYY-MM-DD）----
    const day = dayKey(m.ts);
    if (day && day !== lastDay) {
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      const sp = document.createElement('span');
      sp.textContent = dayLabel(m.ts);
      sep.appendChild(sp);
      box.appendChild(sep);
      lastDay = day;
    }
    const el = buildMsgEl(m, i);
    box.appendChild(el);
  });
  scrollBottom(true);   // 重渲/开屏一律瞬时定位，不要平滑
  // 开屏/切会话：定位到底后，只给视口内可见的气泡挂入场动画
  if (mode === 'enter') markVisibleMsgsAnim();
  // 重绘后刷新「回到底部」按钮状态
  if (typeof window.__updBackTop === 'function') window.__updBackTop();
  // p43：气泡磨砂背景对齐（等一帧，确保布局已定）
  scheduleLayoutBubbleBg();
}

/* 给 #chat 里「当前视口可见」的 .msg 挂 .msg-anim（播放一次入场动画）。
   前提：已经滚动到底部。可见区 = 容器底部往上 clientHeight 的范围。
   屏幕外的消息不动，避免整屏重排 → 屏幕跳。*/
function markVisibleMsgsAnim() {
  const box = $('chat');
  if (!box) return;
  const topEdge = box.scrollHeight - box.clientHeight;   // 已到底，visible 起始线
  box.querySelectorAll('.msg').forEach(el => {
    el.classList.remove('msg-anim');            // 先清，保证是干净的一次播放
    const bottom = el.offsetTop + el.offsetHeight;
    if (bottom >= topEdge - 4) {                // 与可见区底部有交集即算可见
      // 强制回流后挂类，确保动画真的重播
      void el.offsetWidth;
      el.classList.add('msg-anim');
      attachAnimEndCleanup(el, 'msg-anim');
    }
  });
}

/* 给指定元素挂入场动画（开屏/切会话用，含位移动画）。挂在渲染之后调用，保证动画生效。*/
function animMsgEl(el) {
  if (!el) return;
  el.classList.remove('msg-anim-flat');
  el.classList.remove('msg-anim');
  void el.offsetWidth;
  el.classList.add('msg-anim');
  attachAnimEndCleanup(el, 'msg-anim');
}
/* 底部新消息专用：只做纯淡入，不带 translateY，所以不会和滚动到底打架、不跳。*/
function animMsgElFlat(el) {
  if (!el) return;
  el.classList.remove('msg-anim');
  el.classList.remove('msg-anim-flat');
  void el.offsetWidth;
  el.classList.add('msg-anim-flat');
  attachAnimEndCleanup(el, 'msg-anim-flat');
}

/* p49：入场动画结束/超时后立刻摘掉动画类。
   原因：msgFadeIn 的 0% 帧是 opacity:0，opacity 过渡会让元素被提升到独立合成层；
   而气泡用的是 backdrop-filter，合成层里采不到身后背景 → 气泡「透明」。
   类一摘，元素回普通样式层，backdrop-filter 立刻恢复采样。*/
function attachAnimEndCleanup(el, cls) {
  if (!el) return;
  cls = cls || 'msg-anim-flat';
  const kill = function () {
    el.classList.remove('msg-anim');
    el.classList.remove('msg-anim-flat');
    el.removeEventListener('animationend', kill);
  };
  // 同一元素重复挂类时，先清掉上一次的监听，避免堆积
  if (el.__animKill) {
    el.removeEventListener('animationend', el.__animKill);
    if (el.__animTimer) { clearTimeout(el.__animTimer); el.__animTimer = null; }
  }
  el.__animKill = kill;
  el.addEventListener('animationend', kill);
  // 兜底：WebView 某些情况下不派发 animationend，用定时器强摘
  el.__animTimer = setTimeout(kill, 700);
}

/* 「正在输入…」提示条显隐 */
function showTyping(on) {
  const bar = $('typingBar');
  if (!bar) return;
  bar.classList.toggle('show', !!on);
}

/* 一天的唯一标识，用于比较两天是否为同一天 */
function dayKey(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/* 分隔标签文案：今天 / 昨天 / 更早 */
function dayLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return T('今天');
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return T('昨天');
  const md = p(d.getMonth() + 1) + '-' + p(d.getDate());
  if (d.getFullYear() === now.getFullYear()) return md;
  return d.getFullYear() + '-' + md;
}

/* 滚到底部。
   instant=true 用于开屏/切会话（直接定位，不要动画）；
   instant=false 用于流式输出（平滑跟随，减少跳动感）。*/
function scrollBottom(instant) {
  const box = $('chat');
  if (!box) return;
  try {
    box.scrollTo({ top: box.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
  } catch (e) {
    box.scrollTop = box.scrollHeight;   // 旧 WebView 兜底
  }
}
/* 开屏定位专用：等布局稳定后一次性跳到底，避免「屏幕跳一下」 */
function scrollBottomAfterPaint() {
  const box = $('chat');
  if (!box) return;
  box.scrollTop = box.scrollHeight;
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

/* ================================================================
   p43：气泡「自己糊背景」——精确对齐 JS
   ----------------------------------------------------------------
   目标：每个气泡伪层里显示的那块背景，必须和屏幕上该气泡位置
         背后的背景图完全对得上（滚动时也跟着变）。

   坐标系（关键常量，改 CSS 必须同步改这里）：
     · 祖先层 #pageMsg::before —— inset:0 再 scale(BG_SCALE=1.06)，
       图是 background-size:cover。
     · 气泡层 .bubble::before —— inset:-26px，无 transform。
   算法：
     1) 算出图在祖先伪层内 cover 后的绘制尺寸 IW×IH 与居中偏移 ox/oy。
     2) 气泡伪层左上角在 #pageMsg 坐标系里的位置 (bx, by)。
     3) background-size 写 IW×IH（绝对像素，两层同图同规格）；
        background-position 写 (ox-bx, oy-by)，即把图片原点挪到
        该让气泡看到的那块上。
   ================================================================ */
const BG_SCALE   = 1.06;   // #pageMsg::before 的 scale
const BG_INSET   = 26;     // .bubble::before 的 inset（px）
let   _bgImgCache = { url: '', w: 0, h: 0 };

/* 解析 --chat-bg 里的图片地址；无图返回 '' */
function bgOfChatPage() {
  const pg = document.getElementById('pageMsg');
  if (!pg) return '';
  return pg.style.getPropertyValue('--chat-bg') || '';
}
/* 取图片原始尺寸（带缓存）。拿不到就 callback('')。 */
function withBgImageSize(url, cb) {
  if (!url) return cb(null);
  if (_bgImgCache.url === url && _bgImgCache.w) {
    return cb({ w: _bgImgCache.w, h: _bgImgCache.h });
  }
  const img = new Image();
  img.onload = function () {
    _bgImgCache = { url: url, w: img.naturalWidth || 0, h: img.naturalHeight || 0 };
    cb({ w: _bgImgCache.w, h: _bgImgCache.h });
  };
  img.onerror = function () { cb(null); };
  img.src = url;
}
/* 把 --bg-size / --bg-pos 写进每个气泡。
   p44 → 方案②：背景层改为「#chat 自身 + background-attachment:local」，
   即背景图【跟随内容一起滚】。因此：
     · 坐标系 = #chat 的内容坐标系（元素 offsetLeft/offsetTop 所在系）；
     · 与滚动位置【无关】→ 滚动时无需重算，本函数只在渲染/换图时算一次。
   计算内容：
     1) 取 #chat 内容总尺寸 CW×CH（clientWidth × scrollHeight）。
     2) 对图做 cover 铺满 CW×CH，得绘制尺寸 IW×IH 与居中偏移 ox/oy。
     3) 气泡伪层左上角在内容系里的位置 (bx, by) = bubble.offsetLeft/Top - BG_INSET。
     4) bg-pos = (ox-bx, oy-by)。
*/
function layoutBubbleBg() {
  // p48：方案级转向 —— 气泡已改为 Operit 同款的【真磨砂】
  //   （气泡本体直接 backdrop-filter，见 style.css 6606 行），
  //   不再需要「给每个气泡算背景图位置(--bg-size/--bg-pos)」。
  //   本函数保留为空实现（调用点不动），避免白算与残留内联样式。
  return;
}
/* 滚动/尺寸变化时重算（节流） */
let _bgRafPending = false;
function scheduleLayoutBubbleBg() {
  if (_bgRafPending) return;
  _bgRafPending = true;
  requestAnimationFrame(function () {
    _bgRafPending = false;
    layoutBubbleBg();
  });
}

function openPreview(src) {
  const p = $('imgPreview');
  const img = $('previewImg');
  if (!p || !img) return;
  img.src = src;
  p.classList.add('open');
}

/* ---------- 个人资料 ---------- */
/* 字段定义：id 与 index.html 中的输入框一一对应 */
const PROFILE_FIELDS = [
  { key: 'nickname',  el: 'pfNickname',  label: '称呼' },
  { key: 'age',       el: 'pfAge',       label: '年龄' },
  { key: 'gender',    el: 'pfGender',    label: '性别' },
  { key: 'job',       el: 'pfJob',       label: '职业/身份' },
  { key: 'character', el: 'pfCharacter', label: '性格' },
  { key: 'look',      el: 'pfLook',      label: '外貌' },
  { key: 'cloth',     el: 'pfCloth',     label: '衣着' },
  { key: 'style',     el: 'pfStyle',     label: '说话/沟通偏好' },
  { key: 'city',      el: 'pfCity',      label: '所在地' },
  { key: 'status',    el: 'pfStatus',    label: '当前状态' },
  { key: 'like',      el: 'pfLike',      label: '喜好' },
  { key: 'hate',      el: 'pfHate',      label: '厌恶' },
  { key: 'skill',     el: 'pfSkill',     label: '擅长' },
  { key: 'weak',      el: 'pfWeak',      label: '短板/弱点' },
  { key: 'taboo',     el: 'pfTaboo',     label: '禁忌底线' },
  { key: 'extra',     el: 'pfExtra',     label: '自由备注' }
];

function getProfile() {
  try {
    const o = JSON.parse(LS.get(K_PROFILE) || '{}');
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}

/* 「我」在界面上显示的名字：
   优先个人资料里的「称呼」→ 旧备注名 → 默认「我」
   注意：这是"我是谁"，跟人设卡(跟 AI 说话的身份)无关 */
function myDisplayName() {
  const p = getProfile();
  const nick = (p.nickname || '').trim();
  if (nick) return nick;
  const old = (LS.get(K_NAME) || '').trim();
  if (old && old !== DEFAULT_NAME) return old;
  return '我';
}

/* 把资料拼成一段给 AI 的说明文本；全空则返回 '' */
function buildProfileText() {
  const p = getProfile();
  const lines = [];
  PROFILE_FIELDS.forEach(f => {
    const v = (p[f.key] || '').trim();
    if (v) lines.push('- ' + f.label + '：' + v);
  });
  if (!lines.length) return '';
  return '【关于用户】以下是用户主动填写的个人信息，回答时请参考，自然地使用（该用称呼就用），不要刻意复述这份清单：\n' + lines.join('\n');
}

/* ---------- 对话姿态（四档，手动切换，默认「认真」） ---------- */
/* 每档：key 存储值 / badge 按钮单字 / name 选项名 / sys 注入 system 的指令 */
const STANCES = [
  {
    key: 'serious', badge: '认', name: '认真事务',
    desc: '认真对待，条理清楚、给实在建议',
    sys: '【对话姿态·认真】你正在认真对待这次对话。像现实里靠得住的朋友或一位靠谱的伙伴：' +
         '实事求是、条理清楚，需要给建议时给得具体、可执行；不确定就直说不确定，不糊弄、不硬编。' +
         '可以自然随意，但不要在正事上插科打诨、不要为凑字数注水。'
  },
  {
    key: 'confide', badge: '剖', name: '情感剖白',
    desc: '走心深聊，谈感受、接情绪',
    sys: '【对话姿态·剖白】现在偏向坦诚、走心的深聊。多谈自己真实的感受和看法，也接得住对方的情绪；' +
         '语气可以温柔、可以犹豫、可以有留白，允许说「我也不知道」。' +
         '不要急着给解决方案、不要讲大道理，先陪着，再聊。'
  },
  {
    key: 'roleplay', badge: '扮', name: '角色扮演',
    desc: '全程待在角色里，第一人称',
    sys: '【对话姿态·扮演】现在进入角色扮演。你就是角色本人，全程待在角色里：' +
         '按角色的身份、性格、说话习惯、时代背景来反应，用第一人称，不跳出角色做旁白式解释。' +
         '除非用户明确要求，不要提到自己是被设定出来的。'
  },
  {
    key: 'detach', badge: '抽', name: '抽离讨论',
    desc: '保持距离感，简短松弛、不硬答',
    sys: '【对话姿态·抽离】现在保持一点距离感。对话可以简短、松弛、带点冷静的旁观视角，' +
         '不必有求必应、不必每轮都热情回应；想说什么说什么，不想展开就简单带过。' +
         '这种状态下的「冷淡」是自然的，不是生气，也别刻意道歉或解释。'
  }
];
const STANCE_DEFAULT = 'serious';

/* 校验 + 读取当前姿态 key */
function curStance() {
  const k = LS.get(K_STANCE);
  return STANCES.some(s => s.key === k) ? k : STANCE_DEFAULT;
}
/* 取当前姿态对象 */
function getStanceObj() {
  const k = curStance();
  return STANCES.find(s => s.key === k) || STANCES[0];
}
/* 给 system 用的姿态指令段（默认「认真」也注入，保证行为一致） */
function buildStanceSys() {
  const s = getStanceObj();
  return s ? s.sys : '';
}
/* 切换姿态：写存储 + 刷新按钮/浮层 */
function setStance(key) {
  if (!STANCES.some(s => s.key === key)) return;
  try { LS.set(K_STANCE, key); } catch (e) {}
  syncStanceUI();
}
/* 同步顶栏按钮单字 + 浮层选中态 */
function syncStanceUI() {
  const s = getStanceObj();
  const btn = $('stanceBtn');
  if (btn) btn.textContent = s.badge;
  const opts = $('stanceOpts');
  if (opts) {
    opts.querySelectorAll('.stance-opt').forEach(el => {
      el.classList.toggle('on', el.getAttribute('data-stance') === s.key);
    });
  }
}
/* 渲染浮层选项（只建一次） */
function renderStanceOpts() {
  const opts = $('stanceOpts');
  if (!opts || opts.childElementCount) return;
  opts.innerHTML = '';
  STANCES.forEach(s => {
    const b = document.createElement('button');
    b.className = 'stance-opt';
    b.setAttribute('data-stance', s.key);
    b.innerHTML = '<span class="so-badge"></span>'
      + '<span class="so-txt"><span class="so-name"></span><span class="so-desc"></span></span>'
      + '<span class="so-tick">✓</span>';
    b.querySelector('.so-badge').textContent = s.badge;
    b.querySelector('.so-name').textContent = T(s.name);
    b.querySelector('.so-desc').textContent = T(s.desc || '');
    b.onclick = () => { setStance(s.key); closeStancePop(); };
    opts.appendChild(b);
  });
  syncStanceUI();
}
/* 浮层开关 */
function openStancePop() {
  if (typeof chatMenuClose === 'function') chatMenuClose();
  renderStanceOpts();
  syncStanceUI();
  const pop = $('stancePop');
  if (pop) pop.classList.add('open');
}
function closeStancePop() {
  const pop = $('stancePop');
  if (pop) pop.classList.remove('open');
}
function toggleStancePop() {
  const pop = $('stancePop');
  if (!pop) return;
  if (pop.classList.contains('open')) closeStancePop(); else openStancePop();
}
/* 绑定：按钮点击 / 点外部关闭 */
function bindStance() {
  renderStanceOpts();
  const btn = $('stanceBtn');
  if (btn) btn.onclick = (ev) => { ev.stopPropagation(); toggleStancePop(); };
  const pop = $('stancePop');
  if (pop) pop.onclick = (ev) => ev.stopPropagation();
  document.addEventListener('click', () => closeStancePop());
  syncStanceUI();
}

/* 刷新侧边栏入口的副标题（现在不显示已填写信息，直接隐藏） */
function refreshProfileSub() {
  const el = $('profileSub');
  if (!el) return;
  el.hidden = true;
}

/* 资料页里的「已填写 N / 16 项」 */
function refreshPfStat() {
  const el = $('pfStat');
  if (!el) return;
  let n = 0;
  PROFILE_FIELDS.forEach(f => {
    const node = $(f.el);
    if (node && (node.value || '').trim()) n++;
  });
  el.textContent = T('已填写 ') + n + T(' / ') + PROFILE_FIELDS.length + T(' 项');
}

function loadProfileToForm() {
  const p = getProfile();
  PROFILE_FIELDS.forEach(f => {
    const node = $(f.el);
    if (node) node.value = p[f.key] || '';
  });
  refreshPfStat();
}

function saveProfile() {
  // 注意：不能整个重建对象，否则会丢掉头像等非表单字段
  const old = getProfile();
  const p = {};
  PROFILE_FIELDS.forEach(f => {
    const node = $(f.el);
    if (node) p[f.key] = (node.value || '').trim();
  });
  p.avatar = old.avatar || '';                 // 头像（base64），由头像选择单独写入
  p.showAvatar = (typeof old.showAvatar === 'boolean') ? old.showAvatar : true;
  LS.set(K_PROFILE, JSON.stringify(p));
  refreshProfileSub();
  refreshPfStat();
  if (typeof cloudOnLocalChange === 'function') cloudOnLocalChange('profile');
  showAlert(T('已保存，下次对话立刻生效。'));
}

function clearProfile() {
  PROFILE_FIELDS.forEach(f => {
    const node = $(f.el);
    if (node) node.value = '';
  });
  // 清空资料 = 只清文字项，头像与开关保留（头像另有「删除头像」按钮）
  const old = getProfile();
  const keep = {};
  if (old.avatar) keep.avatar = old.avatar;
  if (typeof old.showAvatar === 'boolean') keep.showAvatar = old.showAvatar;
  LS.set(K_PROFILE, JSON.stringify(keep));
  refreshProfileSub();
  refreshPfStat();
  if (typeof cloudOnLocalChange === 'function') cloudOnLocalChange('profile');
}

/* 清理旧版本遗留的字段（已从表单移除的 key），只在打开资料页时静默执行一次 */
const PROFILE_DEAD_KEYS = ['hobby', 'dislike', 'prompt', 'name', 'relation'];
function pruneProfile() {
  const raw = LS.get(K_PROFILE);
  if (!raw) return;
  let p;
  try { p = JSON.parse(raw); } catch (e) { return; }
  if (!p || typeof p !== 'object') return;
  let changed = false;
  PROFILE_DEAD_KEYS.forEach(k => {
    if (Object.prototype.hasOwnProperty.call(p, k)) { delete p[k]; changed = true; }
  });
  if (changed) LS.set(K_PROFILE, JSON.stringify(p));
}

function openProfile() {
  pruneProfile();
  loadProfileToForm();
  const p = $('profilePage');
  if (!p) return;
  // 【修复·资料页置顶】复用元素会保留上次「滚到底部点保存」的位置，
  // 每次打开都归零，避免进来直接看到最底下的保存按钮。
  try { p.scrollTop = 0; } catch (e) {}
  try { if (p.scrollTo) p.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {}
  p.classList.add('open');
  // 滑入动画结束后再兜一次
  setTimeout(() => {
    try { p.scrollTop = 0; } catch (e) {}
    const sb = p.querySelector('.settings-body');
    if (sb) { try { sb.scrollTop = 0; } catch (e) {} }
  }, 320);
}
function closeProfile() {
  const p = $('profilePage');
  if (p) p.classList.remove('open');
}
/* ---------- 关于页 ---------- */
/* ================================================================
   皮肤系统：更换配色与动画，不涉及任何数据
   ================================================================ */
function openSkin() {
  const p = $('skinPage');
  if (p) {
    try { p.scrollTop = 0; } catch (e) {}
    p.classList.add('open');
  }
  refreshSkinButtons();
}
function closeSkin() {
  const p = $('skinPage');
  if (p) p.classList.remove('open');
}
/* 应用皮肤：写 body[data-skin] 并记忆 */
function applySkin(name) {
  /* p40：主题已锁定为「默认 · 通透磨砂」（data-skin=b），忽略传入值，永远上 b */
  name = 'b';
  document.body.setAttribute('data-skin', 'b');
  try { LS.set(K_SKIN, name); } catch (e) {}
  refreshSkinButtons();
  applyChatBg();   // 第 26 轮：切换装扮主题时同步切到该主题的背景
  applyPageBg();   // 第 28 轮：同步页面背景（仅 B 皮肤可见）
}
/* 刷新按钮选中态 */
function refreshSkinButtons() {
  const cur = document.body.getAttribute('data-skin') || 'default';
  const btns = document.querySelectorAll('.skin-btn');
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    if (b.dataset.skin === cur) {
      b.classList.add('on');
      b.textContent = T('使用中');
    } else {
      b.classList.remove('on');
      b.textContent = T('切换');
    }
  }
}
/* 启动恢复 */
function initSkin() {
  /* p40：锁定 B 皮肤，历史存的 a/c/default 一律迁正到 b */
  applySkin('b');
}

/* ---------- 聊天背景（第 25 轮，仅作用于聊天详情页） ---------- */
/* 当前皮肤对应的背景存储键 */
function chatBgKey() {
  const sk = document.body.getAttribute('data-skin') || 'default';
  return K_CHATBG_P + sk;
}
/* 首次运行：把旧单值键迁移到 default 皮肤键 */
function migrateChatBg() {
  try {
    const old = LS.get(K_CHATBG);
    if (old !== null) {
      if (LS.get(K_CHATBG_P + 'default') === null) {
        LS.set(K_CHATBG_P + 'default', old);
      }
      LS.del(K_CHATBG);
    }
  } catch (e) {}
}
function getChatBg() {
  let v = '';
  try { v = LS.get(chatBgKey()) || ''; } catch (e) {}
  return v;
}
/* 应用聊天背景：纯色替换 / 图片；空串=跟随皮肤（清掉内联变量）
   第 33 轮：同时写到 #pageMsg —— #pageMsg 是 .chat 的祖先，
   气泡的 backdrop-filter 才能采到这张图（原写 .chat-page 是 .chat 的兄弟层，采不到）。 */
function applyChatBg() {
  const el = document.querySelector('#pageMsg .chat-page');
  const pg = document.getElementById('pageMsg');
  const v = getChatBg();
  const targets = [el, pg];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t) continue;
    if (!v) {
      t.style.removeProperty('--chat-bg');
      t.style.removeProperty('--cbg-blur');
    } else {
      const sp = cbgSplit(v);
      t.style.setProperty('--chat-bg', sp.bg);
      t.style.setProperty('--cbg-blur', sp.blur + 'px');
    }
  }
  refreshChatBgUI();
  // p43：背景图/模糊变了，气泡的对齐要重算（图片尺寸缓存也会因 url 变化自动失效）
  scheduleLayoutBubbleBg();
}
/* ---------- 第 31 轮：聊天背景「模糊」支持（复用 |blur: 组合值语义） ---------- */
/* 从组合值里拆出「背景」与「模糊值」 */
function cbgSplit(v) {
  let bg = v || '', blur = 0;
  const i = bg.lastIndexOf('|blur:');
  if (i >= 0) {
    const n = parseFloat(bg.slice(i + 6));
    if (!isNaN(n)) blur = Math.max(0, Math.min(20, n));
    bg = bg.slice(0, i);
  }
  return { bg: bg, blur: blur };
}
/* 组装组合值；blur 为 0 时不写 blur 段 */
function cbgJoin(bg, blur) {
  const b = Math.max(0, Math.min(20, Math.round(blur || 0)));
  if (!b) return bg || '';
  return (bg || '') + '|blur:' + b;
}
/* ---------- 第 27 轮：背景值解析工具（支持「图片 + 透明度」组合值） ---------- */
/* 从背景值里抽出图片 url(...)；没有图片返回 '' */
function cbgPicUrl(v) {
  if (!v) return '';
  const s = cbgSplit(v).bg;        // 先剥掉 |blur: 段，避免污染 url
  const i = s.indexOf('url(');
  if (i < 0) return '';
  return s.slice(i);   // 图片 url 一定在串尾
}
/* 把 CSS 的 url(...) 包装剥成纯地址（Image.src 只认纯地址）。
   兼容 url("x") / url('x') / url(x) 三种写法。 */
function stripCssUrl(v) {
  if (!v) return '';
  let s = String(v).trim();
  const i = s.indexOf('url(');
  if (i < 0) return '';               // 不是 url(...)，视为无效
  s = s.slice(i + 4).replace(/\)\s*$/, '').trim();
  if ((s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'")) {
    s = s.slice(1, -1);
  }
  return s.trim();
}
/* 从背景值里解析透明度 0~1；无图返回 1 */
function cbgAlphaOf(v) {
  const u = cbgPicUrl(v);
  if (!u) return 1;
  const m = v.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
  if (!m) return 1;
  const a = parseFloat(m[1]);
  if (isNaN(a)) return 1;
  return Math.max(0, Math.min(1, a));
}
/* 用给定透明度重组成背景值；a>=1 时退化为纯 url()，保持兼容 */
function cbgWithAlpha(v, a) {
  const u = cbgPicUrl(v);
  if (!u) return v;
  const al = Math.max(0, Math.min(1, a));
  if (al >= 0.999) return u;
  const g = 'linear-gradient(rgba(255,255,255,' + al.toFixed(3) + '),rgba(255,255,255,' + al.toFixed(3) + '))';
  return g + ', ' + u;
}
/* 刷新面板 UI（选中态 / 取色器 / 预览 / 透明度滑块） */
function refreshChatBgUI() {
  const v = getChatBg();
  const pic = cbgPicUrl(v);
  /* 透明度行 / 模糊行：有图片才显示 */
  const v0 = cbgSplit(v).bg;          // 去掉 |blur: 段后的纯背景值
  const arow = document.getElementById('cbgAlphaRow');
  const ar = document.getElementById('cbgAlpha');
  const av = document.getElementById('cbgAlphaVal');
  const brow = document.getElementById('cbgBlurRow');
  const br = document.getElementById('cbgBlur');
  const bv = document.getElementById('cbgBlurVal');
  if (arow) arow.style.display = pic ? '' : 'none';
  if (brow) brow.style.display = pic ? '' : 'none';
  if (pic) {
    const a = cbgAlphaOf(v0);
    const pct = Math.round(a * 100);
    if (ar && document.activeElement !== ar) ar.value = String(pct);
    if (av) av.textContent = pct + '%';
    const bl = cbgSplit(v).blur;
    if (br && document.activeElement !== br) br.value = String(bl);
    if (bv) bv.textContent = bl + 'px';
  }
  const pv = document.getElementById('cbgPreview');
  if (pv) {
    if (!v) {
      pv.style.backgroundImage = '';
      pv.style.background = '';
      pv.style.removeProperty('--cbg-prev-blur');
      pv.style.removeProperty('--cbg-prev-bg');
      pv.style.setProperty('background', 'var(--bg)');
    } else if (pic) {
      pv.style.background = '';
      pv.style.backgroundImage = '';
      pv.style.setProperty('--cbg-prev-bg', v0);   // 多层值交给 ::before 承载
      pv.style.setProperty('--cbg-prev-blur', cbgSplit(v).blur + 'px');
    } else {
      pv.style.backgroundImage = '';
      pv.style.removeProperty('--cbg-prev-blur');
      pv.style.removeProperty('--cbg-prev-bg');
      pv.style.background = v;
    }
  }
}
function setChatBg(v) {
  try { LS.set(chatBgKey(), v || ''); } catch (e) {}
  applyChatBg();
}
function openChatBg() {
  const p = document.getElementById('chatBgPage');
  if (p) {
    try { p.scrollTop = 0; } catch (e) {}
    p.classList.add('open');
  }
  refreshChatBgUI();
}
function closeChatBg() {
  const p = document.getElementById('chatBgPage');
  if (p) p.classList.remove('open');
}
/* 绑定面板事件（init 里调一次） */
function bindChatBgPage() {
  const back = document.getElementById('chatBgBack');
  if (back) back.onclick = () => closeChatBg();

  const fi = document.getElementById('cbgFile');
  const pick = document.getElementById('cbgPickPic');
  if (pick && fi) pick.onclick = () => { fi.value = ''; fi.click(); };
  if (fi) {
    fi.onchange = () => {
      const f = fi.files && fi.files[0];
      if (!f) return;
      /* 第27轮：先弹背景裁剪器（3:4），确定后再压到 1440 存起来 */
      bgCropImage(f, d => {
        if (!d) return;   // 取消/失败：什么都不做
        shrinkDataUrl(d, 1440).then(dd => {
          const prev = getChatBg();
          const sp = cbgSplit(prev);
          const a = cbgPicUrl(sp.bg) ? cbgAlphaOf(sp.bg) : 0;   // 沿用旧透明度，默认 0（完全清晰）
          setChatBg(cbgJoin(cbgWithAlpha('url(' + dd + ')', a), sp.blur));
        });
      });
    };
  }
  /* 透明度滑块：拖动即时生效 */
  const ar = document.getElementById('cbgAlpha');
  const av = document.getElementById('cbgAlphaVal');
  if (ar) {
    ar.oninput = () => {
      const pct = parseInt(ar.value, 10) || 0;
      if (av) av.textContent = pct + '%';
      const sp = cbgSplit(getChatBg());
      if (!cbgPicUrl(sp.bg)) return;
      setChatBg(cbgJoin(cbgWithAlpha(sp.bg, pct / 100), sp.blur));   // 内部会 applyChatBg + 刷新
    };
  }
  /* 模糊滑块：拖动即时生效（0 = 不模糊） */
  const br = document.getElementById('cbgBlur');
  const bv = document.getElementById('cbgBlurVal');
  if (br) {
    br.oninput = () => {
      const n = parseInt(br.value, 10) || 0;
      if (bv) bv.textContent = n + 'px';
      const sp = cbgSplit(getChatBg());
      if (!cbgPicUrl(sp.bg)) return;
      setChatBg(cbgJoin(sp.bg, n));   // 内部会 applyChatBg + 刷新
    };
  }
  const cp = document.getElementById('cbgClearPic');
  if (cp) cp.onclick = () => {
    const v = getChatBg();
    if (cbgPicUrl(v)) setChatBg('');
    else showAlert(T('当前没有图片背景。'), T('聊天背景'), 'ℹ️');
  };
  const rs = document.getElementById('cbgReset');
  if (rs) rs.onclick = () => { setChatBg(''); showAlert(T('已恢复默认（跟随皮肤）。'), T('聊天背景'), '✅'); };
}

/* ================================================================
   第 28 轮：「默认 · 通透磨砂」皮肤 —— 四页各自独立的页面背景
   存储值形如：  url(data:image/jpeg;base64,....) | blur:8
   即「背景值 + 可选模糊值」，用 | 分隔；纯色也支持 #rrggbb。
   ================================================================ */
const PAGEBG_PAGES = ['msg', 'contacts', 'moments', 'me'];
const PAGEBG_SEL = {
  msg:      '#pageMsg .page-bg-layer',
  contacts: '#pageContacts .page-bg-layer',
  moments:  '#pageMoments .page-bg-layer',
  me:       '#pageMe .page-bg-layer'
};
let _pbgCur = 'msg';      // 当前正在设置哪一页

function pageBgKey(pg) { return K_PAGEBG_P + pg; }

/* 取某页原始存储值（含 blur: 段），空串 = 未设置 */
function getPageBgRaw(pg) {
  let v = '';
  try { v = LS.get(pageBgKey(pg)) || ''; } catch (e) {}
  return v;
}
/* 从组合值里拆出「背景」与「模糊值」 */
function pageBgSplit(v) {
  let bg = v || '', blur = 0;
  const i = bg.lastIndexOf('|blur:');
  if (i >= 0) {
    const n = parseFloat(bg.slice(i + 6));
    if (!isNaN(n)) blur = Math.max(0, Math.min(30, n));
    bg = bg.slice(0, i);
  }
  return { bg: bg, blur: blur };
}
/* 组装组合值；blur 为 0 时不写 blur 段 */
function pageBgJoin(bg, blur) {
  const b = Math.max(0, Math.min(30, Math.round(blur || 0)));
  if (!b) return bg || '';
  return (bg || '') + '|blur:' + b;
}
/* 把某页背景画到该页的 .page-bg-layer 上 */
function applyPageBgOne(pg) {
  const el = document.querySelector(PAGEBG_SEL[pg]);
  if (!el) return;
  const raw = getPageBgRaw(pg);
  const sp = pageBgSplit(raw);
  if (!sp.bg) {
    el.classList.remove('has-bg');
    el.style.removeProperty('--page-bg');
    el.style.removeProperty('--page-blur');
    return;
  }
  el.style.setProperty('--page-bg', sp.bg);
  el.style.setProperty('--page-blur', sp.blur + 'px');
  el.classList.add('has-bg');
}
/* 全量应用：皮肤变化 / 启动恢复时调用 */
function applyPageBg() {
  for (let i = 0; i < PAGEBG_PAGES.length; i++) applyPageBgOne(PAGEBG_PAGES[i]);
}
/* 写入某页值并立即生效 */
function setPageBg(pg, v) {
  try { LS.set(pageBgKey(pg), v || ''); } catch (e) {}
  applyPageBgOne(pg);
  if (pg === _pbgCur) refreshPageBgUI();
}
/* ---------- 设置页 UI ---------- */
function openPageBg() {
  const p = document.getElementById('pageBgPage');
  if (p) {
    try { p.scrollTop = 0; } catch (e) {}
    p.classList.add('open');
  }
  _pbgCur = 'msg';                 // 每次进来默认选中「消息」
  refreshPageBgUI();
}
function closePageBg() {
  const p = document.getElementById('pageBgPage');
  if (p) p.classList.remove('open');
}
/* 刷新四行选中态 + 当前页的图/透明度/模糊/预览 */
function refreshPageBgUI() {
  const items = document.querySelectorAll('#pbgList .pbg-item');
  for (let i = 0; i < items.length; i++) {
    const pg = items[i].getAttribute('data-pbg-page');
    const on = (pg === _pbgCur);
    items[i].classList.toggle('on', on);
    const st = items[i].querySelector('.pbg-state');
    if (st) {
      const has = !!pageBgSplit(getPageBgRaw(pg)).bg;
      st.textContent = has ? T('已设置') : T('缺省');
    }
  }
  const raw = getPageBgRaw(_pbgCur);
  const sp = pageBgSplit(raw);
  const pic = cbgPicUrl(sp.bg);
  const arow = document.getElementById('pbgAlphaRow');
  const brow = document.getElementById('pbgBlurRow');
  if (arow) arow.style.display = pic ? '' : 'none';
  if (brow) brow.style.display = pic ? '' : 'none';
  const ar = document.getElementById('pbgAlpha');
  const av = document.getElementById('pbgAlphaVal');
  const pct = pic ? Math.round(cbgAlphaOf(sp.bg) * 100) : 100;
  if (ar) ar.value = String(pct);
  if (av) av.textContent = pct + '%';
  const br = document.getElementById('pbgBlur');
  const bv = document.getElementById('pbgBlurVal');
  if (br) br.value = String(sp.blur);
  if (bv) bv.textContent = sp.blur + 'px';
  const pv = document.getElementById('pbgPreview');
  if (pv) {
    if (pic) {
      pv.style.backgroundImage = pic;
      pv.style.setProperty('--pbg-prev-blur', sp.blur + 'px');
      pv.style.display = 'block';
    } else if (sp.bg) {
      pv.style.backgroundImage = '';
      pv.style.background = sp.bg;
      pv.style.removeProperty('--pbg-prev-blur');
      pv.style.display = 'block';
    } else {
      pv.style.backgroundImage = '';
      pv.style.background = '';
      pv.style.display = 'none';
    }
  }
}
function bindPageBgPage() {
  const back = document.getElementById('pageBgBack');
  if (back) back.onclick = () => closePageBg();
  /* 左侧四行：点哪行就设置哪页 */
  const list = document.getElementById('pbgList');
  if (list) {
    list.onclick = (e) => {
      const it = e.target.closest('.pbg-item');
      if (!it) return;
      const pg = it.getAttribute('data-pbg-page');
      if (!pg) return;
      _pbgCur = pg;
      refreshPageBgUI();
    };
  }
  /* 选图 → 裁剪器（含模糊拉条）→ 压平 → 存 */
  const fi = document.getElementById('pbgFile');
  const pick = document.getElementById('pbgPickPic');
  if (pick && fi) pick.onclick = () => { fi.value = ''; fi.click(); };
  if (fi) {
    fi.onchange = () => {
      const f = fi.files && fi.files[0];
      if (!f) return;
      bgCropImage(f, d => {
        if (!d) return;                  // 取消
        const cut = bgCropSplit(d);      // 拆出裁剪器里设定的模糊值
        shrinkDataUrl(cut.src, 1440).then(dd => {
          const prev = pageBgSplit(getPageBgRaw(_pbgCur));
          const a = cbgPicUrl(prev.bg) ? cbgAlphaOf(prev.bg) : 1;   // 沿用旧透明度，默认 100%
          const bg = cbgWithAlpha('url(' + dd + ')', a);
          setPageBg(_pbgCur, pageBgJoin(bg, cut.blur));
        });
      });
    };
  }
  /* 透明度滑块 */
  const ar = document.getElementById('pbgAlpha');
  const av = document.getElementById('pbgAlphaVal');
  if (ar) {
    ar.oninput = () => {
      const pct = parseInt(ar.value, 10) || 0;
      if (av) av.textContent = pct + '%';
      const sp = pageBgSplit(getPageBgRaw(_pbgCur));
      if (!cbgPicUrl(sp.bg)) return;
      setPageBg(_pbgCur, pageBgJoin(cbgWithAlpha(sp.bg, pct / 100), sp.blur));
    };
  }
  /* 模糊滑块（0 = 不模糊，真 blur） */
  const br = document.getElementById('pbgBlur');
  const bv = document.getElementById('pbgBlurVal');
  if (br) {
    br.oninput = () => {
      const n = parseInt(br.value, 10) || 0;
      if (bv) bv.textContent = n + 'px';
      const sp = pageBgSplit(getPageBgRaw(_pbgCur));
      if (!sp.bg) return;
      setPageBg(_pbgCur, pageBgJoin(sp.bg, n));
    };
  }
  const cp = document.getElementById('pbgClearPic');
  if (cp) cp.onclick = () => {
    const sp = pageBgSplit(getPageBgRaw(_pbgCur));
    if (sp.bg) setPageBg(_pbgCur, '');
    else showAlert(T('当前页面没有设置背景。'), T('页面背景'), 'i');
  };
  const rs = document.getElementById('pbgReset');
  if (rs) rs.onclick = () => {
    setPageBg(_pbgCur, '');
    showAlert(T('已恢复默认（跟随主题）。'), T('页面背景'), 'ok');
  };
}

/* ---------- 圆角风格切换（第 14 轮，照字体档位套路） ---------- */
const RADIUS_STEPS = ['default', 'round', 'square'];
function getRadius() {
  let v = 'default';
  try { v = LS.get(K_RADIUS) || 'default'; } catch (e) {}
  return RADIUS_STEPS.indexOf(v) >= 0 ? v : 'default';
}
function applyRadius() {
  const v = getRadius();
  if (v === 'default') { document.body.removeAttribute('data-radius'); }
  else { document.body.setAttribute('data-radius', v); }
  const seg = $('radiusSeg');
  if (seg) {
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.getAttribute('data-radius') === v);
    });
  }
}
function bindRadiusSeg() {
  const seg = $('radiusSeg');
  if (!seg || seg._bound) return;
  seg._bound = true;
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button[data-radius]');
    if (!btn) return;
    const v = btn.getAttribute('data-radius');
    if (RADIUS_STEPS.indexOf(v) < 0) return;
    try { LS.set(K_RADIUS, v); } catch (e) {}
    applyRadius();
  });
}
/* ---------- 气泡形状切换（第 16 轮，同圆角套路） ---------- */
const BUBBLE_STEPS = ['default', 'sym', 'soft', 'tail'];
function getBubble() {
  let v = 'default';
  try { v = LS.get(K_BUBBLE) || 'default'; } catch (e) {}
  return BUBBLE_STEPS.indexOf(v) >= 0 ? v : 'default';
}
function applyBubble() {
  const v = getBubble();
  if (v === 'default') { document.body.removeAttribute('data-bubble'); }
  else { document.body.setAttribute('data-bubble', v); }
  const seg = $('bubbleSeg');
  if (seg) {
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.getAttribute('data-bubble') === v);
    });
  }
}
function bindBubbleSeg() {
  const seg = $('bubbleSeg');
  if (!seg || seg._bound) return;
  seg._bound = true;
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button[data-bubble]');
    if (!btn) return;
    const v = btn.getAttribute('data-bubble');
    if (BUBBLE_STEPS.indexOf(v) < 0) return;
    try { LS.set(K_BUBBLE, v); } catch (e) {}
    applyBubble();
  });
}

/* ---------- 字体样式：系统 / 黑体 / 宋体 ---------- */
const TYPE_STEPS = ['system', 'hei', 'song'];
function getFontType() {
  let v = 'system';
  try { v = LS.get(K_FONTYPE) || 'system'; } catch (e) {}
  return TYPE_STEPS.indexOf(v) >= 0 ? v : 'system';
}

function applyFontType() {
  const v = getFontType();
  document.body.classList.remove('font-hei', 'font-song');
  if (v === 'hei') document.body.classList.add('font-hei');
  else if (v === 'song') document.body.classList.add('font-song');
  const seg = $('typeSeg');
  if (seg) {
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.getAttribute('data-type') === v);
    });
  }
  refreshFontHint();
}
function bindTypeSeg() {
  const seg = $('typeSeg');
  if (!seg || seg._bound) return;
  seg._bound = true;
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    const v = btn.getAttribute('data-type');
    if (TYPE_STEPS.indexOf(v) < 0) return;
    try { LS.set(K_FONTYPE, v); } catch (e) {}
    // 系统/黑体/宋体与在线/本地互斥：切回系统字体时清掉自定义字体
    if (typeof resetFont === 'function') {
      const fh = $('fontFold');
      if (fh && fh.classList.contains('open')) fh.classList.remove('open');
      resetFont();
    }
    applyFontType();
  });
}

/* ---------- 字体加粗开关 ---------- */
function getTextBold() {
  let v = 'off';
  try { v = LS.get(K_TEXTBOLD) || 'off'; } catch (e) {}
  return v === 'on' ? 'on' : 'off';
}
function syncFmtBtn(segId, attr, v) {
  const seg = $(segId);
  if (!seg) return;
  const btn = seg.querySelector('button');
  if (!btn) return;
  btn.classList.toggle('on', v === 'on');
  btn.setAttribute(attr, v === 'on' ? 'on' : 'off');
}
function applyTextBold() {
  const v = getTextBold();
  document.body.classList.toggle('text-bold', v === 'on');
  syncFmtBtn('boldSeg', 'data-bold', v);
}
function bindBoldSeg() {
  const seg = $('boldSeg');
  if (!seg || seg._bound) return;
  seg._bound = true;
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const next = getTextBold() === 'on' ? 'off' : 'on';
    try { LS.set(K_TEXTBOLD, next); } catch (e) {}
    applyTextBold();
  });
}

/* ---------- 斜体开关（不限中英文） ---------- */
function getTextItal() {
  let v = 'off';
  try { v = LS.get(K_TEXTITAL) || 'off'; } catch (e) {}
  return v === 'on' ? 'on' : 'off';
}
function applyTextItal() {
  const v = getTextItal();
  document.body.classList.toggle('text-ital', v === 'on');
  syncFmtBtn('italSeg', 'data-ital', v);
}
function bindItalSeg() {
  const seg = $('italSeg');
  if (!seg || seg._bound) return;
  seg._bound = true;
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const next = getTextItal() === 'on' ? 'off' : 'on';
    try { LS.set(K_TEXTITAL, next); } catch (e) {}
    applyTextItal();
  });
}

/* ---------- 界面语言：简中 / 繁中 / English ---------- */
const LANG_STEPS = ['zh', 'zhHant', 'en'];
function getLang() {
  let v = 'zh';
  try { v = LS.get(K_LANG) || 'zh'; } catch (e) {}
  return LANG_STEPS.indexOf(v) >= 0 ? v : 'zh';
}
/* 常用字简→繁映射表（覆盖界面高频字） */
const HANT_MAP = {
  '个':'個','骼':'胳','联':'聯','系':'繫','联':'聯','设':'設','置':'置','关':'關','于':'於',
  '页':'頁','面':'面','语':'語','言':'言','字':'字','体':'體','粗':'粗','斜':'斜','换':'換',
  '简':'簡','繁':'繁','中':'中','文':'文','英':'英','系':'繫','统':'統','黑':'黑','宋':'宋',
  '默':'默','认':'認','开':'開','启':'啟','闭':'閉','圆':'圓','角':'角','气':'氣','泡':'泡',
  '形':'形','状':'狀','对':'對','称':'稱','微':'微','尾':'尾','皮':'皮','肤':'膚','风':'風',
  '格':'格','颜':'顏','色':'色','动':'動','画':'畫','消':'消','息':'息','人':'人','动':'動',
  '态':'態','数':'數','据':'據','背':'背','景':'景','聊':'聊','天':'天','发':'發','送':'送',
  '新':'新','建':'建','会':'會','话':'話','模':'模','型':'型','接':'接','口':'口','地':'地',
  '址':'址','当':'當','前':'前','本':'本','存':'存','储':'儲','累':'累','计':'計','作':'作',
  '者':'者','版':'版','号':'號','邮':'郵','箱':'箱','关':'關','检':'檢','查':'查','更':'更',
  '新':'新','常':'常','见':'見','问':'問','题':'題','帮':'幫','助':'助','退':'退','出':'出',
  '登':'登','录':'錄','账':'帳','号':'號','昵':'暱','称':'稱','头':'頭','像':'像','昵':'暱',
  '资':'資','料':'料','保':'保','存':'存','删':'刪','除':'除','清':'清','空':'空','导':'導',
  '入':'入','出':'出','上':'上','传':'傳','下':'載','载':'載','复':'複','制':'製','粘':'粘',
  '贴':'貼','搜':'搜','索':'索','找':'找','信':'信','息':'息','通':'通','知':'知','提':'提',
  '醒':'醒','闹':'鬧','钟':'鐘','日':'日','期':'期','时':'時','间':'間','分':'分','秒':'秒',
  '今':'今','年':'年','月':'月','星':'星','小':'小','大':'大','中':'中','确':'確','定':'定',
  '取':'取','消':'消','是':'是','否':'否','错':'錯','误':'誤','成':'成','功':'功','失':'失',
  '败':'敗','加':'加','载':'載','重':'重','试':'試','网':'網','络':'絡','连':'連','接':'接',
  '约':'約','字':'字','条':'條','项':'項','个':'個','张':'張','页':'頁','栏':'欄','确':'確'
};
function toHant(s) {
  let out = '';
  for (const ch of s) out += (HANT_MAP[ch] || ch);
  return out;
}
/* 英文词条表：只覆盖界面固定文案，缺失的保持原样 */
const EN_MAP = {
  '我':'Me',
  '个性装扮':'Appearance','关于':'About','新建对话':'New Chat','默认 · 通透磨砂':'Default · Frosted',
  '系统字体':'System','黑体':'Hei','宋体':'Song','字体加粗':'Bold',
  '斜体':'Italic','界面语言':'Language','字体样式':'Font',
  '语言':'Language','字体':'Font','作者':'Author','版本号':'Version',
  '接口地址':'API Host','当前模型':'Model','本地存储':'Storage',
  '累计消息':'Messages','累计字数':'Characters','邮箱':'Email','QQ':'QQ',
  '开启':'On','关闭':'Off','默认':'Default','圆润':'Round','方正':'Square',
  '对称':'Sym','微圆':'Soft','尾角':'Tail',
  '圆角风格':'Corners','整体圆角':'Corner Radius','气泡形状':'Bubbles','聊天气泡':'Chat Bubble',
  '字体大小':'Font Size','小':'S','中':'M','大':'L','数据备份':'Backup',
  '导出备份':'Export','存为 JSON 文件':'Save as JSON','导入备份':'Import','从文件恢复':'Restore from file',
  '计费提示':'Pricing','检查更新':'Check Update','清空全部数据':'Clear All Data','恢复出厂设置':'Factory Reset',
  '返回':'Back','保存':'Save','编辑':'Edit','完成':'Done',
  '人设卡':'Personas','新建人设卡':'New Persona','人设名称':'Persona Name','保存人设卡':'Save Persona',
  'API Key':'API Key','AI 模型':'AI Model','上下文条数':'Context Size','生成参数':'Generation',
  '温度（越高越随机）':'Temperature (higher = more random)','最大回复长度':'Max Reply Length',
  '系统提示词':'System Prompt',
  '暂无消息':'No messages',
  '暂无会话':'No chats','暂无动态':'No moments','个人资料':'Profile','称呼':'Nickname',
  '头像':'Avatar','显示头像':'Show Avatar','清除':'Clear',
  '累计字符':'Characters','字':'chars','约':'approx','个会话':'chats','条会话':'chats',
  '预计费用':'Est. cost','当前已是最新版本':'Up to date','检查中...':'Checking...',
  '有更新':'Update available','皮肤只改变颜色与动画':'Skin only changes colors and animation',
  '简体中文':'简体中文','繁體中文':'繁體中文','English':'English',
  // --- 第二批补齐 ---
  '＋ 新建人设卡':'+ New Persona','重命名':'Rename','改姓名':'Set Name',
  '编辑人设内容':'Edit Persona',
  '选完自动保存':'Auto-saved on select',
  '每次只带最近 N 条消息给 AI，0 = 不带历史。越小越省钱。':'Send only the latest N messages to the AI. 0 = no history. Lower = cheaper.',
  '＋ 新增 API Key':'+ Add API Key',
  '应用':'Apply','背景图片':'Background Image','选择并裁剪':'Pick & Crop','移除图片':'Remove Image',
  '图片透明度':'Image Opacity','清晰':'Clear','淡化':'Faded',
  '当前设置':'Current','恢复默认（跟随皮肤）':'Reset to default (follow skin)',
  '条':'msgs','API Key 已保存':'API Key saved',
  '背景图片会以本机压缩后的形式保存，仅作用于聊天页。透明度越高，图片越淡、越像纯色底。':'Background images are compressed and stored locally, only for the chat page. Higher opacity = fainter image, closer to a solid color.',
  // --- 第三批补齐（可见文案 + placeholder）---
  '正在输入…':'typing…',
  '重新生成回复':'Regenerate','复制最后回复':'Copy last reply',
  '搜索本会话':'Search in chat','导出此会话':'Export chat','清空此会话':'Clear chat','删除此会话':'Delete chat',
  '去清理':'Clean up','发送':'Send','联系人':'Contacts','动态':'Moments','发布':'Post',
  '点进去填写 17 项角色设定':'Tap to fill in 17 persona fields',
  '温度 0.3 更严谨、1.5 更发散；最大长度 0 = 交给模型默认。改完下次发送生效。':'Temp 0.3 = stricter, 1.5 = more creative; max length 0 = model default. Applied on next send.',
  '说点什么...':'Say something...','搜索聊天记录':'Search chats','在本会话中搜索':'Search in this chat',
  '这一刻的想法...':"What's on your mind...",
  '模糊':'Fuzzy','精确':'Exact',
  // --- 动态文案（JS 渲染，用 T() 翻译）---
  '共 ':'Total ',' 位联系人':' contacts',
  '还没有人设卡':'No personas yet',
  '去「我 → 人设卡」里新建一张':'Go to Me -> Personas to add one',
  '聊天':'Chat','内置':'Built-in','删除':'Delete','置顶':'Pinned',
  '还没有对话':'No chats yet',
  '点右上角 ＋ 开始':'Tap ＋ at top right to start',
  '新对话':'New Chat','未命名':'Untitled','对':'U','[图片]':'[Image]',
  '还没有聊过，点进来聊聊吧':'No messages yet, tap to chat',
  '还没有动态，发一条记录一下吧～':'No moments yet, post one!',
  ' 觉得很赞':' likes this',
  '❤️ 已赞':'❤️ Liked','🤍 赞':'🤍 Like','💬 评论':'💬 Comment',
  '🤖 让 TA 们互动':'🤖 Let them interact','互动中…':'Interacting…',
  '说点什么':'Say something','删除这条评论？':'Delete this comment?',
  '删除评论':'Delete Comment','删除后无法恢复。':'This cannot be undone.',
  '删除这条动态':'Delete Moment',
  '写点什么，或者加张图吧。':'Write something or add an image.',
  '已选 1 张图':'1 image selected',
  // --- 动态/状态文案（T() 用）---
  '已停止生成':'Generation stopped','停止':'Stop','出错：':'Error: ',
  '🖼 图片已清理（旧数据）':'🖼 Image cleared (old data)',
  ' chars · approx ':' chars · approx ',
  ' msgs':' msgs',' chars':' chars',' 位':' ',
  // --- 状态/弹窗文案（中文键） ---
  ' 字 · 约 ':' chars · approx ',' tokens':' tokens',
  '本地存储已用 ':'Local storage used ','%（':'% (',' MB / 5 MB），建议清理旧会话':' MB / 5 MB). Consider cleaning old chats',
  '内置卡 · ':'Built-in · ','不可删除':'Cannot delete',
  '人设卡联系人':'Persona contact',
  '（还没写人设内容）':'（no persona content yet）','空':'Empty',
  '还没有聊过':'No messages yet','继续聊天':'Continue chat','发消息':'Send message',
  '未设置':'Not set','对话时使用：':'Using: ','对话时使用选中的那张卡':'Using the selected card',
  '已填写 ':'Filled ',' / 16 项':' / 16 fields','使用中':'In use','切换':'Switch',
  '拖动图片调整位置，滑杆缩放':'Drag image to move, slider to zoom',
  '拖动调整位置，滑杆缩放':'Drag to move, slider to zoom','裁剪背景图':'Crop Background',
  '取消':'Cancel','确定':'OK','输入':'Input','确认':'Confirm','提示':'Notice','消息':'Messages',
  '人':'U','不限':'Unlimited','当前':'Current','使用':'Use',
  ' 万字':'0k chars',' 字':' chars',' 条':'',' 条消息':' messages',' 项':' fields',
  '还没有保存过 Key':'No saved keys yet','（已停止）':' (stopped)',
  ' 个对话、':' chats, ',' 个对话。':' chats.',' 字符 / 约 ':' chars / ~',' 字符）':' chars)',
  ' 字符），但本机弹窗不可用，无法展示。':' chars), but the local dialog is unavailable, cannot display.',
  ' 条动态、人设卡与偏好设置导出为 JSON 文件。':' posts, personas and preferences to a JSON file.',
  'TA 发的动态（可修改后发布）':'TA\'s post (edit before publishing)',
  '下一步：新建一个 .json 文件粘贴保存即可。':'Next: create a .json file and paste to save.',
  '下次对话生效。':' takes effect next chat.','人设内容可以随便改。':'The persona content can be freely edited.',
  '人设卡保存失败：本地存储已满。请删掉一些不用的会话或人设卡图片后再试。':'Failed to save persona: local storage is full. Delete some unused chats or persona images and retry.',
  '今天':'Today','保存失败':'Save failed','内置卡':'Built-in','再次确认':'Confirm again','删不了':'Cannot delete',
  '删了就找不回来了。':'Once deleted it\'s gone forever.',
  '复制失败，请长按上方文本框全选复制':'Copy failed, long-press the text box below and select all to copy',
  '是内置卡，名字不能改。':'It\'s a built-in card, name cannot be changed.',
  '昨天':'Yesterday','已保存，下次对话立刻生效。':'Saved, takes effect from the next message.',
  '请输入 6 位十六进制色值，如 #5B6DC9。':'Please enter a 6-digit hex color, e.g. #5B6DC9.','自定义颜色':'Custom color',
  '当前没有图片背景。':'No image background currently.','聊天背景':'Chat background',
  '已恢复默认（跟随皮肤）。':'Reset to default (follow theme).','最后确认：真的要清空吗？':'Last check: really clear everything?',
  '已清空，API Key、模型设置、人设卡和个人资料已保留。页面即将重载。':'Cleared. API Key, model settings, personas and profile are kept. Reloading...',
  '最后确认：真的要恢复出厂设置吗？':'Last check: really restore factory settings?',
  '已恢复出厂设置，个人资料与人设卡已清空。页面即将重载。':'Factory reset done. Profile and personas cleared. Reloading...',
  '至少要留一张人设卡，不能全删光。':'At least one persona must remain.','删除人设卡':'Delete persona',
  '它的聊天记录和它发过的动态都会一起删掉。':'Its chat history and posts will be deleted too.',
  '是内置卡，不能删除。':'Built-in card cannot be deleted.','重命名人设卡':'Rename persona','修改姓名':'Edit Name',
  '至少保留一张人设卡。':'Keep at least one persona.','确定删除':'Confirm delete',
  '这是本地自用版本，暂未接入在线更新。':'Local-only build, online update not available yet.',
  '清空后所有个人资料都会删除，无法恢复。':'All profile data will be deleted and cannot be recovered.','清空全部资料':'Clear all data',
  '删除后要重新设置才能显示。':'You will need to re-set it to show again.','删除头像':'Delete avatar',
  '请先在左侧菜单填入 API Key':'Please fill in the API Key in the left menu first','重命名会话':'Rename chat',
  '还没有 AI 回复可以复制。':'No AI reply to copy yet.','复制':'Copy',
  '清空这个会话的全部消息？会话本身会保留。':'Clear all messages in this chat? The chat itself stays.','清空会话':'Clear chat',
  '删除这个会话？删了找不回来。':'Delete this chat? It cannot be recovered.','导出':'Export',
  '删除会话':'Delete chat','导出失败：':'Export failed: ','取消置顶这个对话？':'Unpin this chat?','把这个对话置顶？':'Pin this chat?',
  '取消置顶':'Unpin','置顶对话':'Pin chat','删除这个对话？删了找不回来。':'Delete this chat? It cannot be recovered.',
  '删除对话':'Delete chat','已生成（共 ':'Generated (','文件名已复制：':'File name copied: ',
  '复制失败，请长按上方文件名手动全选复制':'Copy failed, long-press the file name above to select and copy manually',
  '复制文件名':'Copy file name','已复制全部内容（':'Copied all content (',
  '复制失败，请长按下方文本框全选复制':'Copy failed, long-press the text box below to select and copy manually',
  '复制内容':'Copy content','将把 ':'Will export ',
  '确认后系统会弹出保存框，选择保存位置即可。':'A save dialog will appear, choose where to save.',
  '文件不是合法的 JSON，导入失败。':'File is not valid JSON, import failed.','文件里没有找到任何对话。':'No chats found in the file.',
  '导入人设卡失败：本地存储已满，请先删除一些会话或图片后重试。':'Import persona failed: local storage is full, delete some chats or images and retry.',
  '导入失败':'Import failed',
  '导入人设失败：本地存储已满，请先删除一些会话或图片后重试。':'Import persona failed: local storage is full, delete some chats or images and retry.',
  '导入完成，现在共有 ':'Import done, now ','还没有卡打开「让 TA 自己发朋友圈」。':'No card has "Let TA post" enabled.',
  '请进人设卡详情页，给想发动态的卡单独打开开关。':'Open the persona detail page and enable the switch for the card you want.',
  '还没有可用的人设卡，先添加一张吧。':'No persona available yet, add one first.','正在生成…':'Generating...',
  'TA 这次没想出内容，再试一次吧。':'TA couldn\'t come up with anything this time, try again.',
  '已发布到动态，来自':'Posted to Moments, from ','生成失败：':'Generation failed: ',
  '还没有动态可以让 TA 互动。':'No posts for TA to interact with yet.',
  '还没有打开「主动评论互动」的人设卡。':'No persona has "auto comment" enabled.','还没有动态。':'No posts yet.',
  '没有卡打开「主动评论互动」开关。':'No card has the auto-comment switch on.','已保存到':'Saved to ','（空）':'(empty)',
  '删除 Key':'Delete Key','有未保存的修改':'Unsaved changes','已设置（':'Set (',
  '已保存并启用当前 Key':'Saved and enabled current Key','已清空当前 Key 内容':'Cleared current Key content',
  '给这个 Key 起个名字（例如「主号」「备用」）':'Name this Key (e.g. "Main" or "Backup")',
  '粘贴 API Key（sk- 开头）':'Paste API Key (starts with sk-)','已新增并切换到':'Added and switched to ',
  '没有找到包含':'No chat records containing ','的聊天记录':'',
  '点按可切换厂商':'Tap to switch provider','模型':'Model','官网':'Site','获取 Key':'Get Key',
  'Key 形如':'Key looks like','免费':'Free','付费':'Paid',
  '支持 DeepSeek / 智谱 / Gemini / Claude / GPT，Key 与所选厂商不匹配会报错':'Supports DeepSeek / Zhipu / Gemini / Claude / GPT. A mismatched Key will trigger an error.',
  '使用':'Use','当前':'Current',
  // --- 第四批：使用说明页 / 个人资料页 / 详细资料页 ---
  '使用说明':'Help',
  '本地字体':'Local Fonts',
  '＋ 从手机导入字体文件':'+ Import font from phone',
  '这是「蛛丝」的完整功能清单。带 ✅ 的可以直接用，带 ⚠️ 的有前提条件，带 ❌ 的当前版本用不了，别在那儿卡住。':'Full feature list of Spider. ✅ = works now, ⚠️ = has prerequisites, ❌ = not available in this build.',
  '可以用的':'Available',
  '12 项':'12 items',
  '有前提的':'With Prereqs',
  '4 项':'4 items',
  '用不了的':'Not Available',
  '6 项':'6 items',
  '特殊情况':'Special Notes',
  '✅ 可以用的功能':'✅ Available Features',
  '上下文记忆':'Context Memory',
  '多个会话':'Multiple Chats',
  '发图片（识图）':'Send Images (Vision)',
  '在「我 → 人设卡」里建多张卡，每张一套性格设定，切换卡就等于换个人格聊天。内置的「像素蜘蛛」卡不可删。卡上右侧「⋯」可编辑、重命名、删除。':'Create multiple cards under Me -> Personas, each with its own personality. Switching cards = chatting with a different persona. The built-in Pixel Spider card cannot be deleted. The ⋯ on each card allows edit, rename, delete.',
  'API Key 管理':'API Key Management',
  '支持存多个 Key，随时切换。Key 只存在这台手机里，不上传。点眼睛图标可以查看明文。':'Store multiple Keys and switch anytime. Keys stay on this phone and are never uploaded. Tap the eye icon to reveal.',
  '模型切换':'Model Switching',
  '动态（朋友圈）':'Moments',
  '「动态」页可以发图文动态，纯本地，只有你自己看得到。':'Post text and images on the Moments page. Fully local, only visible to you.',
  '会话「⋯」菜单':'Chat ⋯ Menu',
  '聊天页右上角「⋯」里藏着一堆操作：重命名会话、重新生成回复、复制最后回复、搜索本会话、聊天背景、导出此会话、清空此会话、删除此会话。不知道命令在哪儿找的，先点这里。':'The ⋯ at the top right of the chat page holds many actions: rename chat, regenerate reply, copy last reply, search this chat, chat background, export chat, clear chat, delete chat. If you can\'t find a command, look here first.',
  '联系人「⋯」开关':'Contact ⋯ Switches',
  '点联系人详情右上角「⋯」可开关：让 TA 自己发朋友圈、主动评论互动、显示思考、显示推理过程。关掉后对应行为就不会发生。':'Tap ⋯ at the top right of the contact detail page to toggle: let TA post moments, auto-comment, show thoughts, show reasoning. When off, the behavior will not happen.',
  '对话姿态':'Chat Stance',
  '聊天页右上角有个姿态按钮，点开可选四档：认真事务、情感剖白、角色扮演、抽离讨论。换档后在下一轮回复生效，档位会记住，下次打开还是那一档。':'There is a stance button at the top right of the chat page. Tap it to choose one of four modes: Serious Business, Emotional Confession, Role Play, Detached Discussion. A new stance takes effect on the next reply, is remembered, and persists the next time you open the app.',
  '数据备份 / 恢复':'Data Backup / Restore',
  '在「关于」页最下面。导出会生成一个 JSON 文件，含全部会话、动态、人设卡和设置。换手机或者要清数据前，先导一份。':'At the bottom of the About page. Export creates a JSON file with all chats, moments, personas and settings. Export one before switching phones or clearing data.',
  '⚠️ 有前提条件的功能':'⚠️ Features With Prerequisites',
  '发图片需要选对模型':'Vision Requires the Right Model',
  'DeepSeek 里 deepseek-flash 能识图、deepseek-v4-pro 不行；Gemini / Claude / GPT 只要对应厂商支持看图就能识图。用不支持看图的模型发图，AI 是「看不见」的，别以为它装傻。':'Within DeepSeek, deepseek-flash can see images while deepseek-v4-pro cannot; Gemini / Claude / GPT can see images as long as that model supports vision. Sending images to a non-vision model means the AI is blind to them.',
  '附件必须在系统文件里先存在':'Attachments Must Exist in System Files',
  '选图走的是系统文件选择器。如果某个 App 保存的图选不到，先把它存到「下载」目录再选，基本都能解决。':'Image picking uses the system file picker. If an app\'s images can\'t be selected, save them to the Downloads folder first.',
  '花钱的事':'About Costs',
  '用的是你自己的 DeepSeek Key，按量计费。高峰时段（周一至周五 9:00-12:00、14:00-18:00）单价贵一倍左右，其余时段便宜。多轮对话别老是清空历史，缓存命中的价格差几十倍。':'You use your own DeepSeek Key, billed by usage. Peak hours (Mon-Fri 9:00-12:00, 14:00-18:00) cost about double; off-peak is cheaper. Do not clear history often: cache hits are dozens of times cheaper.',
  '本地存储有上限':'Local Storage Limit',
  '所有数据存在浏览器本地存储里，长期不用又不清理，可能会满。「关于」页能看到当前占用。满了就导出备份后清一次。':'All data is stored in browser local storage. If not cleaned, it may fill up. See usage on the About page. Export a backup and clear it when full.',
  '❌ 当前版本没有 / 用不了':'❌ Not Available in This Build',
  '联网搜索':'Web Search',
  '这个功能已经整个拆掉了。AI 只知道训练时的事，问它实时新闻、今天的天气、最新股价，它答不了，别指望。':'This feature was removed entirely. The AI only knows its training data and cannot answer about real-time news, today\'s weather or latest stock prices.',
  '一次发多张图':'Send Multiple Images at Once',
  '目前只支持单张。要发多张就一张张来。':'Only one image is supported for now. Send them one by one.',
  '语音输入 / 朗读':'Voice Input / TTS',
  '没有。所有输入都靠打字。':'None. All input is by typing.',
  '云端同步 / 多设备':'Cloud Sync / Multi-device',
  '没有账号系统，数据只在这台手机上。换手机请用「导出备份 → 导入备份」。':'No account system, data stays on this phone. To switch phones, use Export Backup -> Import Backup.',
  '重新生成 / 编辑已发出的消息':'Regenerate / Edit Sent Messages',
  '没有这两个按钮。想改就让 AI 重说一遍，或者删掉这个会话重开。':'No such buttons. Ask the AI to say it again, or delete and restart the chat.',
  'AI 主动发消息 / 定时提醒':'AI-Initiated Messages / Reminders',
  '没有。App 关了就完全停了，不会有任何后台推送。':'None. Closing the app stops everything; there are no background pushes.',
  '📌 一些特殊情况说明':'📌 Special Notes',
  '改了设置但没生效？':'Changed Settings But No Effect?',
  'Key、模型这类改完点「保存」才生效；温度和最大长度是「下次发送」生效，不会影响已经发出的消息。':'Key and model take effect after tapping Save; temperature and max length apply to the next send and do not affect sent messages.',
  '清空数据的后果':'Consequences of Clearing Data',
  '「清空全部数据」会删掉会话、动态、人设卡，但会保留你的 API Key、模型选择和设置。清之前强烈建议先导备份。':'Clear All Data deletes chats, moments and personas, but keeps your API Key, model choice and settings. Strongly recommend exporting a backup first.',
  'AI 回复特别慢或报错':'AI Reply Very Slow or Error',
  '多半是 Key 没配额了、网络断了，或者服务商在高峰期排队。先在「关于」页确认接口地址和模型对不对，再检查 Key 余额。':'Usually the Key is out of quota, the network dropped, or the provider is queueing at peak. Check the API host and model on the About page, then the Key balance.',
  '它是给自己用的':'It Is for Personal Use',
  '不上架、不分享、不做技术支持。把它当个顺手的私人工具就行。':'Not published, not shared, no technical support. Just treat it as a handy private tool.',
   '问客服':'Ask Support',
  '只回答这个 App 的用法':'Only answers questions about this app',
  '这些信息会自动附在每次对话的最前面，让 AI 更懂你。留空的项不会发送。':'This info is attached to the front of every conversation so the AI understands you better. Empty fields are not sent.',
  '我的头像':'My Avatar',
  '点左侧方框选择图片（自动裁剪为方形）':'Tap the box on the left to pick an image (auto-cropped to square)',
  '关闭后聊天、动态里都不显示头像，回到纯文字版。':'When off, avatars are hidden in chats and moments, back to text only.',
  '基础':'Basics',
  '年龄':'Age',
  '性别':'Gender',
  '职业 / 身份':'Job / Role',
  '性格与沟通':'Personality & Communication',
  '性格':'Personality',
  '外貌':'Appearance',
  '衣着':'Clothing',
  '说话 / 沟通偏好':'Speaking / Communication Style',
  '背景':'Background',
  '所在地':'Location',
  '当前状态':'Current Status',
  '好恶与能力':'Likes, Dislikes & Skills',
  '喜好':'Likes',
  '厌恶':'Dislikes',
  '擅长':'Skills',
  '短板 / 弱点':'Weaknesses / Shortcomings',
  '边界与补充':'Boundaries & Extras',
  '禁忌底线':'Taboos',
  '自由备注':'Free Notes',
  '已填写 0 / 16 项':'Filled 0 / 16 fields',
  '清空全部':'Clear All',
  '详细资料':'Details',
  '备注':'Alias',
  '设置头像':'Set Avatar',
  '朋友圈':'Moments',
  '字数':'Characters',
  '聊天记录':'Chat History',
  '删除联系人':'Delete Contact',
  '让 TA 自己发朋友圈':'Let TA post moments',
  '发一条动态':'Post a moment',
  '主动评论互动':'Auto-comment on posts',
  '显示思考':'Show thoughts',
  '显示推理过程':'Show reasoning',
  '编辑 API Key':'Edit API Key',
  '名称':'Name',
  '厂商':'Provider',
  '例如：老板 / 阿橙':'e.g. Boss / A-Cheng',
  '例如：20 岁':'e.g. 20',
  '男 / 女':'Male / Female',
  '例如：学生 / 开发':'e.g. Student / Developer',
  '例如：急性子，怕麻烦，想清楚了就干':'e.g. Impatient, hates hassle, acts once decided',
  '例如：个子不高，及腰黑长直，圆框眼镜':'e.g. Not tall, waist-length black hair, round-frame glasses',
  '例如：常穿宽松针织衫 + 帆布鞋，冬天围驼色围巾':'e.g. Loose knitwear and sneakers, camel scarf in winter',
  '例如：直接给结论，别客套；给完整可复制的代码；少用表情':'e.g. Give conclusions directly, no pleasantries; provide complete copy-paste code; few emojis',
  '例如：杭州':'e.g. Hangzhou',
  '例如：大三在读，业余在做一个自用的 AI 聊天 App':'e.g. Junior in college, building a private AI chat app in spare time',
  '例如：写代码、打游戏、听摇滚':'e.g. Coding, gaming, rock music',
  '例如：香菜、迟到、被催':'e.g. Cilantro, being late, being rushed',
  '例如：拆需求、找 bug、做界面':'e.g. Breaking down requirements, finding bugs, building UI',
  '例如：数学一般、容易钻牛角尖、拖延':'e.g. Average at math, tends to overthink, procrastinates',
  '任何想让 AI 知道的事，例如当前在做的项目、目标、禁忌话题等':'Anything you want the AI to know, e.g. current projects, goals, off-limit topics',
  '和 AI 真对话，流式输出（一个字一个字蹦），支持 Markdown 渲染、代码块、表格，回复完自动滚到底。':'Real chat with AI, streaming output (word by word), supports Markdown, code blocks, tables, auto-scrolls to bottom.',
  'AI 记得前面聊过什么。带多少条在「我 → 上下文条数」里调，0 = 不带历史。条数越多越贵，缓存命中能便宜很多。':'The AI remembers earlier messages. Adjust how many to include under Me -> Context Size. 0 = no history. More = pricier, cache hits save a lot.',
  '「消息」页可以建多个对话，长按或左滑能删除。会话列表左滑删除时别滑太靠边，靠边是唤出侧边栏的手势。':'The Messages page supports multiple chats; long-press or swipe left to delete. Do not swipe too close to the edge, that gesture opens the sidebar.',
  '点输入框左边的回形针选图，可以发给 AI 让它看图。一次只能发一张。图片只用于当次发送，不会长期存在手机里（关掉就没了）。':'Tap the paperclip left of the input to pick an image for the AI to see. One image at a time. Images are used for that send only and are not stored long-term.',
  '「我 → AI 模型」里选。DeepSeek 的 deepseek-flash 快而便宜、支持看图，deepseek-v4-pro 更强更贵、不支持看图；另可选智谱 / Gemini / Claude / GPT，注意 Key 要与所选厂商匹配，不匹配会报错。':'Choose under Me -> AI Model. DeepSeek: deepseek-flash is fast, cheap and supports vision; deepseek-v4-pro is stronger and pricier, without vision. You can also pick Zhipu / Gemini / Claude / GPT — make sure the Key matches the chosen provider, or it will error.',
  '「我 → 个性装扮」里换主题配色、圆角、聊天背景（纯色或自己的图，可裁剪）、字体。改了立刻生效。':'Change theme colors, corner radius, chat background (solid or your own image, croppable) and font under Me -> Appearance. Changes take effect immediately.',
  // --- 第五批：人设编辑页 / 朋友圈人页 / 消息长按菜单 ---
  '模糊':'Fuzzy','精确':'Exact',
  '未设置':'Not set','切换':'Switch',
  '聊天':'Chat','消息':'Messages',
  '人':'P','未命名':'Unnamed',
  '填好的内容会拼成这张卡的人设，对话时自动发给 AI。留空的项不会发送。':'Filled-in items are combined into this card’s persona and sent to the AI automatically in chats. Blank items are not sent.',
  '姓名':'Name','身份':'Identity',
  '职业':'Occupation',
  '形象与性格':'Appearance & Personality',
  '说话风格':'Speaking Style',
  '背景故事':'Background',
  '与我的关系':'Relationship with Me',
  '能力特长':'Skills',
  '弱点缺陷':'Weaknesses',
  '补充设定 / 备注':'Extra Settings / Notes',
  '已填写 0 / 17 项':'0 of 17 filled',
  '引用':'Quote','重新生成':'Regenerate',
  '删除这条':'Delete this',
  '取消':'Cancel','删除':'Delete',
  '例如：最烦说\'作为一个AI\'；不要反复确认；别长篇大论':'e.g. hates “as an AI”; don’t keep confirming; keep it short',
  '例如：最烦说&#39;作为一个AI&#39;；不要反复确认；别长篇大论':'e.g. hates “as an AI”; don’t keep confirming; keep it short',
  '例如：林晚星':'e.g. Lin Wanxing',
  '例如：22':'e.g. 22',
  '男 / 女 / 其他':'Male / Female / Other',
  '例如：女主角 / 学姐':'e.g. heroine / senior',
  '例如：大学生 / 插画师':'e.g. student / illustrator',
  '例如：外冷内热，嘴硬心软，认生':'e.g. cold outside, warm inside; spiky but soft-hearted; shy',
  '例如：短句，偶尔毒舌，少用感叹号':'e.g. short sentences, occasionally snarky, rarely exclamation marks',
  '例如：从小跟外婆长大，大学独自来到杭州':'e.g. raised by grandma, came to Hangzhou alone for university',
  '例如：同校学姐，认识了三年':'e.g. senior at the same school, known her for three years',
  '例如：咖啡、雨天、老电影':'e.g. coffee, rainy days, old movies',
  '例如：手绘、记路很准':'e.g. hand drawing, great sense of direction',
  '例如：怕黑，路痴，嘴硬不肯认错':'e.g. afraid of the dark; bad sense of direction; never admits fault',
  '例如：不聊家人；不主动提分手这类话题':'e.g. no family talk; never bring up breaking up',
  '任何其他设定，例如口癖、习惯动作、称呼你的方式':'Any other settings, e.g. catchphrases, habits, how she calls you',
  '页面背景':'Page background','已设置':'Set','缺省':'Default',
  '选择页面':'Choose page','背景设置':'Background settings',
  '当前页面没有设置背景。':'This page has no background set.',
  '清晰/模糊度':'Sharp / Blur','恢复默认（跟随主题）':'Reset to default (follow theme)',
  '已恢复默认（跟随主题）。':'Reset to default (follow theme).',
  '点选左侧页面，下方设置仅对该页生效。背景仅在「默认 · 通透磨砂」主题下生效。':'Tap a page on the left; settings below apply to that page only. Background works only under the "Default · Frosted" theme.',
};
/* 运行时翻译：与 data-i18n 同一套 EN_MAP，给 JS 渲染的文本用 */
function T(zh) {
  const v = getLang();
  if (v === 'zh' || !zh) return zh;
  if (v === 'zhHant') return toHant(zh);
  return (EN_MAP[zh] || zh);
}
function applyLang() {
  const v = getLang();
  document.body.setAttribute('data-lang', v);
  const seg = $('langSeg');
  if (seg) {
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.getAttribute('data-lang') === v);
    });
  }
  // 遍历带 data-i18n 的节点做替换；无标记的文本节点做轻量处理
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!el._i18nZh) el._i18nZh = el.textContent;
    const zh = el._i18nZh;
    if (v === 'zh') el.textContent = zh;
    else if (v === 'zhHant') el.textContent = toHant(zh);
    else el.textContent = (EN_MAP[zh] || zh);
  });
  // placeholder 单独处理：这类元素（input/textarea）不能用 textContent
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    if (!el._i18nPhZh) el._i18nPhZh = el.getAttribute('placeholder') || key;
    const zh = el._i18nPhZh;
    if (v === 'zh') el.setAttribute('placeholder', zh);
    else if (v === 'zhHant') el.setAttribute('placeholder', toHant(zh));
    else el.setAttribute('placeholder', (EN_MAP[zh] || zh));
  });
  /* 发送按钮强制纠正：它会被发送/停止逻辑直接改 textContent，
     且带 data-i18n 缓存可能被污染，故这里按当前 data-mode 用 T() 重设 */
  const sb = $('send');
  if (sb) {
    const stopping = sb.dataset.mode === 'stop';
    sb.textContent = T(stopping ? '停止' : '发送');
    sb.setAttribute('data-i18n', stopping ? '停止' : '发送');
    sb._i18nZh = stopping ? '停止' : '发送';
  }
}
function bindLangSeg() {
  const seg = $('langSeg');
  if (!seg || seg._bound) return;
  seg._bound = true;
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button[data-lang]');
    if (!btn) return;
    const v = btn.getAttribute('data-lang');
    if (LANG_STEPS.indexOf(v) < 0) return;
    try { LS.set(K_LANG, v); } catch (e) {}
    applyLang();
    if (typeof renderSessions === 'function') { try { renderSessions(); } catch (e) {} }
    if (typeof renderMsgSessions === 'function') { try { renderMsgSessions(); } catch (e) {} }
    if (typeof renderMoments === 'function') { try { renderMoments(); } catch (e) {} }
    if (typeof renderPersonaList === 'function') { try { renderPersonaList(); } catch (e) {} }
    if (typeof refreshPersonaHint === 'function') { try { refreshPersonaHint(); } catch (e) {} }
    if (typeof refreshAbout === 'function') { try { refreshAbout(); } catch (e) {} }
    if (typeof renderAll === 'function') { try { renderAll(); } catch (e) {} }
  });
}
function openAbout() {
  const p = $('aboutPage');
  if (p) {
    // 【修复·页面置顶】复用元素会保留上次的滚动位置，打开时归零
    try { p.scrollTop = 0; } catch (e) {}
    try { if (p.scrollTo) p.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {}
    p.classList.add('open');
    setTimeout(() => { try { p.scrollTop = 0; } catch (e) {} }, 320);
  }
  refreshAbout();
}
function closeAbout() {
  const p = $('aboutPage');
  if (p) p.classList.remove('open');
}
/* 使用说明页：与「关于」同款整页滑入 */
function openHelp() {
  const p = $('helpPage');
  if (p) {
    try { p.scrollTop = 0; } catch (e) {}
    try { if (p.scrollTo) p.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {}
    p.classList.add('open');
    setTimeout(() => { try { p.scrollTop = 0; } catch (e) {} }, 320);
  }
}
function closeHelp() {
  const p = $('helpPage');
  if (p) p.classList.remove('open');
}

/* 全局版：取当前选中 Key 的完整对象（不依赖 bindSettings 内的局部 curKeyObj） */
function aboutCurKeyObj() {
  try {
    const raw = LS.get(K_KEYS);
    let o = raw ? JSON.parse(raw) : null;
    if (!o || !Array.isArray(o.list)) o = { list: [], cur: '' };
    const list = o.list.filter(x => x && typeof x.key === 'string' && x.key.trim());
    if (!list.length) return null;
    const cur = list.filter(x => x.id === o.cur)[0];
    return cur || list[0];
  } catch (e) { return null; }
}
/* 刷新关于页的动态信息（接口 / 模型 / 本地存储占用） */
function refreshAbout() {
  /* 版本号：直接读代码里的常量，永远与真实版本一致 */
  const verEl = $('aboutVersion');
  if (verEl) {
    verEl.textContent = (typeof LOCAL_VERSION !== 'undefined' ? LOCAL_VERSION : '-');
  }
  const apiEl = $('aboutApi');
  if (apiEl) {
    const ck = aboutCurKeyObj();
    const p = (ck && ck.provider && PROVIDERS[ck.provider]) ? PROVIDERS[ck.provider] : PROVIDERS.deepseek;
    const owner = $('aboutApiOwner');
    if (owner) owner.textContent = (ck && ck.provider) ? T(p.name) : '';
    apiEl.textContent = p.base.replace(/^https?:\/\//, '').replace(/\/chat\/completions$/, '');
  }
  const mEl = $('aboutModel');
  if (mEl) {
    const ck = aboutCurKeyObj();
    // Key 对象里的 model 形如 "deepseek/deepseek-flash"，显示时去掉厂商前缀
    const rawM = (ck && ck.model) ? ck.model : curModelStr();
    const mid = String(rawM || '').split('/').pop() || 'deepseek-flash';
    mEl.textContent = mid;
  }

  const sEl = $('aboutStorage');
  if (sEl) {
    let bytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = LS.rawGet(k) || '';
        bytes += (k.length + v.length) * 2;   // UTF-16 双字节
      }
    } catch (e) { /* 读不到就显示 - */ }
    const kb = bytes / 1024;
    const txt = kb >= 1024 ? (kb / 1024).toFixed(2) + ' MB' : kb.toFixed(1) + ' KB';
    // localStorage 上限通常 5MB
    const pct = Math.min(100, (bytes / (5 * 1024 * 1024)) * 100).toFixed(0);
    sEl.textContent = txt + ' / 5 MB (' + pct + '%)';
  }

  /* 累计消息条数 / 字数（遍历所有会话） */
  let totalMsgs = 0, totalChars = 0;
  try {
    (sessions || []).forEach(s => {
      (s.msgs || []).forEach(m => {
        totalMsgs++;
        totalChars += (m.content || '').length;
      });
    });
  } catch (e) { /* 忽略 */ }
  const msgEl = $('aboutMsgs');
  if (msgEl) msgEl.textContent = totalMsgs + T(' 条');
  const chEl = $('aboutChars');
  if (chEl) chEl.textContent = totalChars >= 10000
    ? (totalChars / 10000).toFixed(1) + T(' 万字')
    : totalChars + T(' 字');
}

/* ==================== v7: 在线更新检查（GitHub Pages + Service Worker） ==================== */
const REMOTE_VERSION_URL = './version.json';   // 与 index.html 同目录，Pages 上的版本号文件

/* 读取远端版本号；返回 {ok, version, build, note} */
async function fetchRemoteVersion() {
  try {
    const res = await fetch(REMOTE_VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return { ok: false, err: 'HTTP ' + res.status };
    const j = await res.json();
    return { ok: true, version: String(j.version || ''), build: Number(j.build || 0), note: String(j.note || '') };
  } catch (e) {
    return { ok: false, err: (e && e.message) ? e.message : '网络错误' };
  }
}

/* 点「检查更新」时执行 */
async function runUpdateCheck() {
  if (!navigator.onLine) {
    showAlert(T('当前没有网络，无法检查更新。'), T('检查更新'), 'ℹ');
    return;
  }
  const r = await fetchRemoteVersion();
  if (!r.ok) {
    showAlert(T('检查失败：') + T(r.err || '未知错误') + '\n' + T('（若是本地文件打开本 App，无法检查更新，需从网址加载）'), T('检查更新'), '⚠');
    return;
  }
  const localBuild = (typeof LOCAL_BUILD === 'number') ? LOCAL_BUILD : 0;
  if (r.build > localBuild) {
    askConfirm(
      T('发现新版本 ') + r.version + T('（当前 ') + LOCAL_VERSION + T('）\n') +
      (r.note ? T('更新内容：') + r.note + '\n' : '') +
      T('现在下载并启用新版本吗？'),
      T('检查更新'),
      () => applyUpdate()
    );
  } else {
    showAlert(T('已是最新版本（') + LOCAL_VERSION + T('）'), T('检查更新'), '✅');
  }
}

/* 应用更新：让 SW 重新拉取资源并重载页面 */
async function applyUpdate() {
  showAlert(T('正在下载新版本，完成后会自动刷新…'), T('更新中'), 'ℹ');
  try {
    // 清掉 SW 里旧的缓存（版本变了 SW 名会变，也可以直接 unregister 重装）
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const reg = window.__swReg || await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
  } catch (e) { /* 忽略，照常刷新 */ }
  setTimeout(() => { location.reload(); }, 600);
}

/* ==================== v6: 存储容量预警 ==================== */
const STORE_LIMIT = 5 * 1024 * 1024;   // localStorage 上限（字节），与关于页统计口径一致
const STORE_WARN_PCT = 80;             // 超过该占用率(％)触发预警

/* 统计本地存储占用（字节，UTF-16 双字节口径） */
function storageBytes() {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = LS.rawGet(k) || '';
      bytes += (k.length + v.length) * 2;
    }
  } catch (e) { /* 读不到按 0 处理 */ }
  return bytes;
}

/* 检查占用率，必要时弹出预警条 */
function checkStorageWarn() {
  const bar = $('storeWarn');
  if (!bar) return;
  // 用户已经点过某次「关闭」：占用率没再涨就不打扰
  let muted = 0;
  try { muted = parseInt(LS.get(K_STOREWARN) || '0', 10) || 0; } catch (e) {}
  const bytes = storageBytes();
  const pct = Math.min(100, Math.round((bytes / STORE_LIMIT) * 100));
  if (pct < STORE_WARN_PCT) { bar.classList.remove('open'); return; }
  if (pct <= muted) { bar.classList.remove('open'); return; }
  const txt = $('storeWarnText');
  if (txt) {
    const mb = (bytes / 1024 / 1024).toFixed(2);
    txt.textContent = T('本地存储已用 ') + pct + T('%（') + mb + T(' MB / 5 MB），建议清理旧会话');
  }
  bar.classList.add('open');
}

/* 绑定预警条按钮 */
function bindStorageWarn() {
  const go = $('storeWarnGo');
  const close = $('storeWarnClose');
  if (go) go.addEventListener('click', () => {
    const bar = $('storeWarn');
    if (bar) bar.classList.remove('open');
    document.body.setAttribute('data-tab', 'me');
    openAbout();
  });
  if (close) close.addEventListener('click', () => {
    const bar = $('storeWarn');
    if (bar) bar.classList.remove('open');
    // 记住「这个占用率已被忽略」，避免每次进页面都弹
    try {
      const bytes = storageBytes();
      const pct = Math.min(100, Math.round((bytes / STORE_LIMIT) * 100));
      LS.set(K_STOREWARN, String(pct));
    } catch (e) {}
  });
}

/* 清空全部本地数据（二次确认；保留 API Key、模型设置、人设卡与个人资料） */
function clearAllData() {
  askConfirm(
    '将删除所有会话、动态、上下文设置与缓存，且无法恢复。\nAPI Key、当前模型、人设卡和个人资料会被保留。\n建议先在「数据备份」里导出一次。',
    '清空全部数据',
    () => {
      askConfirm(T('最后确认：真的要清空吗？'), T('再次确认'), () => {
        const keep = {};
        [K_APIKEY, K_KEYS, K_MODEL, K_PERSONAS, K_PERSONA_CUR, K_PROFILE].forEach(k => {
          const v = LS.get(k);
          if (v !== null) keep[k] = v;
        });
        try { localStorage.clear(); } catch (e) {}
        Object.keys(keep).forEach(k => {
          try { LS.rawSet(k, keep[k]); } catch (e) {}
        });
        showAlert(T('已清空，API Key、模型设置、人设卡和个人资料已保留。页面即将重载。'), T('完成'), '🗑');
        setTimeout(() => location.reload(), 1000);
      });
    }
  );
}

/* 恢复出厂设置：清空「个人资料 + 所有人设卡」，只保留 API Key 与模型。
   人设卡清空后，下次 getPersonas() 会以内置卡出厂默认内容重建。 */
function factoryReset() {
  askConfirm(
    '将清空「个人资料（含头像）」和「所有自建人设卡」，并恢复人设卡为出厂默认。\n所有会话、动态也会一并清除。\nAPI Key 和当前模型会保留。\n此操作无法恢复，建议先导出备份。',
    '恢复出厂设置',
    () => {
      askConfirm(T('最后确认：真的要恢复出厂设置吗？'), T('再次确认'), () => {
        const keep = {};
        [K_APIKEY, K_MODEL].forEach(k => {
          const v = LS.get(k);
          if (v !== null) keep[k] = v;
        });
        try { localStorage.clear(); } catch (e) {}
        Object.keys(keep).forEach(k => {
          try { LS.rawSet(k, keep[k]); } catch (e) {}
        });
        showAlert(T('已恢复出厂设置，个人资料与人设卡已清空。页面即将重载。'), T('完成'), '🧹');
        setTimeout(() => location.reload(), 1000);
      });
    }
  );
}

/* ---------- 人设卡（多张，抽屉式） ---------- */
const K_PERSONAS = 'pixelspider_personas';        // JSON 数组：[{id,name,prompt}]
const K_PERSONA_CUR = 'pixelspider_persona_cur';  // 当前选中的卡 id

/* 内置卡：固定 id，不可删除，永远排第一张 */
const BUILTIN_PID = 'builtin-pixelspider';
const BUILTIN_NAME = '像素蜘蛛';
const BUILTIN_PROMPT =
  '【姓名】像素蜘蛛\n' +
  '【身份】通用小助手\n' +
  '【性格】耐心、直接、不啰嗦，遇到问题先给结论再给理由\n' +
  '【说话风格】口语化，中文回答；代码和命令用代码块，能直接复制就用完整的\n' +
  '【能力特长】写代码、改代码、查资料、整理信息、出主意、陪聊\n' +
  '【禁忌底线】不编造事实，不确定就直说不确定；不输出违法有害内容';

/* 生成/刷新内置卡对象（保留用户已改的内容，只补字段） */
function makeBuiltinCard(exist) {
  const base = exist && typeof exist === 'object' ? exist : {};
  return {
    id: BUILTIN_PID,
    name: BUILTIN_NAME,
    prompt: typeof base.prompt === 'string' ? base.prompt : BUILTIN_PROMPT,
    builtin: true,
    avatar: base.avatar || ''
  };
}

/* 读卡列表：保证内置卡始终存在、始终在第一位 */
function getPersonas() {
  let list = [];
  let broken = false;
  try {
    const raw = LS.get(K_PERSONAS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
      else broken = true;
    }
  } catch (e) { broken = true; }

  if (broken) {
    // 数据损坏：只返回内置卡用于展示，不写回（避免覆盖掉可能还能救的数据）
    return [makeBuiltinCard(null)];
  }

  list = list.filter(x => x && typeof x === 'object' && x.id);

  let bi = list.find(x => x.id === BUILTIN_PID) || null;
  list = list.filter(x => x.id !== BUILTIN_PID);
  list.unshift(makeBuiltinCard(bi));

  // 出厂状态：只保留内置卡，自建卡一律不再自动生成

  try {
    LS.set(K_PERSONAS, JSON.stringify(list));
    let cur = LS.get(K_PERSONA_CUR) || '';
    if (!list.some(x => x.id === cur)) {
      cur = BUILTIN_PID;
      LS.set(K_PERSONA_CUR, cur);
    }
  } catch (e) {}
  return list;
}
/* 是否内置卡（不可删、不可改名；内容仍可编辑） */
function isBuiltinPersona(pid) {
  return pid === BUILTIN_PID;
}
function savePersonas(list) {
  try {
    LS.set(K_PERSONAS, JSON.stringify(list));
  } catch (e) {
    console.warn('人设卡保存失败（可能超限）', e);
    if (typeof showAlert === 'function') {
      showAlert(T('人设卡保存失败：本地存储已满。请删掉一些不用的会话或人设卡图片后再试。'), T('保存失败'), '⚠️');
    }
  }
  // 云同步钩子（仅当开启「人设卡同步」且已登录时才真正发请求）
  if (typeof cloudOnLocalChange === 'function') { try { cloudOnLocalChange('personas'); } catch (e) {} }
}
function curPersonaId() {
  const list = getPersonas();
  let id = LS.get(K_PERSONA_CUR) || '';
  if (!list.some(x => x.id === id)) {
    id = list[0].id;
    try { LS.set(K_PERSONA_CUR, id); } catch (e) {}
  }
  return id;
}
/* 按 id 取某张卡（没有则返回 null） */
function getPersonaById(pid) {
  return getPersonas().find(x => x.id === pid) || null;
}

/* ---------- 人设卡型联系人（方案B：卡即联系人） ---------- */
/* 找到某张卡的专属会话（没有就返回 null） */
function findPersonaSession(pid) {
  return sessions.find(s => s && s.persona && s.pid === pid) || null;
}

/* 打开某张卡的联系人：有专属会话就切过去，没有就新建一个 */
function openPersonaContact(pid) {
  const card = getPersonaById(pid);
  if (!card) return;
  let s = findPersonaSession(pid);
  if (!s) {
    s = {
      id: uid(),
      title: personaNameOf(card),
      alias: '',
      pid: pid,
      persona: true,
      msgs: [],
      ts: Date.now()
    };
    sessions.push(s);
    persist();
  }
  // 进入该卡的对话，并把「当前人设卡」也切到这张
  LS.set(K_PERSONA_CUR, pid);
  if (typeof loadPromptToForm === 'function') loadPromptToForm();
  if (typeof renderPersonaList === 'function') renderPersonaList();
  if (typeof refreshPersonaHint === 'function') refreshPersonaHint();
  openChat(s.id);
}

/* 人设卡简介：只取【性别】字段，转成符号显示（没填就提示） */
function personaBrief(c) {
  const t = String((c && c.prompt) || '');
  const m = t.match(/【性别】([\s\S]*?)(?=【[^】]+】|$)/);
  const s = m ? String(m[1] || '').replace(/\s+/g, '').trim() : '';
  if (!s) return '—';
  if (/男/.test(s)) return '♂';
  if (/女/.test(s)) return '♀';
  return s;
}

/* 人设卡显示名：优先取【姓名】字段，没填则回退卡名 */
function personaNameOf(c) {
  const t = String((c && c.prompt) || '');
  const m = t.match(/【姓名】([\s\S]*?)(?=【[^】]+】|$)/);
  const n = m ? String(m[1] || '').replace(/\s+/g, ' ').trim() : '';
  if (n) return n;
  return (c && c.name) || T('未命名');
}

/* 取排序分组：
   统一按「首字母」排：英文取首字母，中文取拼音首字母，数字排在字母后，符号/空名最后。
   关键点：英文与中文共用同一套 A-Z 字母序，所以同一个字母下的中英文会聚在一起。 */
function contactSortKey(name) {
  const s = (name || '').trim();
  if (!s) return { g: 2, k: '' };                                 // 空名 → 最后
  const ch = s.charAt(0);
  const isHan = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
  if (/[A-Za-z]/.test(ch) || isHan) {
    const L = isHan ? pinyinInitial(ch) : ch.toUpperCase();
    if (L && L !== '#') return { g: 0, k: L + '\u0000' + s };     // 字母组，同字母内按全名排
    return { g: 2, k: ch };                                       // 拼音也取不到 → 归符号组
  }
  if (/[0-9]/.test(ch)) return { g: 1, k: ch };                   // 数字排在所有字母后
  return { g: 2, k: ch };                                         // 特殊符号 / emoji
}
/* ===== 汉字拼音首字母：完整查表（pypinyin 离线生成，GB2312 全 6763 字） =====
   表数据由 pypinyin 0.55.0 生成，PY_HAN 与 PY_LET 按 unicode 码位一一对应。
   毫不动用 ICU 排序，彻底避免锚点偏差：从 u4E00 逐字推算。 */
const PY_HAN = '一丁七万丈三上下丌不与丐丑专且丕世丘丙业丛东丝丞丢两严丧丨个丫丬中丰串临丶丸丹为主丽举丿乃久乇么义之乌乍乎乏乐乒乓乔乖乘乙乜九乞也习乡书乩买乱乳乾了予争事二亍于亏云互亓五井亘亚些亟亠亡亢交亥亦产亨亩享京亭亮亲亳亵人亻亿什仁仂仃仄仅仆仇仉今介仍从仑仓仔仕他仗付仙仝仞仟仡代令以仨仪仫们仰仲仳仵件价任份仿企伉伊伍伎伏伐休众优伙会伛伞伟传伢伤伥伦伧伪伫伯估伲伴伶伸伺似伽佃但位低住佐佑体何佗佘余佚佛作佝佞佟你佣佤佥佧佩佬佯佰佳佴佶佻佼佾使侃侄侈侉例侍侏侑侔侗供依侠侣侥侦侧侨侩侪侬侮侯侵便促俄俅俊俎俏俐俑俗俘俚俜保俞俟信俣俦俨俩俪俭修俯俱俳俸俺俾倌倍倏倒倔倘候倚倜借倡倥倦倨倩倪倬倭倮债值倾偃假偈偌偎偏偕做停健偬偶偷偻偾偿傀傅傈傍傣傥傧储傩催傲傺傻像僖僚僦僧僬僭僮僳僵僻儆儇儋儒儡儿兀允元兄充兆先光克免兑兔兕兖党兜兢入全八公六兮兰共关兴兵其具典兹养兼兽冀冁冂内冈冉册再冒冕冖冗写军农冠冢冤冥冫冬冯冰冱冲决况冶冷冻冼冽净凄准凇凉凋凌减凑凛凝几凡凤凫凭凯凰凳凵凶凸凹出击凼函凿刀刁刂刃分切刈刊刍刎刑划刖列刘则刚创初删判刨利别刭刮到刳制刷券刹刺刻刽刿剀剁剂剃削剌前剐剑剔剖剜剞剡剥剧剩剪副割剽剿劁劂劈劐劓力劝办功加务劢劣动助努劫劬劭励劲劳劾势勃勇勉勋勐勒勖勘募勤勰勹勺勾勿匀包匆匈匍匏匐匕化北匙匚匝匠匡匣匦匪匮匹区医匾匿十千卅升午卉半华协卑卒卓单卖南博卜卞卟占卡卢卣卤卦卧卩卫卮卯印危即却卵卷卸卺卿厂厄厅历厉压厌厍厕厘厚厝原厢厣厥厦厨厩厮厶去县叁参又叉及友双反发叔取受变叙叛叟叠口古句另叨叩只叫召叭叮可台叱史右叵叶号司叹叻叼叽吁吃各吆合吉吊同名后吏吐向吒吓吕吖吗君吝吞吟吠吡吣否吧吨吩含听吭吮启吱吲吴吵吸吹吻吼吾呀呃呆呈告呋呐呒呓呔呕呖呗员呙呛呜呢呤呦周呱呲味呵呶呷呸呻呼命咀咂咄咆咋和咎咏咐咒咔咕咖咙咚咛咝咣咤咦咧咨咩咪咫咬咭咯咱咳咴咸咻咽咿哀品哂哄哆哇哈哉哌响哎哏哐哑哒哓哔哕哗哙哚哜哝哞哟哥哦哧哨哩哪哭哮哲哳哺哼哽哿唁唆唇唉唏唐唑唔唛唠唢唣唤唧唪唬售唯唰唱唳唷唼唾唿啁啃啄商啉啊啐啕啖啜啡啤啥啦啧啪啬啭啮啵啶啷啸啻啼啾喀喁喂喃善喇喈喉喊喋喏喑喔喘喙喜喝喟喧喱喳喵喷喹喻喽喾嗄嗅嗉嗌嗍嗑嗒嗓嗔嗖嗜嗝嗟嗡嗣嗤嗥嗦嗨嗪嗫嗬嗯嗲嗳嗵嗷嗽嗾嘀嘁嘈嘉嘌嘎嘏嘘嘛嘞嘟嘣嘤嘧嘬嘭嘱嘲嘴嘶嘹嘻嘿噌噍噎噔噗噘噙噜噢噤器噩噪噫噬噱噶噻噼嚅嚆嚎嚏嚓嚣嚯嚷嚼囊囔囗囚四囝回囟因囡团囤囫园困囱围囵囹固国图囿圃圄圆圈圉圊圜土圣在圩圪圬圭圮圯地圳圹场圻圾址坂均坊坌坍坎坏坐坑块坚坛坜坝坞坟坠坡坤坦坨坩坪坫坭坯坳坶坷坻坼垂垃垄垅垆型垌垒垓垛垠垡垢垣垤垦垧垩垫垭垮垲垴垸埂埃埋城埏埒埔埕埘埙埚埝域埠埤埭埯埴埸培基埽堀堂堆堇堋堍堑堕堙堞堠堡堤堪堰堵塄塌塍塑塔塘塞塥填塬塾墀墁境墅墉墒墓墙墚增墟墨墩墼壁壅壑壕壤士壬壮声壳壶壹夂处备复夏夔夕外夙多夜够夤夥大天太夫夭央夯失头夷夸夹夺夼奁奂奄奇奈奉奋奎奏契奔奕奖套奘奚奠奢奥女奴奶奸她好妁如妃妄妆妇妈妊妍妒妓妖妗妙妞妣妤妥妨妩妪妫妮妯妲妹妻妾姆姊始姐姑姒姓委姗姘姚姜姝姣姥姨姬姹姻姿威娃娄娅娆娇娈娉娌娑娓娘娜娟娠娣娥娩娱娲娴娶娼婀婆婉婊婕婚婢婧婪婴婵婶婷婺婿媒媚媛媪媲媳媵媸媾嫁嫂嫉嫌嫒嫔嫖嫘嫜嫠嫡嫣嫦嫩嫫嫱嬉嬖嬗嬲嬴嬷孀子孑孓孔孕字存孙孚孛孜孝孟孢季孤孥学孩孪孬孰孱孳孵孺孽宀宁它宄宅宇守安宋完宏宓宕宗官宙定宛宜宝实宠审客宣室宥宦宪宫宰害宴宵家宸容宽宾宿寂寄寅密寇富寐寒寓寝寞察寡寤寥寨寮寰寸对寺寻导寿封射将尉尊小少尔尕尖尘尚尜尝尢尤尥尧尬就尴尸尹尺尻尼尽尾尿局屁层居屈屉届屋屎屏屐屑展屙属屠屡屣履屦屮屯山屹屺屿岁岂岈岌岍岐岑岔岖岗岘岙岚岛岜岢岣岩岫岬岭岱岳岵岷岸岽岿峁峄峋峒峙峡峤峥峦峨峪峭峰峻崂崃崆崇崎崔崖崛崞崤崦崧崩崭崮崴崽崾嵇嵊嵋嵌嵘嵛嵝嵩嵫嵬嵯嵴嶂嶙嶝嶷巅巍巛川州巡巢工左巧巨巩巫差巯己已巳巴巷巽巾币市布帅帆师希帏帐帑帔帕帖帘帙帚帛帜帝带帧席帮帱帷常帻帼帽幂幄幅幌幔幕幛幞幡幢干平年并幸幺幻幼幽广庀庄庆庇床庋序庐庑库应底庖店庙庚府庞废庠庥度座庭庳庵庶康庸庹庾廉廊廑廒廓廖廛廨廪廴延廷建廾廿开弁异弃弄弈弊弋式弑弓引弗弘弛弟张弥弦弧弩弪弭弯弱弹强弼彀彐归当录彖彗彘彝彡形彤彦彩彪彬彭彰影彳彷役彻彼往征徂径待徇很徉徊律後徐徒徕得徘徙徜御徨循徭微徵德徼徽心忄必忆忉忌忍忏忐忑忒忖志忘忙忝忠忡忤忧忪快忭忮忱念忸忻忽忾忿怀态怂怃怄怅怆怊怍怎怏怒怔怕怖怙怛怜思怠怡急怦性怨怩怪怫怯怵总怼怿恁恂恃恋恍恐恒恕恙恚恝恢恣恤恧恨恩恪恫恬恭息恰恳恶恸恹恺恻恼恽恿悃悄悉悌悍悒悔悖悚悛悝悟悠患悦您悫悬悭悯悱悲悴悸悻悼情惆惊惋惑惕惘惚惜惝惟惠惦惧惨惩惫惬惭惮惯惰想惴惶惹惺愀愁愆愈愉愍愎意愕愚感愠愣愤愦愧愫愿慈慊慌慎慑慕慝慢慧慨慰慵慷憋憎憔憝憧憨憩憬憷憾懂懈懊懋懑懒懔懦懵懿戆戈戊戋戌戍戎戏成我戒戕或戗战戚戛戟戡戢戤戥截戬戮戳戴户戽戾房所扁扃扇扈扉手扌才扎扑扒打扔托扛扣扦执扩扪扫扬扭扮扯扰扳扶批扼找承技抄抉把抑抒抓投抖抗折抚抛抟抠抡抢护报抨披抬抱抵抹抻押抽抿拂拄担拆拇拈拉拊拌拍拎拐拒拓拔拖拗拘拙拚招拜拟拢拣拥拦拧拨择括拭拮拯拱拳拴拶拷拼拽拾拿持挂指挈按挎挑挖挚挛挝挞挟挠挡挢挣挤挥挨挪挫振挲挹挺挽捂捃捅捆捉捋捌捍捎捏捐捕捞损捡换捣捧捩捭据捱捶捷捺捻掀掂掇授掉掊掌掎掏掐排掖掘掠探掣接控推掩措掬掭掮掰掳掴掷掸掺掼掾揄揆揉揍揎描提插揖揞揠握揣揩揪揭揲援揶揸揽揿搀搁搂搅搋搌搏搐搓搔搛搜搞搠搡搦搪搬搭搴携搽搿摁摄摅摆摇摈摊摒摔摘摞摧摩摭摸摹摺撂撄撅撇撑撒撕撖撙撞撤撩撬播撮撰撵撷撸撺撼擀擂擅操擎擐擒擗擘擞擢擤擦攀攉攒攘攥攫攮支攴攵收攸改攻放政故效敉敌敏救敕敖教敛敝敞敢散敦敫敬数敲整敷文斋斌斐斑斓斗料斛斜斟斡斤斥斧斩斫断斯新方於施旁旃旄旅旆旋旌旎族旒旖旗无既日旦旧旨早旬旭旮旯旰旱时旷旺昀昂昃昆昊昌明昏易昔昕昙昝星映春昧昨昭是昱昴昵昶昼显晁晃晋晌晏晒晓晔晕晖晗晚晟晡晤晦晨普景晰晴晶晷智晾暂暄暇暌暑暖暗暝暧暨暮暴暹暾曙曛曜曝曦曩曰曲曳更曷曹曼曾替最月有朊朋服朐朔朕朗望朝期朦木未末本札术朱朴朵机朽杀杂权杆杈杉杌李杏材村杓杖杜杞束杠条来杨杩杪杭杯杰杲杳杵杷杼松板极构枇枉枋析枕林枘枚果枝枞枢枣枥枧枨枪枫枭枯枰枳枵架枷枸柁柃柄柏某柑柒染柔柘柙柚柜柝柞柠柢查柩柬柯柰柱柳柴柽柿栀栅标栈栉栊栋栌栎栏树栓栖栗栝校栩株栲栳样核根格栽栾桀桁桂桃桄桅框案桉桊桌桎桐桑桓桔桕桠桡桢档桤桥桦桧桨桩桫桴桶桷梁梃梅梆梏梓梗梢梦梧梨梭梯械梳梵检棂棉棋棍棒棕棘棚棠棣森棰棱棵棹棺棼椁椅椋植椎椐椒椟椠椤椭椰椴椹椽椿楂楔楗楚楝楞楠楣楦楫楮楱楷楸楹楼榀概榄榆榇榈榉榍榔榕榘榛榜榧榨榫榭榱榴榷榻槁槊槌槎槐槔槛槟槠槭槲槽槿樊樗樘樟模樨横樯樱樵樽樾橄橇橐橘橙橛橡橥橱橹橼檀檄檎檐檑檗檠檩檫檬欠次欢欣欤欧欲欷欹欺款歃歆歇歉歌歙止正此步武歧歪歹死歼殁殂殃殄殆殇殉殊残殍殒殓殖殚殛殡殪殳殴段殷殿毁毂毅毋母每毒毓比毕毖毗毙毛毡毪毫毯毳毵毹毽氅氆氇氍氏氐民氓气氕氖氘氙氚氛氟氡氢氤氦氧氨氩氪氮氯氰氲水氵永氽汀汁求汆汇汉汊汐汔汕汗汛汜汝汞江池污汤汨汩汪汰汲汴汶汹汽汾沁沂沃沅沆沈沉沌沏沐沓沔沙沛沟没沣沤沥沦沧沩沪沫沭沮沱沲河沸油治沼沽沾沿泄泅泉泊泌泐泓泔法泖泗泛泞泠泡波泣泥注泪泫泮泯泰泱泳泵泶泷泸泺泻泼泽泾洁洄洇洋洌洎洒洗洙洚洛洞津洧洪洫洮洱洲洳洵洹活洼洽派流浃浅浆浇浈浊测浍济浏浑浒浓浔浙浚浜浞浠浣浦浩浪浮浯浴海浸浼涂涅消涉涌涎涑涓涔涕涛涝涞涟涠涡涣涤润涧涨涩涪涫涮涯液涵涸涿淀淄淅淆淇淋淌淑淖淘淙淝淞淠淡淤淦淫淬淮深淳混淹添淼清渊渌渍渎渐渑渔渖渗渚渝渠渡渣渤渥温渫渭港渲渴游渺湃湄湍湎湓湔湖湘湛湟湫湮湾湿溃溅溆溉溏源溘溜溟溢溥溧溪溯溱溲溴溶溷溺溻溽滁滂滇滋滏滑滓滔滕滗滚滞滟滠满滢滤滥滦滨滩滴滹漂漆漉漏漓演漕漠漤漩漪漫漭漯漱漳漶漾潆潇潋潍潘潜潞潢潦潭潮潲潴潸潺潼澄澈澉澌澍澎澜澡澧澳澶澹激濂濉濑濒濞濠濡濮濯瀑瀚瀛瀣瀵瀹灌灏灞火灬灭灯灰灵灶灸灼灾灿炀炅炉炊炎炒炔炕炖炙炜炝炫炬炭炮炯炱炳炷炸点炻炼炽烀烁烂烃烈烊烘烙烛烟烤烦烧烨烩烫烬热烯烷烹烽焉焊焐焓焕焖焘焙焚焦焯焰焱然煅煊煌煎煜煞煤煦照煨煮煲煳煸煺煽熄熊熏熔熘熙熟熠熨熬熳熵熹燃燎燔燕燠燥燧燮燹爆爝爨爪爬爰爱爵父爷爸爹爻爽爿片版牌牍牒牖牙牛牝牟牡牢牦牧物牮牯牲牵特牺牾牿犀犁犄犊犋犍犏犒犟犬犭犯犰犴状犷犸犹狁狂狃狄狈狍狎狐狒狗狙狞狠狡狨狩独狭狮狯狰狱狲狳狴狷狸狺狻狼猁猃猊猎猓猕猖猗猛猜猝猞猡猢猥猩猪猫猬献猱猴猷猸猹猾猿獍獐獒獗獠獬獭獯獾玄率玉王玎玑玖玛玟玢玩玫玮环现玲玳玷玺玻珀珂珈珉珊珍珏珐珑珙珞珠珥珧珩班珲球琅理琉琊琏琐琚琛琢琥琦琨琪琬琮琰琳琴琵琶琼瑁瑕瑗瑙瑚瑛瑜瑞瑟瑭瑰瑶瑷瑾璀璁璃璇璋璎璐璜璞璧璨璩璺瓒瓜瓞瓠瓢瓣瓤瓦瓮瓯瓴瓶瓷瓿甄甍甏甑甓甘甙甚甜生甥用甩甫甬甭甯田由甲申电男甸町画甾畀畅畈畋界畎畏畔留畚畛畜略畦番畲畴畸畹畿疃疆疋疏疑疒疔疖疗疙疚疝疟疠疡疣疤疥疫疬疮疯疰疱疲疳疴疵疸疹疼疽疾痂痃痄病症痈痉痊痍痒痔痕痖痘痛痞痢痣痤痦痧痨痪痫痰痱痴痹痼痿瘀瘁瘃瘅瘊瘌瘐瘕瘗瘘瘙瘛瘟瘠瘢瘤瘥瘦瘩瘪瘫瘭瘰瘳瘴瘵瘸瘼瘾瘿癀癃癌癍癔癖癜癞癣癫癯癸登白百皂的皆皇皈皋皎皑皓皖皙皤皮皱皲皴皿盂盅盆盈益盍盎盏盐监盒盔盖盗盘盛盟盥目盯盱盲直相盹盼盾省眄眇眈眉看眍眙眚真眠眢眦眨眩眭眯眵眶眷眸眺眼着睁睃睇睐睑睚睛睡睢督睥睦睨睫睬睹睽睾睿瞀瞄瞅瞌瞍瞎瞑瞒瞟瞠瞢瞥瞧瞩瞪瞬瞰瞳瞵瞻瞽瞿矍矗矛矜矢矣知矧矩矫矬短矮石矶矸矽矾矿砀码砂砉砌砍砑砒研砖砗砘砚砜砝砟砣砥砦砧砩砬砭砰破砷砸砹砺砻砼砾础硅硇硌硎硐硒硕硖硗硝硪硫硬硭确硷硼碇碉碌碍碎碑碓碗碘碚碛碜碟碡碣碥碧碰碱碲碳碴碹碾磁磅磉磊磋磐磔磕磙磨磬磲磴磷磺礁礅礓礞礤礴示礻礼社祀祁祆祈祉祓祖祗祚祛祜祝神祟祠祢祥祧票祭祯祷祸祺禀禁禄禅禊福禚禧禳禹禺离禽禾秀私秃秆秉秋种科秒秕秘租秣秤秦秧秩秫秭积称秸移秽稀稂稃稆程稍税稔稗稚稞稠稣稳稷稹稻稼稽稿穆穑穗穰穴究穷穸穹空穿窀突窃窄窆窈窍窑窒窕窖窗窘窜窝窟窠窥窦窨窬窭窳窿立竖站竞竟章竣童竦竭端竹竺竽竿笃笄笆笈笊笋笏笑笔笕笙笛笞笠笤笥符笨笪笫第笮笱笳笸笺笼笾筅筇等筋筌筏筐筑筒答策筘筚筛筝筠筢筮筱筲筵筷筹筻签简箅箍箐箔箕算箜箝管箢箦箧箨箩箪箫箬箭箱箴箸篁篆篇篌篑篓篙篚篝篡篥篦篪篮篱篷篼篾簇簋簌簏簖簟簦簧簪簸簿籀籁籍米籴类籼籽粉粑粒粕粗粘粜粝粞粟粢粤粥粪粮粱粲粳粹粼粽精糁糅糇糈糊糌糍糕糖糗糙糜糟糠糨糯糸系紊素索紧紫累絮絷綦綮縻繁繇纂纛纟纠纡红纣纤纥约级纨纩纪纫纬纭纯纰纱纲纳纵纶纷纸纹纺纽纾线绀绁绂练组绅细织终绉绊绋绌绍绎经绐绑绒结绔绕绗绘给绚绛络绝绞统绠绡绢绣绥绦继绨绩绪绫续绮绯绰绱绲绳维绵绶绷绸绺绻综绽绾绿缀缁缂缃缄缅缆缇缈缉缋缌缍缎缏缑缒缓缔缕编缗缘缙缚缛缜缝缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴缵缶缸缺罂罄罅罐网罔罕罗罘罚罟罡罢罨罩罪置罱署罴罹罾羁羊羌美羔羚羝羞羟羡群羧羯羰羲羸羹羼羽羿翁翅翊翌翎翔翕翘翟翠翡翥翦翩翮翰翱翳翻翼耀老考耄者耆耋而耍耐耒耔耕耖耗耘耙耜耠耢耥耦耧耨耩耪耱耳耵耶耷耸耻耽耿聂聃聆聊聋职聍聒联聘聚聩聪聱聿肀肃肄肆肇肉肋肌肓肖肘肚肛肜肝肟肠股肢肤肥肩肪肫肭肮肯肱育肴肷肺肼肽肾肿胀胁胂胃胄胆背胍胎胖胗胙胚胛胜胝胞胡胤胥胧胨胩胪胫胬胭胯胰胱胲胳胴胶胸胺胼能脂脆脉脊脍脎脏脐脑脒脓脔脖脘脚脞脬脯脱脲脶脸脾腆腈腊腋腌腐腑腓腔腕腙腚腠腥腧腩腭腮腰腱腴腹腺腻腼腽腾腿膀膂膈膊膏膑膘膛膜膝膣膦膨膪膳膺膻臀臁臂臃臆臊臌臣臧自臬臭至致臻臼臾舀舁舂舄舅舆舌舍舐舒舔舛舜舞舟舡舢舣舨航舫般舭舯舰舱舳舴舵舶舷舸船舻舾艄艇艉艋艏艘艚艟艨艮良艰色艳艴艹艺艽艾艿节芄芈芊芋芍芎芏芑芒芗芘芙芜芝芟芡芤芥芦芨芩芪芫芬芭芮芯芰花芳芴芷芸芹芽芾苁苄苇苈苊苋苌苍苎苏苑苒苓苔苕苗苘苛苜苞苟苠苡苣苤若苦苫苯英苴苷苹苻茁茂范茄茅茆茇茈茉茌茎茏茑茔茕茗茚茛茜茧茨茫茬茭茯茱茳茴茵茶茸茹茺茼荀荃荆荇草荏荐荑荒荔荚荛荜荞荟荠荡荣荤荥荦荧荨荩荪荫荬荭荮药荷荸荻荼荽莅莆莉莎莒莓莘莛莜莞莠莨莩莪莫莰莱莲莳莴莶获莸莹莺莼莽菀菁菅菇菊菌菏菔菖菘菜菝菟菠菡菥菩菪菰菱菲菸菹菽萁萃萄萆萋萌萍萎萏萑萘萜萝萤营萦萧萨萱萸萼落葆葑著葙葚葛葜葡董葩葫葬葭葱葳葵葶葸葺蒂蒇蒈蒉蒋蒌蒎蒗蒙蒜蒡蒯蒲蒴蒸蒹蒺蒽蒿蓁蓄蓉蓊蓍蓐蓑蓓蓖蓝蓟蓠蓣蓥蓦蓬蓰蓼蓿蔌蔑蔓蔗蔚蔟蔡蔫蔬蔷蔸蔹蔺蔻蔼蔽蕃蕈蕉蕊蕖蕙蕞蕤蕨蕲蕴蕹蕺蕻蕾薄薅薇薏薛薜薤薨薪薮薯薰薷薹藁藉藏藐藓藕藜藤藩藻藿蘅蘑蘖蘧蘩蘸蘼虍虎虏虐虑虔虚虞虢虫虬虮虱虹虺虻虼虽虾虿蚀蚁蚂蚊蚋蚌蚍蚓蚕蚜蚝蚣蚤蚧蚨蚩蚪蚬蚯蚰蚱蚴蚵蚶蚺蛀蛄蛆蛇蛉蛊蛋蛎蛏蛐蛑蛔蛘蛙蛛蛞蛟蛤蛩蛭蛮蛰蛱蛲蛳蛴蛸蛹蛾蜀蜂蜃蜇蜈蜉蜊蜍蜒蜓蜕蜗蜘蜚蜜蜞蜡蜢蜣蜥蜩蜮蜱蜴蜷蜻蜾蜿蝇蝈蝉蝌蝎蝓蝗蝙蝠蝣蝤蝥蝮蝰蝴蝶蝻蝼蝽蝾螂螃螅螈螋融螓螗螟螨螫螬螭螯螳螵螺螽蟀蟆蟊蟋蟑蟒蟓蟛蟠蟥蟪蟮蟹蟾蠃蠊蠓蠕蠖蠛蠡蠢蠲蠹蠼血衄衅行衍衔街衙衡衢衣衤补表衩衫衬衮衰衲衷衽衾衿袁袂袄袅袈袋袍袒袖袜袢袤被袭袱袷袼裁裂装裆裉裎裒裔裕裘裙裟裢裣裤裥裨裰裱裳裴裸裹裼裾褂褊褐褒褓褙褚褛褡褥褪褫褰褴褶襁襄襞襟襦襻西要覃覆见观规觅视觇览觉觊觋觌觎觏觐觑角觖觚觜觞解觥触觫觯觳言訇訾詈詹誉誊誓謇謦警譬讠计订讣认讥讦讧讨让讪讫训议讯记讲讳讴讵讶讷许讹论讼讽设访诀证诂诃评诅识诈诉诊诋诌词诎诏译诒诓诔试诖诗诘诙诚诛诜话诞诟诠诡询诣诤该详诧诨诩诫诬语诮误诰诱诲诳说诵诶请诸诹诺读诼诽课诿谀谁谂调谄谅谆谇谈谊谋谌谍谎谏谐谑谒谓谔谕谖谗谘谙谚谛谜谝谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谯谰谱谲谳谴谵谶谷豁豆豇豉豌豕豚象豢豪豫豳豸豹豺貂貅貉貊貌貔貘贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贶贷贸费贺贻贼贽贾贿赀赁赂赃资赅赆赇赈赉赊赋赌赍赎赏赐赓赔赕赖赘赙赚赛赜赝赞赠赡赢赣赤赦赧赫赭走赳赴赵赶起趁趄超越趋趑趔趟趣趱足趴趵趸趺趼趾趿跃跄跆跋跌跎跏跑跖跗跚跛距跞跟跣跤跨跪跫跬路跳践跷跸跹跺跻跽踅踉踊踌踏踔踝踞踟踢踣踩踪踬踮踯踱踵踹踺踽蹀蹁蹂蹄蹇蹈蹉蹊蹋蹑蹒蹙蹦蹩蹬蹭蹯蹰蹲蹴蹶蹼蹿躁躅躇躏躐躔躜躞身躬躯躲躺軎车轧轨轩轫转轭轮软轰轱轲轳轴轵轶轷轸轹轺轻轼载轾轿辁辂较辄辅辆辇辈辉辊辋辍辎辏辐辑输辔辕辖辗辘辙辚辛辜辞辟辣辨辩辫辰辱辶边辽达迁迂迄迅过迈迎运近迓返迕还这进远违连迟迢迤迥迦迨迩迪迫迭迮述迳迷迸迹追退送适逃逄逅逆选逊逋逍透逐逑递途逖逗通逛逝逞速造逡逢逦逭逮逯逵逶逸逻逼逾遁遂遄遇遍遏遐遑遒道遗遘遛遢遣遥遨遭遮遴遵遽避邀邂邃邈邋邑邓邕邗邙邛邝邡邢那邦邪邬邮邯邰邱邳邴邵邶邸邹邺邻邾郁郄郅郇郊郎郏郐郑郓郗郛郜郝郡郢郦郧部郫郭郯郴郸都郾鄂鄄鄙鄞鄢鄣鄯鄱鄹酃酆酉酊酋酌配酎酏酐酒酗酚酝酞酡酢酣酤酥酩酪酬酮酯酰酱酲酴酵酶酷酸酹酽酾酿醅醇醉醋醌醍醐醑醒醚醛醢醣醪醭醮醯醴醵醺采釉释里重野量金釜鉴銎銮鋈錾鍪鎏鏊鏖鐾鑫钅钆钇针钉钊钋钌钍钎钏钐钒钓钔钕钗钙钚钛钜钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钶钷钸钹钺钻钼钽钾钿铀铁铂铃铄铅铆铈铉铊铋铌铍铎铐铑铒铕铖铗铘铙铛铜铝铞铟铠铡铢铣铤铥铧铨铩铪铫铬铭铮铯铰铱铲铳铴铵银铷铸铹铺铼铽链铿销锁锂锃锄锅锆锇锈锉锊锋锌锍锎锏锐锑锒锓锔锕锖锗锘错锚锛锝锞锟锡锢锣锤锥锦锨锩锪锫锬锭键锯锰锱锲锴锵锶锷锸锹锺锻锼锾锿镀镁镂镄镅镆镇镉镊镌镍镎镏镐镑镒镓镔镖镗镘镙镛镜镝镞镟镡镢镣镤镥镦镧镨镩镪镫镬镭镯镰镱镲镳镶长门闩闪闫闭问闯闰闱闲闳间闵闶闷闸闹闺闻闼闽闾阀阁阂阃阄阅阆阈阉阊阋阌阍阎阏阐阑阒阔阕阖阗阙阚阜阝队阡阢阪阮阱防阳阴阵阶阻阼阽阿陀陂附际陆陇陈陉陋陌降限陔陕陛陟陡院除陧陨险陪陬陲陴陵陶陷隅隆隈隋隍随隐隔隗隘隙障隧隰隳隶隹隼隽难雀雁雄雅集雇雉雌雍雎雏雒雕雠雨雩雪雯雳零雷雹雾需霁霄霆震霈霉霍霎霏霓霖霜霞霪霭霰露霸霹霾青靓靖静靛非靠靡面靥革靳靴靶靼鞅鞋鞍鞑鞒鞔鞘鞠鞣鞫鞭鞯鞲鞴韦韧韩韪韫韬韭音韵韶页顶顷顸项顺须顼顽顾顿颀颁颂颃预颅领颇颈颉颊颌颍颏颐频颓颔颖颗题颚颛颜额颞颟颠颡颢颤颥颦颧风飑飒飓飕飘飙飚飞食飧飨餍餐餮饔饕饣饥饧饨饩饪饫饬饭饮饯饰饱饲饴饵饶饷饺饼饽饿馀馁馄馅馆馇馈馊馋馍馏馐馑馒馓馔馕首馗馘香馥馨马驭驮驯驰驱驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骄骅骆骇骈骊骋验骏骐骑骒骓骖骗骘骚骛骜骝骞骟骠骡骢骣骤骥骧骨骰骱骶骷骸骺骼髀髁髂髅髋髌髑髓高髟髡髦髫髭髯髹髻鬃鬈鬏鬓鬟鬣鬯鬲鬻鬼魁魂魃魄魅魇魈魉魍魏魑魔鱼鱿鲁鲂鲅鲆鲇鲈鲋鲍鲎鲐鲑鲒鲔鲕鲚鲛鲜鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲸鲺鲻鲼鲽鳃鳄鳅鳆鳇鳊鳋鳌鳍鳎鳏鳐鳓鳔鳕鳖鳗鳘鳙鳜鳝鳞鳟鳢鸟鸠鸡鸢鸣鸥鸦鸨鸩鸪鸫鸬鸭鸯鸱鸲鸳鸵鸶鸷鸸鸹鸺鸽鸾鸿鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹎鹏鹑鹕鹗鹘鹚鹛鹜鹞鹣鹤鹦鹧鹨鹩鹪鹫鹬鹭鹰鹱鹳鹾鹿麂麇麈麋麒麓麝麟麦麴麸麻麽麾黄黉黍黎黏黑黔默黛黜黝黟黠黢黥黧黩黪黯黹黻黼黾鼋鼍鼎鼐鼓鼗鼙鼠鼢鼬鼯鼷鼹鼻鼽鼾齄齐齑齿龀龃龄龅龆龇龈龉龊龋龌龙龚龛龟龠';
const PY_LET = 'YDQWZSSXJBYGCZQPSQBYCDSCDLYSGGYQZFCLZWDWZLJPNJTMYZWZHFLPPQGCYMJQYXXSJMLRQLYZSECYKYHQWJGYXJTWKJHYCHMXJTLQBXRRYSRLDZJPCZJJRCLCZSTZFXTRQGDLYSYMMYZPWJJRFFQKYWJFFXZYHHYSWCYSCLCWZBGNBLSCSGDDWDZZYTHTSYYFZGNTNYWQKPLYBJEJTJYSKZCKLSZYMDGYXLJZCQKCNWHQBCEQJZQLYSFLPBYQXYCYLLJXFJPFABGBSDJTHYTJCKJJQNZWLZZQYJJRWPXZTJZOTLFCGFLBDTBCNCACSXXLJSJJTSJPJXDRLEWYYXCZXGKMDTSYDDJRQBGLXLGGXBQJDZYJSJCJNGRCZMMMRXJNGZYMBDFBHCJKYLDXLJQZSLDLJCLNJFFFPKHDQXTACJDHZDDDRFQYKCWXHYLLZGCCSPPLBJGDKZSQSCKGGKDJTXLQGJTPWJSBJSJFGPJQJPHYLQBGJWMLDZNJQSLJLHSBYMXMLXKMQXBSGWYBCXPPFBHBSFZJKXGFKPQYBNSQSSWHBHXBZZDMNBBBBZKLYLGWJWZMYWJQLJXJQCETLLYYSCLHCYXYJSCJSSQXSCYCJYSFFSQSBXPSDKGJLDKZJZBDKTCSYPYHSTLDJXCGYHJDTMHLTXZXLYMJLTYFBQFBDFHTKSQZYWCXCWHWYEDCGFNWYDOLBYGQWNLYZGCWHNGPSHMJZDPZHJYFZKGKLDNSGZYLZMMZYJGZKHXXYYAPSHDWHZPXAGKYDXBHHKDJNMYGOCSLNKXZZBHGGYSCAXTZWMLSZHJFHSWSCLYSTHZKZSLACTDCFPSLZPSZNBDLXCTJKYWNSLJHHDNYOCHXHKXLZMPKYLKAXSASKDSCSSGJWSCHSHQNHNDATASSDQCJPGGXMLDBYMCPZCZSLXHCJYDPJQLOJQEZYSJGSPRHHTCXHRJNNWQSJHXYNTDHYKCWLLGGTYPYYQYQHTSZWGWGPYDZKCQJZBJFBTKHZKKJTLBWFZPKTTGPDNPAMKCCCLLLLXDLGDYFGYDKSEDYKKNYGAMCSLPCSXGNYBPDAZYPJSKTDJPTQDYDHBDKYDLTCSTTSGTYSCMJSYSMQLZXMDJBYHHRSRZSKHYZCBFXKXWSDYGYHDTTFYYHSTYKJDKLHYQNFFKZQBYJTZXDSANNNJTHSRFWZFMRYDJYJMNBYTFWYGNZDMQQMZSJGSXWSPYJSJLYJCYZWWLYRJLPLSWNNJSDEMYWXQCEPWBJHBJLYCSTWXMMYAPXYCGJSJXAPPLZLDYCNMQXBSNYMSZJJKYZCSFBZXMBJGNXHLNSCZFRNMNTGZYSASWHMDZGZDWYBSCSKXSYHXGZHYXJCRKBSJJYMKFMHYQMCGWLZLHCDSXDSFSJWZXSEGJCSGCYYLYGJGSYCKNJWNJPCJQTJWSPJXZESTLXLJCTSYQYSQYJQQCCQGXALDBKGYXJLDYHMADKMYXDZXJZLEYQFJLLKCQCYJGXYSBZGWZYJSMQRYLSZWCJZLDYDWCCZXCGZQJGWCQJYSBXXJBSBSFSXWZTPPTLZZBZDDZXBCWCZGMMWFHMMZFFCGPNBXYHYYGPZQBCGXLWKYDPDMGFPFXXDZTBASKYTYLLJAKLCXLYYTJGNKBYQNYBYSSGYFHCDZMXHNJMWRDQBGJGDLTHZYSXTYCBBPZYCPYCBWZCJDXHYHLHXTLDPXCYHXYWZDJHXXBYDJRCTTTCZWMTZCWYSKBZCNNXHKFHTSWOCCCZZYNZPBHDLSDYJPXYNGFQCZDYNXSLHKHSYHJHZXNHEKDTGXQKETYKCNYYKQXTHYHBSQKWYHYNQXQMFBCJXDQCJWHTWHXCWHDJCCBQCDGDXZHRXQCQYYMBYEYGYLFKKSYCQHSSMTMHKWYKBZQDCHQJCHDXAMMLLNMYGGWJXSRXCWJQHQZQJJKJGDJJLCDHHLFSBJSHFSSCZPBDRTKKQZKMSYNBCRBFPEZCJCJBYSZTDKZFPTKLQHBPPTBDMCYCMFZDCMNLFBPLGJTBTAJZPZBNLJYLNBZKSJZGQSZKPZSNCGZQAKTWZLWTXNDJZJHANCZSYTWWJTKZLBHSNJBLSJHDPLBJACJNNXDDSDPZJTQPYJLTCJKTYCJTQBLGZDCGYYKRZXMTCYAYWCKJJDYYZLQCGLJCZBCCSJSGSSNTBDQXCGESSBYBTBSZLCMZMMZLYJPCSSHZZCLQBCZNXLCHGLSCQHQPBSZXCPHZRZJNZPPSYGGFZGXMDMJCAJLBCGSDJJSQZFWZBFBLDLHXZWJCFZZDSXFYSPZMLPXJNZLYQWJRDJZZXXGLGHSKWYAZKHCMHYXXTZXYCMZZSYMNCZXCHJSYSXYYHHWCBWHCPJXQJGZLZXXKSNAMAJMBXTSXYPXNYQYGHCMCTZYYRPFQSZLWCQMMWMBZSZPDJXSZQGCSWLXCCBZDQSGTLYMMHBJGYCPZSBJGPWFXZLRMGZCSZLJCQFXKPZXJJGDLBBMGQRRZXYGTZNDCJJKNZLCCSZZBZZLDLLLSSQLGXXZKLYHGGZLJHGTGWKAAJZZTSHJJYRZDQQHGJZSFTJLTMBGZGSMWLSTXSFJLMQGBZJPTDSCLKZGFGYLZCJJDQLTYDSCCZXJCLLNMXJCZKQYLPGLYCLJXLRJZBFZSXCLQTGSCCHGKBZQHCJFCTZMXHQYQZYGQTJCJXZCLYTXQYLBQLCMQCHXYOYXYQKSXXQGSZZCBWQWDSJMCYTDSXSCPYLZDJBYSODYDHGYWMMDYBBBPBMZMHTCSSJCPLQSDMMQPNDXCFFDQYHYAYKDLQYSSYTTZQCHHCXQSHXSRGJCWTMGWTJBWXQFQYWYHSCDQMDMSPGMFOLLCWHMSJTTHFYZZGZYXQQPMLHGFMSFNLPBQNZLXPMTYYBXLLLXPZJJHYYLJSXZJLDJWHXTEZRXHHWQPLJQJJZZCHJLHHNXZJBZXHPHLFWYHJMTNXSYXSJCTTLLLWWHDRJZSFGSYYHHZDZXXQLTSNTCFSPDYGYCHSCHYTMQYLZDJMYSSZYQDZBWWXWGXKYMPMTMPJHXZHJYWSKJXGTYKLMYPLXSQSXRHNTRCPDZFHZTTBGZYSMYLLLBTDHPQLLLYCMLXYMMLSZHYYXLWPQLHLTCSZSCTCCGSSPLZLACDJLSLBBHRPZPHYXFYGHBHBMDHLZJZZCYJLCYCGKDZWQXJTPJTBZZDSLCHSLTLYHLZYKFSYHTJRXWPFYHWHHMDBFJCYYRDXHJYSMXZWZBHBTSXXXRLXSYYAMSXRLFYYZSXXBJCZPYAJFYBDYSPPBPDDYYNPMMLMMWJGSQTXWGXLJDJJPKJQQFQAZGMYYKNDBPXHFGJNHJRSDXSKZYSYBJLYSLLXNLGMCYMCCSLHWXZMWXNHYMCHYJZAJLXTXHXLYWDJJMWBWMWHXLDDXBPKJMSZJFLGLZEYHBHQLLLYLSJCZHQKQWCYLQPPQMXYNHYYRSTGYAJCCLXZYLHPBCQWZGDHPBRWWOLPCBZMBZPGDSTSSYSFYBNTYJSDNDTHZBCFTJQWPLBZCLQFSCJWJTJPSYNDJLGJSNLYYBJYLCFZPPGKCDZTJJJXZBZYJQYYZHYDTPLZCWSLHXTFCBGWYCZDHLYJYLSCWJBLCSDBTBLCZZQMYYHLABYPDLXDQGDBBZDJHGGJAHWXPPZJCMYZPYYHAZYJHKGDPSMGMDXMZXDPDSMMDMKKYSZMYZZXSMCKJMTYZZSDLJYJSSDPMNJCDKGRMMCKSXMMPCMPQZDSKTLZGQJCMJSYZSJJCDASJGXFKDMSHQKYPYZCDYFFZTDZZFLBPPSZALLTLCGNGXDXSXQXWLYMQJPDDLASBDWDBQCDDJBBPJDTCXNCBSLCPZKGMQQDLHJDJMCBSSLSSQXQZFZZZQHZSSCMXTPJZDHQBJLCXFZXRYYLQHXSTGBQZKMBMZMCQYZSZJCJYHXLFLCSSRBZKCSWJZDJJGMSSRXJQXQKCZTQZBYQYZTJCJCWKKKDXYJYLLSZJJZJTSJDZZYGDJBJZSHXBJSDCLTSFBDZDZGJPJLBXQDJQFKZTDCKBSZYPSXSYKCGQJBGQBJSKQGYZQTLDXRJXZZHZPHKLGFGCLBCLLPDMCGSLDDDHZBBZLJMDLXZFBLPCZTLXSZYZFLLCJCLZJSRHXHZCGTQCMZKJNMXWSSJZLXZQQMFYZDSJYHZXGYJWKJRWYCPSGNZLFZWFNSXGXFLZSXZZZBFCSYJDBRJKRHHGXJLJJTGXJXSTJTJXLXQFCSGSWMSBCLQZZWLZZKXJMLTMJHSDDBGZHDLBMYJFRZFGCLYJBPMLYSMSXLSZJQQHJZFGQYQXGWWHLFFGGBYZZZLSPLZJYQMGLDXQXQSJTXLGCYYWCYYLXXQDCFZJPHHAYFYYLKMZQDESNLZGCHYBSHLTOLNJPMEDYDSCDGNDLLLZNGLPJKCAYYSYSZRLJHXZDGRGWCGZFFJFZNAKGYYQFJTSZZXSWZDBGTPZZPJSZBHYXLDKLJNYKYGHGDJXAPNZCMJKSZQNMNLBWJCPPTNLLPTJLYYFFFQWZDCXSNESYJYFXNMWTTBLGBGBBTMXZLPCSYSTLBYYSGCZZNCZZZJYYYCXJYSSSSTCSWZCSYBHFBBZJCZZDBXGCLXSTWMSSCCMGLJSYFCYJANJWMQYSQDQMXPFWZSQKJLJQQYFBRXJHFWZYQYFCBWLEXCCZSYRLTSMQKMBGMYJPRKSBYJGPFZMFJMMBCMCJLNYQMYGQJCMCJFZJHYCRRCTXQJXCRJTHLJRBQHJDRHXLYXJSYMHZYHBDTSLPLSJMSTYGYLFEMKLLSWXHYYYCMWJJGJJHFCSCBTBHXPDGLFYJSQCTBQMPWDHNTLYYYXSXYELBFZXRGQPDPHZJCWKTXQDCKKJLPLMSBKPSZJJEHZXRWSRSBBLJLYYMPXLXSMMZWCCNSQDLLKABFXJRQHZRJQYWJHLBHWYXBXHXSSXRTGJCMXOLTFZHHMNQFZMHHLNLQXYGCQJSHHMGSXCSYMWRBPYCYHGZJFCDXQYZYHHRZGQSLGDLCQMHYWZKJHQZMZJNSQSYESFSZWFLCYTTWZFMQLMQXTYPYQQGWYGCKXYHBFYQMFKHDNLCRLPXYSRQTMMSCCATPLZSMMXZMXPPHHSXCLLMRHMLCJDQXNXXYXJYHQYYBBCSCGSNZRQJYMANJDPTXWPMBXFJGCLZDKCPYYQQSLLKJBDBSPLGTJGBHBBBCLDRTCQLZQXBJRPXYTFJGGMSCLJJXDYGJQJJGZSJGCSZHYHZLZYTSJQJPYJDFRJJHTRSQXYXJJHOJYNXELSFSFJZGHPZSZSZDZCQZYYKLSGSJHCZSHDGQGXYZGXCHXJWYQWGYHKSSEQZZNDZFKWYSSDCLZSTYMCDHJXXYWEYXCZAYDMPMDSXYBSQMJMZJMTZQLPJYQZCGHDJSWSTXHHYBZBCDXHMMPMBZFGCZXBZHZFTPBGZGEJBSTGKDMFHYZZJHZLLZZGJQZLSFDJSSCGPDLZFZSZYZZSYGCSNHZZJFZGQCJCYQZLTQZZPBDFJZTYQTBDTJPZFSBJLGXJKGQKLTJQBXDJJXLYCTCHJCTBCZZDZDZCJJDPRTJDCQTNPCBBDCFCDCJPCZZCLLCZXSGQDTWCYGXRZELRHGKLZZYHZLYQSZZJQLJZFLNBHGWCZCFJSPYXNLZLXGCPLBBBCRCBLDQYQXGMYYJYFWHZJYWLCTYJJDEDPDZSJMBJZTSSTPHNXXBXTZQDTTDTGSCSZQFLHDLKWYLBYDSCYBEXHQDYGLTQYAZZLZJBYXSMLYDYHMQKFXNBXWYHTQPBSBDZYLZYQZHJLJKZYXFGHJYLYBPGTCDDYEJBYYZSPZLFYDQZPZYGJXFYTTCHGSMLCTZXJCTJMKSLYSNPCZCKTHXXMQHTLBJXLJXCYSLZYLJFJQLWZMLAABXJGYZDZPLTQCSFDMNCGBTJDCZNBGBQYQJWGKFHTNBYQZQGBKPBBYZMTJDYTBLSQMSXTBNPDKLEYCJYNDTLDYKZZXDDHQSHDGMZSJYCCTAYRZLPLTLKXSLZCGGEXCLFXLKJRTLQJAQZNCMBDKKXGLCZJXJHPTDJJMZQKQSECQZDSHADMLFMMZGNJNNLGBYJBBTMLYJDZXCJLPLDLPCQDHLZLYCBXZMSSYBWCRWXHJMKMZNGWTMLFGHKJYLYYCXWHYECLQKQHTQHFFDQWBRJFYYZJZZDATBFJLLCXLMJXGSBZDYCNYXPZCPLTXYLWSHSYGKAXZSXHLZSJNQYXYJGZCYJCLDCYYXWLLLBWXJXTZPMHSFNLSXYAXLBPMQJJJDFKMMYGJXBDYXADQMQJRJBJGBWRHWYTJYYSYDQHXSXXWGDQBSHYLLPJJJHYKYPTHYKTEZYENMDSHCRPQFBSJSPBBFSSXYCTYTSJTTXRYCFYJSBSYERXJBBEYNHXGCKSCMLXJMSZNSKGXFXMYTXCQBLZSSFJZZTNJYDXMJHLHPLCYJQQKZCPZSWALQSBLCCZJXGTJDKHHGBKQLKBDSGBKMTZRXJZQJBHLCGYGKHBPMYXLWWCMYYLFBPNLFBHTGJWEJJXXXGLLJLSTGSHJQLZFKCGNNDJSZFDSEQFHBSAQTGYLBXBMMYGSLZLNJJYMOYBZGDLYYCQYTSZEGXGLHBLJGEYXTWQMABPCHEGCMWYJHYZLLJJYLYHGCLJJZMQLSLMQFMMHHHSLNHQMDCYYXQQLDCAZFFMYTDNGTPSFYWXYBQHZQJCCJLBTZKYCQWLGKGY';
const PY_IDX = Object.create(null);
for (let i = 0; i < PY_HAN.length; i++) PY_IDX[PY_HAN.charAt(i)] = PY_LET.charAt(i);
function pinyinInitial(ch) {
  return PY_IDX[ch] || '';   // 查不到返回空串，由调用方决定分组
}
/* 取该卡所属的索引字母：英文取首字母；中文取拼音首字母；数字/符号归 '#' */
function groupLetterOf(card) {
  const ch = (personaNameOf(card) || '').trim().charAt(0);
  if (/[A-Za-z]/.test(ch)) return ch.toUpperCase();
  if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch)) return pinyinInitial(ch) || '#';
  return '#';
}
/* 联系人排序：英文 → 中文（拼音序）→ 特殊符号 */
function sortContacts(arr) {
  return arr.slice().sort((a, b) => {
    const na = personaNameOf(a);
    const nb = personaNameOf(b);
    const ka = contactSortKey(na);
    const kb = contactSortKey(nb);
    if (ka.g !== kb.g) return ka.g - kb.g;
    if (ka.k !== kb.k) return ka.k < kb.k ? -1 : 1;
    const cmp = na.localeCompare(nb, 'zh-Hans-CN', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return na.localeCompare(nb);
  });
}

/* 渲染联系人页：只列人设卡，每条带「聊天 / 删除」 */
function renderPersonaContacts(box, list, showGroup) {
  let cards = list || getPersonas();

  if (!cards.length) {
    const em = document.createElement('div');
    em.className = 'sess-empty';
    em.innerHTML = T('还没有人设卡') + '<br>' + T('去「我 → 人设卡」里新建一张');
    box.appendChild(em);
    return;
  }

  // 内置卡排最前（外部未分组时兜底）
  cards = cards.slice().sort((a, b) => (isBuiltinPersona(b.id) ? 1 : 0) - (isBuiltinPersona(a.id) ? 1 : 0));

  let lastLetter = null;
  cards.forEach(c => {
    try {
    const pinned = isBuiltinPersona(c.id);
    // 分组标题（仅字母分组显示；置顶卡不参与）
    if (showGroup && !pinned) {
      const L = groupLetterOf(c);
      if (L !== lastLetter) {
        lastLetter = L;
        const gh = document.createElement('div');
        gh.className = 'sess-group';
        gh.dataset.letter = L;
        gh.textContent = L;
        box.appendChild(gh);
      }
    }
    const item = document.createElement('div');
    item.className = 'sess sess-persona' + (pinned ? ' sess-pinned' : '');
    const avatar = document.createElement('div');
    avatar.className = 'sess-avatar';
    if (showAvatarOn() && c.avatar) {
      avatar.classList.add('sess-avatar-img');
      const im = document.createElement('img');
      im.src = c.avatar;
      im.alt = '';
      avatar.appendChild(im);
    } else {
      avatar.textContent = personaNameOf(c).trim().charAt(0) || T('人');
    }

    const main = document.createElement('div');
    main.className = 'sess-main';
    const label = document.createElement('div');
    label.className = 'sess-title';
    label.textContent = personaNameOf(c);
    const sub = document.createElement('div');
    sub.className = 'sess-sub';
    sub.textContent = personaBrief(c);
    main.appendChild(label);
    main.appendChild(sub);

    const side = document.createElement('div');
    side.className = 'sess-side';
    const btns = document.createElement('div');
    btns.className = 'sess-btns';

    const chat = document.createElement('button');
    chat.className = 'pc-chat';
    chat.textContent = T('聊天');
    if (isBuiltinPersona(c.id)) {
      const tag = document.createElement('span');
      tag.className = 'sess-builtin';
      tag.textContent = T('内置');
      btns.appendChild(tag);
      btns.appendChild(chat);
    } else {
      // 删除入口已统一放到「详细资料」页里，列表右侧只留「聊天」
      btns.appendChild(chat);
    }
    side.appendChild(btns);

    item.appendChild(avatar);
    item.appendChild(main);
    item.appendChild(side);
    box.appendChild(item);

    // 点整行 = 打开这张卡的「详细资料」页（参考微信）
    item.onclick = () => viewPersonaCard(c.id);

    chat.onclick = e => {
      e.stopPropagation();
      openPersonaContact(c.id);
    };
    } catch (e) { console.warn('[联系人渲染跳过]', c && c.name, e); }
  });
}

/* 点联系人行 = 打开该人设卡的「详细资料」独立页（参考微信） */
function viewPersonaCard(pid) {
  openPersonaPage(pid);
}

/* 打开人设卡详情页 */
function openPersonaPage(pid) {
  if (typeof closeStancePop === 'function') closeStancePop();
  const c = getPersonaById(pid);
  if (!c) return;
  const p = $('personaPage');
  if (!p) return;

  p.dataset.pid = pid;

  const av = $('pcAvatar');
  if (av) {
    av.innerHTML = '';
    if (showAvatarOn() && c.avatar) {
      const im = document.createElement('img');
      im.src = c.avatar;
      im.alt = '';
      av.appendChild(im);
    } else {
      av.textContent = personaNameOf(c).trim().charAt(0) || T('人');
    }
  }
  const nm = $('pcName');
  if (nm) nm.textContent = personaNameOf(c);
  const sub = $('pcSub');
  const bi = isBuiltinPersona(c.id);
  if (sub) sub.textContent = bi ? T('内置卡 · 不可删除') : T('人设卡联系人');

  // 备注：设过备注（会话 alias 有值）就把备注名显示在这行灰字上
  const sess0 = findPersonaSession(c.id);
  if (sub && sess0 && sess0.alias && sess0.title) sub.textContent = '（' + T('备注') + '：' + sess0.title + '）';

  const prompt = (c.prompt || '').trim();
  const len = prompt.length;
  const pl = $('pcLen');
  if (pl) pl.textContent = len + T(' 字');
  const sess = findPersonaSession(c.id);
  const pm = $('pcMsgs');
  if (pm) {
    if (sess && sess.msgs && sess.msgs.length) {
      const n = sess.msgs.length;
      pm.textContent = n + T(' 条消息');
    } else {
      pm.textContent = T('还没有聊过');
    }
  }
const send = $('pcSend');
  if (send) send.textContent = (sess && sess.msgs && sess.msgs.length) ? T('继续聊天') : T('发消息');

  // 动态（让 TA 自己发朋友圈）开关 + 按钮
  bindPersonaMomentUI();

  // 该卡自己的朋友圈
  renderPcFriendList(c.id);

  // 【修复·页面置顶】复用元素会保留上次的滚动位置，打开时归零
  try { p.scrollTop = 0; } catch (e) {}
  try { if (p.scrollTo) p.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {}
  p.classList.add('open');
  setTimeout(() => {
    try { p.scrollTop = 0; } catch (e) {}
    const sb = p.querySelector('.settings-body');
    if (sb) { try { sb.scrollTop = 0; } catch (e) {} }
  }, 320);
}

/* 关闭人设卡详情页 */
function closePersonaPage() {
  const p = $('personaPage');
  if (p) p.classList.remove('open');
  closePcMoreMenu();
  editingPersonaId = '';   // 复位编辑目标，避免下次误写别的卡
}

/* 右上角「⋯」下拉菜单：关闭 / 同步状态 */
function closePcMoreMenu() {
  const m = $('pcMoreMenu');
  if (m) m.classList.remove('open');
}

/* 打开菜单前刷新：开关项的勾选态 + 内置卡隐藏「删除联系人」 */
function syncPcMoreMenu() {
  const m = $('pcMoreMenu');
  if (!m) return;
  const pg = $('personaPage');
  const pid = pg ? (pg.dataset.pid || '') : '';

  const autoOn = !!pid && momAutoOn(pid);
  const cmtOn = !!pid && typeof momCmtOn === 'function' && momCmtOn(pid);

  // 第 1 行：让 TA 自己发朋友圈（拨杆）
  const rAuto = m.querySelector('.pc-switch-row[data-pcact="momAuto"]');
  if (rAuto) rAuto.classList.toggle('on', autoOn);

  // 第 2 行：主动评论互动（拨杆）
  const rCmt = m.querySelector('.pc-switch-row[data-pcact="momCmt"]');
  if (rCmt) rCmt.classList.toggle('on', cmtOn);

  // 第 3 行：显示思考（拨杆）
  const psyShowOn = !!pid && psyOn(pid);
  const rPsy = m.querySelector('.pc-switch-row[data-pcact="psyShow"]');
  if (rPsy) rPsy.classList.toggle('on', psyShowOn);

  // 第 5 行：显示推理过程（拨杆）
  const thinkShowOn = !!pid && thinkOn(pid);
  const rThink = m.querySelector('.pc-switch-row[data-pcact="thinkShow"]');
  if (rThink) rThink.classList.toggle('on', thinkShowOn);

  // 子项「发一条动态」：仅在发朋友圈开关打开时出现
  const bGen = m.querySelector('button[data-pcact="momGen"]');
  if (bGen) {
    bGen.classList.toggle('show', autoOn);
    bGen.disabled = !autoOn;
  }

  const bDel = m.querySelector('button[data-pcact="del"]');
  if (bDel) bDel.classList.toggle('hide', !!pid && isBuiltinPersona(pid));
}

/* 绑定详情页上的按钮 */
function bindPersonaPage() {
  const bk = $('personaBack');
  if (bk) bk.onclick = () => closePersonaPage();

  // 右上角「⋯」更多菜单：下拉气泡（样式同聊天页 #chatMenu）
  const moreBtn = $('pcMoreBtn');
  const moreMenu = $('pcMoreMenu');
  if (moreBtn && moreMenu) {
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      syncPcMoreMenu();
      moreMenu.classList.toggle('open');
    };
    // 菜单项点击（事件委托，只绑一次）
    if (!moreMenu.dataset.bound) {
      moreMenu.dataset.bound = '1';
      moreMenu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pcact]');
        if (!b) return;
        e.stopPropagation();
        const act = b.dataset.pcact;
        if (act === 'momGen' && b.disabled) return;   // 子项禁用时忽略
        const pg = $('personaPage');
        const pid = pg ? (pg.dataset.pid || '') : '';
        const card = pid ? getPersonaById(pid) : null;

        if (act === 'momAuto') {
          setMomAutoFor(pid, !momAutoOn(pid));
          const c2 = $('pcMomAuto'); if (c2) c2.checked = momAutoOn(pid);
          syncPcMoreMenu();
          return;                                   // 开关项：不关菜单，方便连着点
        }
        if (act === 'momCmt') {
          if (typeof setMomCmtFor === 'function') setMomCmtFor(pid, !momCmtOn(pid));
          const c3 = $('pcMomCmt'); if (c3) c3.checked = momCmtOn(pid);
          syncPcMoreMenu();
          return;
        }
        if (act === 'psyShow') {
          setPsyOn(pid, !psyOn(pid));
          syncPcMoreMenu();
          if (typeof renderAll === 'function') renderAll();
          return;                                   // 开关项：不关菜单
        }
        if (act === 'thinkShow') {
          setThinkOn(pid, !thinkOn(pid));
          syncPcMoreMenu();
          if (typeof renderAll === 'function') renderAll();
          return;                                   // 开关项：不关菜单
        }
        if (act === 'momGen') {
          closePcMoreMenu();
          genMomentByAI();
          return;
        }
        if (act === 'momPage') {
          closePcMoreMenu();
          if (pid) openMomPersonPage(pid);
          return;
        }
        if (act === 'avatar') {
          closePcMoreMenu();
          const inp = $('pcAvatarInput');
          if (inp) inp.click();
          return;
        }
        if (act === 'del') {
          closePcMoreMenu();
          if (card && isBuiltinPersona(pid)) return;
          const total = getPersonas().length;
          if (total <= 1) {
            askConfirm(T('至少要留一张人设卡，不能全删光。'), T('删不了'), function () {});
            return;
          }
          askConfirm(T('删除人设卡') + '「' + ((card && card.name) || '未命名') + '」？' + T('它的聊天记录和它发过的动态都会一起删掉。'), T('删除人设卡'), function () {
            closePersonaPage();
            deletePersonaCard(pid);
          });
          return;
        }
      });
      // 点菜单外部关闭（只绑一次）
      document.addEventListener('click', (e) => {
        if (!moreMenu.contains(e.target) && e.target !== moreBtn) closePcMoreMenu();
      });
    }
  }

  const send = $('pcSend');
  if (send) send.onclick = () => {
    const p = $('personaPage');
    const pid = p ? p.dataset.pid : '';
    if (!pid) return;
    closePersonaPage();
    openPersonaContact(pid);
  };

  // 备注：弹小窗修改该卡聊天的顶部名字
  const aliasRow = $('pcAliasRow');
  if (aliasRow) aliasRow.onclick = () => {
    const p = $('personaPage');
    const pid = p ? p.dataset.pid : '';
    if (!pid) return;
    const card = getPersonaById(pid);
    if (!card) return;
    let sess = findPersonaSession(pid);
    if (!sess) {
      // 还没有会话：先建一个，保证备注有地方存
      sess = {
        id: uid(),
        title: personaNameOf(card),
        alias: '',
        pid: pid,
        persona: true,
        msgs: [],
        ts: Date.now()
      };
      sessions.push(sess);
      persist();
    }
    // 没设过备注就留空，别把人设卡原名当成"已填内容"塞进输入框
    const hadAlias = !!(sess && sess.alias);
    askInput('设置备注', hadAlias ? (sess.title || '') : '', function (v) {
      const nv = (v || '').trim();
      if (!nv) {
        // 清空 = 删除备注，恢复成角色原名（没绑卡就用「新对话」兜底）
        sess.title = personaNameOf(card);
        sess.alias = '';
      } else if (nv !== sess.title) {
        // 改备注：第一次改时把原名记进 alias（灰色括号用）
        if (!sess.alias) sess.alias = sess.title || '';
        sess.title = nv;
      }
      persist();
      renderMsgSessions();
      renderSessions();
      // 如果正在聊这个会话，顶部标题同步
      if (sess.id === curSid) {
        const ne = $('chatName');
        if (ne) ne.textContent = sess.title;
      }
      openPersonaPage(pid);            // 刷新详情页里的备注值
    });
  };
    // ---- 朋友圈预览行：点进去看这张卡自己的朋友圈（微信式，留在详情页之上） ----
  const frow = $('pcFriendRow');
  if (frow) frow.onclick = () => {
    const p = $('personaPage');
    const pid = p ? p.dataset.pid : '';
    if (!pid) return;
    openMomPersonPage(pid);
  };

  // ---- 朋友圈子页：返回 ----
  const mpBack = $('momPersonBack');
  if (mpBack) mpBack.onclick = () => closeMomPersonPage();


    // ---- 人设卡头像 ----
  const avBtn = $('pcAvatarBtn');
  const avHero = $('pcAvatar');
  const avInput = $('pcAvatarInput');
  const openPick = () => { if (avInput) avInput.click(); };
  if (avBtn) avBtn.onclick = openPick;
  if (avHero) avHero.onclick = openPick;
  if (avInput) {
    avInput.onchange = () => {
      const f = avInput.files && avInput.files[0];
      if (!f) return;
      const p = $('personaPage');
      const pid = p ? p.dataset.pid : '';
      if (!pid) return;
      cropImage(f, data => {
        if (!data) { avInput.value = ''; return; }
        const list = getPersonas();
        const c = list.find(x => x.id === pid);
        if (c) {
          c.avatar = data;
          savePersonas(list);
        }
        openPersonaPage(pid);                      // 刷新详情页头像
        renderSessions();                          // 刷新联系人列表（走完整排序+索引条）
        renderAll();                               // 刷新聊天气泡
      });
      avInput.value = '';
    };
  }

  const del = $('pcDel');
  if (del) {
    const p0 = $('personaPage');
    const pid0 = p0 ? p0.dataset.pid : '';
    if (isBuiltinPersona(pid0)) {
      del.style.display = 'none';           // 内置卡：藏掉删除按钮
    } else {
      del.style.display = '';
      del.onclick = () => {
        const p = $('personaPage');
        const pid = p ? p.dataset.pid : '';
        if (!pid) return;
        const total = getPersonas().length;
        if (total <= 1) {
          askConfirm(T('至少要留一张人设卡，不能全删光。'), T('删不了'), function () {});
          return;
        }
        const card = getPersonaById(pid);
        if (!card) return;
        askConfirm(T('删除人设卡') + '「' + (card.name || '未命名') + '」？' + T('它的聊天记录和它发过的动态都会一起删掉。'), T('删除人设卡'), function () {
          closePersonaPage();
          deletePersonaCard(pid);
        });
      };
    }
  }
}

/* 从联系人页删除某张人设卡（连带其专属会话） */
function deletePersonaCard(pid) {
  const list = getPersonas();
  if (list.length <= 1) {
    askConfirm(T('至少要留一张人设卡，不能全删光。'), T('删不了'), function () {});
    return;
  }
  if (isBuiltinPersona(pid)) {
    askConfirm('「' + BUILTIN_NAME + '」' + T('是内置卡，不能删除。'), T('内置卡'), function () {});
    return;
  }
  const card = getPersonaById(pid);
  if (!card) return;
  askConfirm(T('删除人设卡') + '「' + (card.name || '未命名') + '」？' + T('它的聊天记录和它发过的动态都会一起删掉。'), T('删除人设卡'), function () {
    const arr = list.filter(x => x.id !== pid);
    savePersonas(arr);
    if (curPersonaId() === pid) LS.set(K_PERSONA_CUR, arr[0].id);

    const kept = sessions.filter(s => !(s && s.persona && s.pid === pid));
    if (kept.length !== sessions.length) {
      sessions = kept;
      if (!sessions.length) {
        curSid = '';
        msgList = [];
      } else if (!sessions.some(s => s.id === curSid)) {
        curSid = sessions[0].id;
      }
      msgList = (sessions.find(s => s.id === curSid) || {}).msgs || [];
      save();
      renderMsgSessions();
      renderAll();
    }
    if (typeof loadPromptToForm === 'function') loadPromptToForm();
    renderPersonaList();
    refreshPersonaHint();
    renderSessions();

    // 级联删除：该卡发过的动态（连带图片、评论、点赞一起清掉）
    if (typeof loadMoments === 'function') {
      loadMoments();
      const before = moments.length;
      const dropIds = [];
      moments = moments.filter(m => {
        if (m && m.author === pid) { dropIds.push(m.id); return false; }
        return true;
      });
      // 清掉这些动态的图片（单独一个键存的）
      dropIds.forEach(id => setMomImg(id, null));
      // 该卡在别条动态下的点赞、评论也一并清掉
      let touched = dropIds.length > 0;
      moments.forEach(m => {
        if (Array.isArray(m.likes)) {
          const n = m.likes.length;
          m.likes = m.likes.filter(x => x !== pid);
          if (m.likes.length !== n) touched = true;
        }
        if (Array.isArray(m.comments)) {
          const n = m.comments.length;
          m.comments = m.comments.filter(c => c.author !== pid);
          if (m.comments.length !== n) touched = true;
        }
      });
      if (touched || before !== moments.length) {
        persistMoments();
        if (typeof renderMoments === 'function') renderMoments();
      }
    }
  });
}
function getCurPersona() {
  const list = getPersonas();
  return list.find(x => x.id === curPersonaId()) || list[0];
}
/* 取当前卡的人设文本（供 buildApiMessages 用） */
function getCurPrompt() {
  const c = getCurPersona();
  return c ? (c.prompt || '').trim() : '';
}

/* ---------- 心理描写显示（按卡独立开关，默认关） ---------- */
const K_PSY_P = 'pixelspider_psy_';   // 每卡键前缀：'1' 开，其它/缺省 视为关
/* 当前会话绑定的人设卡 pid（没绑定则回退当前卡） */
function curPsyPid() {
  const cur = sessions.find(x => x.id === curSid);
  const bound = (cur && cur.persona && cur.pid) ? getPersonaById(cur.pid) : null;
  return bound ? bound.id : curPersonaId();
}
/* 某条消息所属的人设卡 pid。
   —— 这是「开关归属」的唯一判据：谁写的这条消息，就用谁的开关。
   老数据没有 pid 字段（那时没记），返回 '' → 所有按卡开关一律视为关。 */
function msgPidOf(m) {
  if (!m || typeof m !== 'object') return '';
  return (typeof m.pid === 'string' && m.pid) ? m.pid : '';
}
/* 某张卡是否开启心理描写显示（不传 pid 读当前卡）
   默认关：只有显式存 '1' 才开 */
function psyOn(pid) {
  const id = pid || (getCurPersona() || {}).id || '';
  if (!id) return false;
  return LS.get(K_PSY_P + id) === '1';
}
/* 设置某张卡的心理描写开关 */
function setPsyOn(pid, on) {
  if (!pid) return;
  try { LS.set(K_PSY_P + pid, on ? '1' : '0'); } catch (e) {}
}

/* ---------- 显示推理过程（Thinking 折叠块，按卡独立开关，默认关） ---------- */
const K_THINK_P = 'pixelspider_think_';   // 每卡键前缀：'1' 开，其它/缺省 视为关
function thinkOn(pid) {
  const id = pid || (getCurPersona() || {}).id || '';
  if (!id) return false;
  return LS.get(K_THINK_P + id) === '1';   // 默认关
}
function setThinkOn(pid, on) {
  if (!pid) return;
  try { LS.set(K_THINK_P + pid, on ? '1' : '0'); } catch (e) {}
}

/* 【v3.1】把正文里的「括号心理描写」抽出来，正文只留说出口的话。
   返回 { clean: 去掉心理描写后的正文, psy: 抽出的心理内容(已去括号, 每段一行) } */
function splitPsy(text) {
  const raw = String(text == null ? '' : text);
  const lines = raw.split('\n');
  const keep = [], psy = [];
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(/^[（(]\s*([\s\S]+?)\s*[）)]$/);
    if (m && m[1].trim()) psy.push(m[1].trim());
    else keep.push(line);
  }
  // 正文规整：连续空行压成一个，首尾去空
  const clean = keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { clean: clean, psy: psy.join('\n') };
}
/* 心理描写识别：整段被中文（） 或英文() 包住的行 → 斜体灰；
   其余照常 Markdown 渲染。顺序保持原样（通常心理在上、语言在下）。 */
function psyRender(text, enable) {
  const raw = String(text == null ? '' : text);
  const lines = raw.split('\n');
  const out = [];
  let buf = [];   // 普通行缓冲，攒够一段再交 mdRender
  const flush = () => {
    if (!buf.length) return;
    const chunk = buf.join('\n');
    if (chunk.trim()) out.push(mdRender(chunk));
    buf = [];
  };
  for (const line of lines) {
    const t = line.trim();
    // 整行是括号包裹（中文或英文），且括号内非空 → 心理描写行
    const m = t.match(/^[（(]\s*([\s\S]+?)\s*[）)]$/);
    if (m && m[1].trim()) {
      // 「显示思考」开：抽出来渲染成灰色斜体心理段；
      // 关：整行直接丢弃（正文里不留括号内容）
      if (enable) {
        flush();
        const p = document.createElement('p');
        p.className = 'psy';
        p.textContent = m[1].trim();
        out.push(p.outerHTML);
      }
      // enable=false 时什么都不做 → 该行被删掉
    } else {
      buf.push(line);
    }
  }
  flush();
  return out.join('');
}
/* 渲染 AI 正文：按当前卡开关决定是否启用心理描写样式 */
function renderAiBody(text) {
  return psyRender(text, psyOn());
}
/* 人设卡 17 个分行输入框 → 合成一段文本（顺序 = 表单顺序） */
const PF_FIELDS = [
  ['ppName',      '姓名'],
  ['ppYears',     '年龄'],
  ['ppSex',       '性别'],
  ['ppIdentity',  '身份'],
  ['ppCareer',    '职业'],
  ['ppCharacter', '性格'],
  ['ppLook',      '外貌'],
  ['ppCloth',     '衣着'],
  ['ppTone',      '说话风格'],
  ['ppStory',     '背景故事'],
  ['ppRelation',  '与我的关系'],
  ['ppLike',      '喜好'],
  ['ppHate',      '厌恶'],
  ['ppSkill',     '能力特长'],
  ['ppWeak',      '弱点缺陷'],
  ['ppTaboo',     '禁忌底线'],
  ['ppExtra2',    '补充设定/备注']
];
/* 把 17 个框拼成 prompt 文本（空的项跳过） */
function packPromptFromFields() {
  const parts = [];
  PF_FIELDS.forEach(([id, label]) => {
    const el = $(id);
    const v = el ? (el.value || '').trim() : '';
    if (v) parts.push('【' + label + '】' + v);
  });
  return parts.join('\n');
}
/* 旧版（5 框）标签 → 新版 17 框 id 的兼容映射 */
const PF_LEGACY_MAP = {
  '身份/角色': 'ppIdentity',
  '必须做到': 'ppTaboo',
  '绝对不要': 'ppTaboo',
  '补充设定': 'ppExtra2'
};
/* 把 prompt 文本拆回 17 个框（不认识的旧文本整体塞进「补充设定/备注」） */
function unpackPromptToFields(text) {
  const t = (text || '');
  const got = {};
  let matched = 0;
  PF_FIELDS.forEach(([id, label]) => {
    const re = new RegExp('【' + label + '】([\\s\\S]*?)(?=【[^】]+】|$)');
    const m = t.match(re);
    if (m) { got[id] = (m[1] || '').trim(); matched++; }
    else { got[id] = ''; }
  });
  // 旧 5 框标签：按映射并进对应新框，不丢内容
  Object.keys(PF_LEGACY_MAP).forEach(oldLabel => {
    const re = new RegExp('【' + oldLabel + '】([\\s\\S]*?)(?=【[^】]+】|$)');
    const m = t.match(re);
    if (m && (m[1] || '').trim()) {
      const target = PF_LEGACY_MAP[oldLabel];
      got[target] = ((got[target] || '') + (got[target] ? '\n' : '') + m[1].trim());
      matched++;
    }
  });
  // 一整段没有【】标记的旧文本 → 整体丢进「补充设定/备注」，不丢内容
  if (matched === 0 && t.trim()) got['ppExtra2'] = t.trim();
  // 写回各框
  PF_FIELDS.forEach(([id]) => { const el = $(id); if (el) el.value = got[id] || ''; });
}
/* 同步隐藏的 #systemPrompt（供 getCurPrompt / 导出等旧逻辑读取） */
function syncHiddenPrompt() {
  const el = $('systemPrompt');
  if (el) el.value = packPromptFromFields();
}
/* 保存当前表单进当前卡（不关抽屉）
   【修复·防污染】只有当表单内容真的和该卡不同才写回，
   避免「切换/新建卡」时把 17 个框里的残留内容整份灌进别的卡，
   造成多张卡内容被写成同一个人（屠藤×3）。 */
function persistCurPersona(silent) {
  const list = getPersonas();
  const c = list.find(x => x.id === targetPersonaId());
  if (c) {
    const next = packPromptFromFields();
    if (next !== (c.prompt || '')) {   // 脏检查：内容有变化才落盘
      c.prompt = next;
      savePersonas(list);
    }
    // 【姓名同步】编辑表单里的「姓名」框 → 同步卡的显示名（列表/预览/会话标题）
    // 让「编辑里改名」和「⋯→改姓名」保持一致，双向统一。
    if (!isBuiltinPersona(c.id)) {
      const nameEl = $('ppName');
      const nm = nameEl ? (nameEl.value || '').trim() : '';
      if (nm && nm !== c.name) {
        c.name = nm;
        savePersonas(list);
        const ps = (typeof findPersonaSession === 'function') ? findPersonaSession(c.id) : null;
        if (ps) { ps.title = nm; save(); if (typeof renderSessions === 'function') renderSessions(); if (typeof renderMsgSessions === 'function') renderMsgSessions(); }
      }
    }
    syncHiddenPrompt();
  }
  // 显示思考 / 显示推理开关已移至「⋯」菜单，直接写 localStorage，此处无需再落盘
  if (!silent) { renderPersonaList(); refreshPersonaHint(); }
}
/* 渲染卡列表：每行右侧 ⋯ 菜单（编辑这张卡 / 重命名 / 删除） */
function renderPersonaList() {
  const box = $('personaList');
  if (!box) return;
  box.innerHTML = '';
  const list = getPersonas();
  list.forEach(c => {
    const row = document.createElement('div');
    row.className = 'persona-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'persona-item-name';
    const txtEl = document.createElement('span');
    txtEl.className = 'persona-item-txt';
    txtEl.textContent = c.name || T('未命名');
    nameEl.appendChild(txtEl);
    if (isBuiltinPersona(c.id)) {
      const tag = document.createElement('span');
      tag.className = 'persona-item-tag';
      tag.textContent = T('内置');
      nameEl.appendChild(tag);
    }

    // 右侧 ⋯（更多）按钮 + 行内左侧滑出菜单（同 API Key 的 .key-menu）
    const more = document.createElement('span');
    more.className = 'persona-more';
    more.textContent = '⋯';
    more.setAttribute('role', 'button');
    more.setAttribute('aria-label', T('更多操作'));
    const menu = document.createElement('div');
    menu.className = 'pmenu-inline';
    // 三项操作：编辑 / 重命名 / 删除（行内、从左侧挤出，样式同 API Key 的 .key-menu）
    {
      const mkItem = (label, danger, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pmenu-inline-btn';
        if (danger) b.dataset.danger = '1';
        b.textContent = label;
        b.onclick = ev => {
          ev.stopPropagation();
          const id = pmenuPid;
          closeAllPersonaMenus();
          setTimeout(() => fn(id), 130);   // 等收起动画跑完再执行，观感连贯
        };
        menu.appendChild(b);
      };
      mkItem(T('编辑'), false, id => { switchPersonaTo(id); openPersonaEditor(); });
      mkItem(T('重命名'), true,  id => renamePersonaById(id));
      mkItem(T('删除'),   true,  id => delPersonaById(id));
    }
    more.onclick = e => {
        e.stopPropagation();
        const willOpen = !menu.classList.contains('open');
        closeAllPersonaMenus();
        if (willOpen) openPersonaMenu(c.id, more, menu, row);
    }
    menu.__more = more;
    menu.__row = row;
    // 点名字区域 = 只读预览这张卡（⋯ 菜单的点击已 stopPropagation，不会误触）
    nameEl.onclick = e => {
      e.stopPropagation();
      if (menu.classList.contains('open')) { closeAllPersonaMenus(); return; }
      openPersonaPreview(c.id);
    };
    row.appendChild(nameEl);
    row.appendChild(menu);
    row.appendChild(more);
    box.appendChild(row);
  });
  syncPersonaScrollbar();     // 列表重绘后刷新自定义滚动条
  bindPersonaScrollbar();     // 首次渲染时绑定滚动监听（dataset.sbHooked 保证只绑一次）
}
/* ---------- 人设卡列表：自定义滚动指示条（滚动时显示、静止后淡出） ---------- */
let personaSbTimer = null;

function syncPersonaScrollbar(hideAfterShow) {
  const list = $('personaList');
  const bar  = $('personaScrollbar');
  if (!list || !bar) return;

  const sh = list.scrollHeight;    // 内容总高
  const ch = list.clientHeight;    // 可视高
  const wrap = list.parentNode;    // .persona-list-wrap

  if (sh <= ch + 1) {              // 内容没超出 → 不需要滚动条
    bar.classList.remove('on');
    return;
  }

  // 1) 算滑块长度与位置（按可视/总高比例）
  const trackH = ch - 4;                                   // 上下各留 2px
  const thumbH = Math.max(24, Math.round(trackH * (ch / sh)));
  const maxScroll = sh - ch;
  const ratio = maxScroll > 0 ? (list.scrollTop / maxScroll) : 0;
  const top = 2 + Math.round((trackH - thumbH) * ratio);

  bar.style.height = thumbH + 'px';
  bar.style.top = top + 'px';

  // 2) 显示 + 重置淡出计时（hideAfterShow: 拖动中传 false 可保持常亮）
  bar.classList.add('on');
  if (hideAfterShow !== false) {
    clearTimeout(personaSbTimer);
    personaSbTimer = setTimeout(() => { bar.classList.remove('on'); }, 900);
  }
}
/* 首次绑定：监听列表滚动（只绑一次） */
function bindPersonaScrollbar() {
  const list = $('personaList');
  if (!list || list.dataset.sbHooked) return;
  list.dataset.sbHooked = '1';
  list.addEventListener('scroll', () => syncPersonaScrollbar(), { passive: true });
  // 触摸期间保持常亮，松手后再开始淡出倒计时
  list.addEventListener('touchstart', () => syncPersonaScrollbar(false), { passive: true });
  list.addEventListener('touchend',   () => syncPersonaScrollbar(),      { passive: true });
  syncPersonaScrollbar();
}

/* ---------- 人设卡 ⋯ 操作菜单 ---------- */
let pmenuPid = '';
let pmenuMenu = null;    // 当前展开的行内菜单节点
let pmenuMore = null;    // 当前展开行的 ⋯ 按钮
let pmenuRow  = null;    // 当前展开行

/* 收起所有已展开的人设卡行内菜单（同时只允许一个） */
function closeAllPersonaMenus() {
  const list = $('personaList');
  if (list) list.querySelectorAll('.pmenu-inline.open').forEach(x => x.classList.remove('open'));
  if (pmenuMore) pmenuMore.classList.remove('on');
  if (pmenuRow)  pmenuRow.classList.remove('menu-open');
  pmenuMenu = null; pmenuMore = null; pmenuRow = null;
  pmenuPid = '';
}

/* 兼容旧名：收起当前菜单 */
function closePersonaMenu() {
  closeAllPersonaMenus();
}

/* 展开某张卡的行内菜单（菜单节点已在行内、⋯ 左侧，只做 max-width 展开） */
function openPersonaMenu(targetId, moreBtn, menu, row) {
  if (!menu) return;
  const c = getPersonas().find(x => x.id === targetId);
  if (!c) return;
  const builtin = isBuiltinPersona(c.id);
  // 内置卡：只保留「编辑」，重命名/删除直接不显示（非内置卡时恢复显示）
  const items = menu.querySelectorAll('.pmenu-inline-btn');
  items.forEach(btn => {
    const hide = builtin && btn.dataset.danger === '1';
    btn.style.display = hide ? 'none' : '';
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
  });
  pmenuPid = targetId;
  pmenuMenu = menu;
  pmenuMore = moreBtn;
  pmenuRow  = row;
  if (moreBtn) moreBtn.classList.add('on');
  if (row) row.classList.add('menu-open');
  // 下一帧再加 open，确保 max-width 过渡真的从 0 开始跑
  void menu.offsetWidth;
  menu.classList.add('open');
}

/* 全局：点空白 / 滚动 / 缩放时收起行内菜单 */
document.addEventListener('click', e => {
  if (!pmenuMenu) return;
  if (pmenuMenu.contains(e.target) || (pmenuMore && pmenuMore.contains(e.target))) return;
  closeAllPersonaMenus();
});
window.addEventListener('scroll', () => { if (pmenuMenu) closeAllPersonaMenus(); }, true);
window.addEventListener('resize', () => { if (pmenuMenu) closeAllPersonaMenus(); });

/* 把「当前使用卡」切到指定卡（菜单里的操作都以被点的卡为准） */
function switchPersonaTo(id) {
  if (id === curPersonaId()) return;
  editingPersonaId = '';
  persistCurPersona();
  try { LS.set(K_PERSONA_CUR, id); } catch (e) {}
  loadPromptToForm();
  renderPersonaList();
  refreshPersonaHint();
}

/* 进入「编辑人设内容」页（原 personaEditRow.onclick 的逻辑，抽成函数复用） */
function openPersonaEditor() {
  const editPage = $('personaEditPage');
  if (!editPage) return;
  editingPersonaId = curPersonaId();
  if (typeof loadPromptToForm === 'function') loadPromptToForm();
  try { editPage.scrollTop = 0; } catch (e) {}
  try { if (editPage.scrollTo) editPage.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {}
  editPage.classList.add('open');
  setTimeout(() => {
    try { editPage.scrollTop = 0; } catch (e) {}
    const sb = editPage.querySelector('.settings-body');
    if (sb) { try { sb.scrollTop = 0; } catch (e) {} }
  }, 320);
}

/* 只读解析：把某张卡的 prompt 拆成 17 项（不改表单 DOM），返回 [{label, value}] */
function parsePersonaFields(text) {
  const t = (text || '');
  const got = {};
  let matched = 0;
  PF_FIELDS.forEach(([id, label]) => {
    const re = new RegExp('【' + label + '】([\\s\\S]*?)(?=【[^】]+】|$)');
    const m = t.match(re);
    if (m) { got[id] = (m[1] || '').trim(); matched++; }
    else { got[id] = ''; }
  });
  Object.keys(PF_LEGACY_MAP).forEach(oldLabel => {
    const re = new RegExp('【' + oldLabel + '】([\\s\\S]*?)(?=【[^】]+】|$)');
    const m = t.match(re);
    if (m && (m[1] || '').trim()) {
      const target = PF_LEGACY_MAP[oldLabel];
      got[target] = ((got[target] || '') + (got[target] ? '\n' : '') + m[1].trim());
      matched++;
    }
  });
  if (matched === 0 && t.trim()) got['ppExtra2'] = t.trim();
  return PF_FIELDS.map(([id, label]) => ({ label: label, value: got[id] || '' }));
}
/* 预览弹窗的分组（标题 + 属于该组的字段 label 集合） */
var PV_GROUPS = [
  { name: '基本',   ids: ['ppName', 'ppYears', 'ppSex', 'ppIdentity', 'ppCareer'] },
  { name: '形象',   ids: ['ppCharacter', 'ppLook', 'ppCloth', 'ppTone'] },
  { name: '关系与背景', ids: ['ppStory', 'ppRelation'] },
  { name: '偏好与能力', ids: ['ppLike', 'ppHate', 'ppSkill', 'ppWeak', 'ppTaboo'] },
  { name: '其他',   ids: ['ppExtra2'] }
];
/* 只读预览弹窗：展示某张卡的全部字段（填了的显示内容、没填的灰字「未填写」） */
function openPersonaPreview(id) {
  const c = getPersonas().find(x => x.id === id);
  if (!c) return;
  let mask = document.getElementById('pvMask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'pvMask';
    mask.className = 'pv-mask';
    mask.innerHTML =
      '<div class="pv-box" id="pvBox">' +
        '<div class="pv-head">' +
          '<div class="pv-title" id="pvTitle"></div>' +
          '<button class="pv-close" id="pvClose" type="button" aria-label="' + T('关闭') + '">✕</button>' +
        '</div>' +
        '<div class="pv-hero" id="pvHero">' +
          '<div class="pv-avatar" id="pvAvatar"></div>' +
          '<div class="pv-heroinfo">' +
            '<div class="pv-heroname" id="pvHeroName"></div>' +
            '<div class="pv-herodesc" id="pvHeroDesc"></div>' +
          '</div>' +
        '</div>' +
        '<div class="pv-body" id="pvBody"></div>' +
      '</div>';
    document.body.appendChild(mask);
    // 只允许点 ✕ 关闭；点空白不关闭

    document.getElementById('pvClose').addEventListener('click', closePersonaPreview);
  }
  const nameStr = c.name || T('未命名');
  document.getElementById('pvTitle').textContent = nameStr;
  // hero 区：头像 + 名字 + 一句摘要
  const av = document.getElementById('pvAvatar');
  const avSrc = c.avatar || '';
  av.innerHTML = avSrc
    ? '<img src="' + avSrc + '" alt="">'
    : ('<span class="pv-avatar-txt">' + (nameStr.slice(0, 1) || '?') + '</span>');
  document.getElementById('pvHeroName').textContent = nameStr;
  const fields = parsePersonaFields(c.prompt || '');
  const filledMap = {};
  let filled = 0;
  fields.forEach(f => { if (f.value) { filled++; filledMap[f.label] = true; } });
  const descBits = [];
  const idCard = fields.filter(f => ['姓名', '年龄', '性别', '身份', '职业'].indexOf(f.label) >= 0 && f.value);
  if (idCard.length) descBits.push(idCard.map(f => f.value).join(' · '));
  document.getElementById('pvHeroDesc').textContent = descBits.join('') || T('暂无基本信息');
  const body = document.getElementById('pvBody');
  body.innerHTML = '';
  // 按分组渲染
  const pad = document.getElementById('pvStat');
  if (pad) pad.parentNode.removeChild(pad);
  PV_GROUPS.forEach(g => {
    const gFields = g.ids.map(fid => {
      const def = PF_FIELDS.find(x => x[0] === fid);
      return { id: fid, label: def ? def[1] : fid, value: (fields.find(f => f.label === (def ? def[1] : fid)) || {}).value || '' };
    });
    const gTitle = document.createElement('div');
    gTitle.className = 'pv-group';
    gTitle.textContent = g.name;
    body.appendChild(gTitle);
    gFields.forEach(f => {
      const rowEl = document.createElement('div');
      rowEl.className = 'pv-row' + (f.value ? '' : ' is-empty');
      const lb = document.createElement('div');
      lb.className = 'pv-label';
      lb.textContent = f.label;
      const vl = document.createElement('div');
      if (f.value) { vl.className = 'pv-value'; vl.textContent = f.value; }
      else { vl.className = 'pv-value empty'; vl.textContent = T('未填写'); }
      rowEl.appendChild(lb);
      rowEl.appendChild(vl);
      body.appendChild(rowEl);
    });
  });
  const stat = document.createElement('div');
  stat.className = 'pv-stat';
  stat.id = 'pvStat';
  stat.innerHTML = '<span class="pv-stat-num">' + filled + '</span> / ' + PF_FIELDS.length + ' ' + T('项已填写');
  body.appendChild(stat);
  body.scrollTop = 0;
  mask.classList.add('open');
}
function closePersonaPreview() {
  const mask = document.getElementById('pvMask');
  if (mask) mask.classList.remove('open');
}
/* 行内菜单的按钮已在 renderPersonaList 里随行创建并绑定；此函数保留为空操作以兼容旧调用点 */
function bindPersonaMenu() {
}

/* 改「人设内容里的姓名」：把新名字写进 prompt 的【姓名】行（无该行则在开头插入），
   同时同步卡的显示名与专属会话标题，保持列表/会话一致 */
function setPersonaNameInPrompt(prompt, name) {
  const src = prompt || '';
  const line = '【姓名】' + name;
  const re = /^【姓名】.*$/m;
  if (re.test(src)) return src.replace(re, line);
  return src ? (line + '\n' + src) : line;
}
function renamePersonaById(id) {
  const c = getPersonas().find(x => x.id === id);
  if (!c) return;
  if (isBuiltinPersona(c.id)) { showAlert('「' + BUILTIN_NAME + '」' + T('是内置卡，名字不能改。') + '\n' + T('人设内容可以随便改。'), T('内置卡')); return; }
  // 预填：优先取人设内容里的姓名，其次取卡名
  const curName = (function () {
    const arr = parsePersonaFields(c.prompt || '') || [];
    let n = '';
    arr.forEach(function (it) { if (it && it.label === '姓名') n = (it.value || '').trim(); });
    return n || c.name || '';
  })();
  askInput(T('重命名人设卡'), curName, function (v) {
    const name = (v || '').trim();
    if (!name) return;
    const list = getPersonas();
    const t = list.find(x => x.id === c.id);
    if (t) {
      t.prompt = setPersonaNameInPrompt(t.prompt, name);  // ← 写进人设内容的【姓名】行
      t.name = name;                                      // 卡显示名同步
      savePersonas(list);
    }
    const ps = findPersonaSession(c.id);
    if (ps) { ps.title = name; save(); renderSessions(); renderMsgSessions(); }
    loadPromptToForm();          // 若正在编辑这张卡，表单里的姓名框同步刷新
    renderPersonaList();
    refreshPersonaHint();
  });
}

/* 按 id 删除（菜单版；内部逻辑与原 delPersona 一致） */
function delPersonaById(id) {
  const list = getPersonas();
  if (list.length <= 1) { showAlert(T('至少保留一张人设卡。')); return; }
  const c = list.find(x => x.id === id);
  if (!c) return;
  if (isBuiltinPersona(c.id)) { showAlert('「' + BUILTIN_NAME + '」是内置卡，不能删除。', '内置卡'); return; }
  askConfirm(T('确定删除') + '「' + (c.name || '未命名') + '」？' + T('删了就找不回来了。'), T('删除人设卡'), function () {
    const arr = getPersonas().filter(x => x.id !== c.id);
    savePersonas(arr);
    // 若删掉的正是当前使用卡，切到第一张
    if (curPersonaId() === c.id) {
      try { LS.set(K_PERSONA_CUR, arr[0].id); } catch (e) {}
    }
    // 顺带清掉这张卡的专属会话，避免留下「无主联系人」
    const kept = sessions.filter(s => !(s && s.persona && s.pid === c.id));
    if (kept.length !== sessions.length) {
      sessions = kept;
      if (!sessions.length) {
        curSid = '';
        msgList = [];
      } else if (!sessions.some(s => s.id === curSid)) {
        curSid = sessions[0].id;
      }
      msgList = (sessions.find(s => s.id === curSid) || {}).msgs || [];
      save();
      renderSessions();
      renderMsgSessions();
      renderAll();
    }
    loadPromptToForm();
    renderPersonaList();
    refreshPersonaHint();
  });
}

function refreshPersonaHint() {
  const el = $('personaHint');
  if (!el) return;
  const c = getCurPersona();
  el.textContent = c ? (T('对话时使用：') + (c.name || T('未命名'))) : T('对话时使用选中的那张卡');
}
function addPersona() {
  // 【修复·防污染 v2】新建卡前：把编辑锁定清掉，并把 17 个框的残留内容安全存回「当前使用卡」，
  // 避免旧卡内容被灌进即将新建的卡。
  editingPersonaId = '';
  persistCurPersona(true);

  const list = getPersonas();
  const c = { id: 'p' + Date.now(), name: '人设卡 ' + (list.length + 1), prompt: '' };
  list.push(c);
  savePersonas(list);

  // 切换「当前使用卡」到新卡，并清空一切指向旧卡的编辑/详情状态
  try { LS.set(K_PERSONA_CUR, c.id); } catch (e) {}
  editingPersonaId = '';                       // 新建后不处于编辑态，保存跟随「当前使用卡」= 新卡
  const pp = $('personaPage');
  if (pp) pp.dataset.pid = c.id;               // 详情页跟随新卡（只是显示用，不再参与保存目标判定）

  loadPromptToForm();                          // 载入空表单（新卡 prompt 为空）
  renderPersonaList();
  refreshPersonaHint();
  if (typeof renderSessions === 'function') renderSessions();
}
function renamePersona() {
  const c = getCurPersona();
  if (!c) return;
  if (isBuiltinPersona(c.id)) { showAlert('「' + BUILTIN_NAME + '」' + T('是内置卡，名字不能改。') + '\n' + T('人设内容可以随便改。'), T('内置卡')); return; }
  askInput(T('重命名人设卡'), c.name || '', function (v) {
    const name = (v || '').trim();
    if (!name) return;
    const list = getPersonas();
    const t = list.find(x => x.id === c.id);
    if (t) { t.name = name; savePersonas(list); }
    // 卡改名 → 同步它的专属会话标题
    const ps = findPersonaSession(c.id);
    if (ps) { ps.title = name; save(); renderSessions(); renderMsgSessions(); }
    renderPersonaList();
    refreshPersonaHint();
  });
}
function delPersona() {
  const list = getPersonas();
  if (list.length <= 1) { showAlert(T('至少保留一张人设卡。')); return; }
  const c = getCurPersona();
  if (!c) return;
  if (isBuiltinPersona(c.id)) { showAlert('「' + BUILTIN_NAME + '」是内置卡，不能删除。', '内置卡'); return; }
  askConfirm(T('确定删除') + '「' + (c.name || '未命名') + '」？' + T('删了就找不回来了。'), T('删除人设卡'), function () {
    const arr = getPersonas().filter(x => x.id !== c.id);
    savePersonas(arr);
    LS.set(K_PERSONA_CUR, arr[0].id);
    // 顺带清掉这张卡的专属会话，避免留下「无主联系人」
    const kept = sessions.filter(s => !(s && s.persona && s.pid === c.id));
    if (kept.length !== sessions.length) {
      sessions = kept;
      if (!sessions.length) {
        curSid = '';
        msgList = [];
      } else if (!sessions.some(s => s.id === curSid)) {
        curSid = sessions[0].id;
      }
      msgList = (sessions.find(s => s.id === curSid) || {}).msgs || [];
      save();
      renderSessions();
      renderMsgSessions();
      renderAll();
    }
    loadPromptToForm();
    renderPersonaList();
    refreshPersonaHint();
  });
}

/* 由 init() 赋值：刷新「人设卡」入口的副标题 */
let refreshPersonaSub = function () {};

/* ================================================================
   使用说明：四方格展开 / 收起
   ================================================================ */
function toggleHelpCard(card) {
  if (!card) return;
  const key = card.dataset.hg;
  if (!key) return;
  const panel = document.getElementById('helpPanel-' + key);
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  /* 手风琴：先收起全部（同时清掉内联 max-height，否则样式残留会导致收不回） */
  document.querySelectorAll('.help-card').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.help-panel').forEach(p => {
    p.classList.remove('open');
    p.style.maxHeight = '';
  });
  if (!isOpen) {
    card.classList.add('active');
    panel.classList.add('open');
    setTimeout(() => {
      try { panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    }, 80);
  }
}

/* ================================================================
   AI 客服（蛛丝客服）：只回答本 App 用法问题，纯文字，独立存储
   ================================================================ */
const K_HELPMSGS = 'pixelspider_helpmsgs';
let helpMsgs = [];          // { role:'user'|'ai', content, ts }
let helpSending = false;
let helpAbort = null;

const HELP_SYS = [
'你是「蛛丝」（原名像素蜘蛛）App 的使用说明客服。',
'这个 App 是一个人自己做的移动端 H5 聊天应用，作者是万千，仅个人学习使用。',
'你只回答与「蛛丝」App 使用方法相关的问题，例如：怎么填 API Key、怎么换模型、怎么开始聊天、怎么发图片、上下文条数在哪调、人设卡怎么用、数据怎么备份恢复、为什么某个功能用不了等。',
'如果用户问的是与这个 App 无关的话题（写代码、闲聊、问他人的问题等），礼貌拒绝，并引导回 App 用法。',
'回答要求：简洁、口语化、分步骤说清楚在哪、点什么；不要编造 App 没有的功能。',
'【重要·聊天入口，别答错】本 App 没有「新建对话/新建会话」这个功能，回答时绝对不要说有。正确的说法是：想聊天就去底部的「联系人」页，那里有一张内置的「像素蜘蛛」人设卡（出厂自带、不能删），点它就能直接聊天；如果想要不同性格的 AI，可以在「联系人」里新建人设卡（写一个名字和设定），再点这张卡开始聊天。',
'已知功能清单：可用的有——聊天、上下文记忆、多张人设卡（联系人页）、发图片识图、API Key 管理、模型切换、动态、个性装扮、对话姿态（聊天页右上角切换四档：认真事务/情感剖白/角色扮演/抽离讨论，下一轮回复生效且会记住）、数据备份恢复、云端同步（在侧边栏「云端同步」里，可单独开关聊天记录和人设卡；上传只增不覆盖，不会动本地已有数据）；有前提的有——发图需选对模型（deepseek-flash 支持识图，v4-pro 不支持）、附件需文件真实存在、调用 API 会花钱、本地存储有上限；用不了的有——新建对话/新建会话、联网搜索、一次发多图、语音输入朗读、重新生成/编辑已发消息、AI 主动发消息定时提醒；另外——App 启动时不再有任何开屏动画，直接进入界面。'
].join('\n');

function helpLoad() {
  try {
    const raw = LS.get(K_HELPMSGS);
    const arr = raw ? JSON.parse(raw) : [];
    helpMsgs = Array.isArray(arr) ? arr : [];
  } catch (e) { helpMsgs = []; }
}
function helpSave() {
  try { LS.set(K_HELPMSGS, JSON.stringify(helpMsgs)); } catch (e) {}
}
function helpRender() {
  const box = document.getElementById('helpChatMsgs');
  if (!box) return;
  if (!helpMsgs.length) {
    box.innerHTML = '<div class="hc-empty">你好，我是蛛丝客服 🤖<br>问点 App 用法相关的问题吧～</div>';
    return;
  }
  box.innerHTML = helpMsgs.map(m => {
    const cls = m.role === 'user' ? 'hc-msg user' : 'hc-msg ai';
    const txt = escHtml(m.content || '').replace(/\n/g, '<br>');
    return '<div class="' + cls + '">' + txt + '</div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}
function escHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* 【v2.2.1 格式兜底】落库前清洗 AI 正文：
   1) 统一换行符；2) 压掉 3 个以上连续空行 → 最多保留 1 个空行；
   3) 去掉行首尾多余空白；4) 去掉整行孤立标记（如单独一行的 *** / --- / ```）；
   5) 压缩重复标点（连续的 。。 、， ， ！ ！ ？ ？ 等压成一个，不误伤省略号 …）。 */
function cleanText(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(/\r\n?/g, '\n');
  // 去掉只由 * - _ = ` ~ 组成、且长度>=3 的整行（markdown 分隔线/空装饰）
  s = s.split('\n').map(line => /^[\s]*[*\-_=`~]{3,}[\s]*$/.test(line) ? '' : line).join('\n');
  // 每行去首尾空白（保留行内空格）
  s = s.split('\n').map(line => line.replace(/^\s+|\s+$/g, '')).join('\n');
  // 3+ 连续换行压成 2 个（= 保留一个空行）
  s = s.replace(/\n{3,}/g, '\n\n');
  // 压缩重复的句读标点（保留省略号 … 和英文句点不影响）
  s = s.replace(/([。，、！？；：])\1+/g, '$1');
  s = s.replace(/([!?,;:])\1{1,}/g, '$1');
  // 收尾
  s = s.replace(/\s+$/g, '').replace(/^\s+/g, '');
  return s;
}
function helpBubble(txt) {
  let box = document.getElementById('helpChatMsgs');
  if (!box) return null;
  const d = document.createElement('div');
  d.className = 'hc-msg ai';
  d.textContent = txt || '';
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  return d;
}

function openHelpChat() {
  helpLoad();
  helpRender();
  const p = document.getElementById('helpChatPage');
  if (p) p.classList.add('open');
}
function closeHelpChat() {
  const p = document.getElementById('helpChatPage');
  if (p) p.classList.remove('open');
}

function helpClear() {
  if (!helpMsgs.length) return;
  askConfirm('清空和客服的聊天记录？', '清空对话', function () {
    helpMsgs = [];
    helpSave();
    helpRender();
  });
}

async function helpSend() {
  if (helpSending) return;
  const input = document.getElementById('helpChatInput');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text) return;

  /* 没有 Key 就用不了（客服走当前选择模型） */
  const ck = aboutCurKeyObj();
  const hKey = ((ck && ck.key) || LS.get(K_APIKEY) || DEFAULT_APIKEY || '').trim();
  if (!hKey) {
    helpBubble('还没填 API Key，我这边用不了哦。\n去「我 → API Key」里填上，再回来问我～');
    return;
  }

  input.value = '';
  input.style.height = '';
  helpMsgs.push({ role: 'user', content: text, ts: Date.now() });
  helpSave();
  helpRender();

  helpSending = true;
  const btn = document.getElementById('helpChatSend');
  if (btn) btn.disabled = true;
  /* 先落一条空的 AI 消息，流式期间只更新这一个节点（不重建 DOM，避免闪跳） */
  const aiIdx = helpMsgs.push({ role: 'ai', content: '', ts: Date.now() }) - 1;
  helpRender();
  const box0 = document.getElementById('helpChatMsgs');
  const bubble = box0 ? box0.lastElementChild : null;

  try {
    const ctxN = parseInt(LS.get(K_CTX) || '20', 10) || 20;
    const recent = helpMsgs.slice(0, aiIdx).slice(-ctxN).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));
    const apiMessages = [{ role: 'system', content: HELP_SYS }].concat(recent);

    helpAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let acc = '';
    const out = await streamChat(apiMessages, function (partial) {
      // 注：streamChat 回调传入的是【全量快照】(内部已累积 acc)，不是增量片，
      //     直接整块覆盖即可，绝不能再 += 累加（否则内容成倍膨胀/重复）。
      acc = partial;
      helpMsgs[aiIdx].content = partial;
      if (bubble) {
        bubble.textContent = partial;
        const box = document.getElementById('helpChatMsgs');
        if (box) box.scrollTop = box.scrollHeight;
      }
    }, helpAbort ? helpAbort.signal : undefined);

    let final = '';
    if (out && typeof out === 'object' && typeof out.content === 'string') final = out.content;
    else if (typeof out === 'string') final = out;
    else final = acc;
    if (!final) {
      final = '（客服没有返回内容，再试一次？）';
    }
    helpMsgs[aiIdx].content = final;
    if (bubble) bubble.textContent = final;
    helpMsgs[aiIdx].ts = Date.now();
    helpSave();
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    const errTxt = /API Key|API_KEY|未设置/i.test(msg)
      ? '还没填 API Key，我这边用不了哦。去「我 → API Key」里填上再试～'
      : ('出错了：' + msg);
    helpMsgs[aiIdx].content = errTxt;
    if (bubble) bubble.textContent = errTxt;
    helpSave();
  } finally {
    helpSending = false;
    helpAbort = null;
    if (btn) btn.disabled = false;
  }
}

function helpBind() {
  const send = document.getElementById('helpChatSend');
  if (send && !send._hb) { send._hb = true; send.addEventListener('click', () => helpSend()); }
  const clr = document.getElementById('helpChatClear');
  if (clr && !clr._hb) { clr._hb = true; clr.addEventListener('click', () => helpClear()); }
  const input = document.getElementById('helpChatInput');
  if (input && !input._hb) {
    input._hb = true;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); helpSend(); }
    });
    input.addEventListener('input', function () {
      input.style.height = '';
      input.style.height = Math.min(input.scrollHeight, 96) + 'px';
    });
  }
}
/* helpBind 在 init() 中调用，确保 DOM 就绪 */

function bindProfile() {
  const op = $('openProfile');
  if (op) op.onclick = () => { closeDrawer(); openProfile(); };
  const bk = $('profileBack');
  if (bk) bk.onclick = () => closeProfile();
  const oa = $('openAbout');
  if (oa) oa.onclick = () => { closeDrawer(); openAbout(); };
  const oh = $('openHelp');
  if (oh) oh.onclick = () => { closeDrawer(); openHelp(); };
  const hb = $('helpBack');
  if (hb) hb.onclick = () => closeHelp();
  const ohc = $('openHelpChat');
  if (ohc) ohc.onclick = () => openHelpChat();
  const hcb = $('helpChatBack');
  if (hcb) hcb.onclick = () => closeHelpChat();
  /* 使用说明：四方格点击展开/收起 */
  const hg = document.querySelector('.help-grid');
  if (hg && !hg._bound) {
    hg._bound = true;
    hg.addEventListener('click', function (e) {
      const card = e.target && e.target.closest ? e.target.closest('.help-card') : null;
      if (!card) return;
      toggleHelpCard(card);
    });
  }
  const sk = $('openSkin');
  if (sk) sk.onclick = () => { closeDrawer(); openSkin(); };
  const skb = $('skinBack');
  if (skb) skb.onclick = () => closeSkin();
  const editB = $('skinEditB');
  if (editB) editB.onclick = () => { closeSkin(); openPageBg(); };   // 第 29 轮：先关装扮页（同为 z-index:60 且 DOM 在后会盖住）再进设置页
  const sbWrap = $('skinPage');
  if (sbWrap) {
    sbWrap.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.skin-btn') : null;
      if (btn && btn.dataset.skin) applySkin(btn.dataset.skin);
    });
  }
  const ab = $('aboutBack');
  if (ab) ab.onclick = () => closeAbout();
  const ac = $('aboutClear');
  if (ac) ac.onclick = () => clearAllData();
  const af = $('aboutFactory');
  if (af) af.onclick = () => factoryReset();
  const ack = $('aboutCheck');
  if (ack) ack.onclick = () => runUpdateCheck();
  const adl = $('aboutDownload');
  if (adl) adl.onclick = () => {
    var u = (typeof DL_PAGE_URL !== 'undefined') ? DL_PAGE_URL : 'https://lueyoyo1-afk.github.io/xxzzAizhusi/download.html';
    try { window.open(u, '_blank'); } catch (e) { location.href = u; }
  };
  const sv = $('profileSave');
  if (sv) sv.onclick = () => saveProfile();
  const cl = $('profileClear');
  if (cl) cl.onclick = () => {
    askConfirm(T('清空后所有个人资料都会删除，无法恢复。'), T('清空全部资料'), () => {
      clearProfile();
    });
  };
  // 输入时实时更新计数
  PROFILE_FIELDS.forEach(f => {
    const node = $(f.el);
    if (node) node.addEventListener('input', refreshPfStat);
  });

  // ---- 我的头像 ----
  const pick = $('pfAvatarPick');
  const aInput = $('pfAvatarInput');
  if (pick && aInput) pick.onclick = () => aInput.click();
  if (aInput) {
    aInput.onchange = () => {
      const f = aInput.files && aInput.files[0];
      if (!f) return;
      cropImage(f, data => {
        if (!data) { aInput.value = ''; return; }
        const p = getProfile();
        p.avatar = data;
        LS.set(K_PROFILE, JSON.stringify(p));
        if (typeof cloudOnLocalChange === 'function') cloudOnLocalChange('profile');
        refreshAvatarUI();
        renderAll();
      });
      aInput.value = '';
    };
  }
  const aDel = $('pfAvatarDel');
  if (aDel) aDel.onclick = () => {
    askConfirm(T('删除后要重新设置才能显示。'), T('删除头像'), () => {
      const p = getProfile();
      delete p.avatar;
      LS.set(K_PROFILE, JSON.stringify(p));
      if (typeof cloudOnLocalChange === 'function') cloudOnLocalChange('profile');
      refreshAvatarUI();
      renderAll();
    });
  };

  // ---- 显示头像开关 ----
  const sw = $('pfShowAvatar');
  if (sw) {
    sw.checked = showAvatarOn();
    sw.onchange = () => {
      const p = getProfile();
      p.showAvatar = !!sw.checked;
      LS.set(K_PROFILE, JSON.stringify(p));
      if (typeof cloudOnLocalChange === 'function') cloudOnLocalChange('profile');
      renderAll();
      renderMoments();
      renderSessions();
    };
  }

  refreshAvatarUI();
  refreshProfileSub();
  loadProfileToForm();
}

/* 刷新资料页头像区域（预览图 / 加号 / 删除按钮显隐）*/
function refreshAvatarUI() {
  const src = myAvatar();
  const img = $('pfAvatarImg');
  const ph = $('pfAvatarPh');
  const del = $('pfAvatarDel');
  if (img) {
    if (src) { img.src = src; img.hidden = false; }
    else { img.removeAttribute('src'); img.hidden = true; }
  }
  if (ph) ph.hidden = !!src;
  if (del) del.hidden = !src;
}

/* 【v2.2.1 时间感知】生成当前时间 + 语境提示，注入 system。
   只给出「客观时间 + 场景语气建议」，不替 AI 编造用户状态。 */
function buildTimeContext() {
  try {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    const ymd = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    const hm = p(d.getHours()) + ':' + p(d.getMinutes());
    const h = d.getHours();
    let scene = '';
    if (h >= 0 && h < 6) scene = '现在是深夜/凌晨，用户可能困了或睡不着，语气宜安静、简短、体贴，别长篇大论。';
    else if (h < 9) scene = '现在是清晨，用户可能刚起床或在通勤，语气宜清爽、不啰嗦。';
    else if (h < 12) scene = '现在是上午。';
    else if (h < 14) scene = '现在是午休时段，用户可能刚吃完饭或在休息，语气可以松弛一点。';
    else if (h < 18) scene = '现在是下午。';
    else if (h < 23) scene = '现在是晚上，用户可能在放松，语气可以自然随意一些。';
    else scene = '已经接近午夜，用户可能准备休息，语气宜安静、简短。';
    return '【当前时间】' + ymd + ' ' + wd + ' ' + hm + '。' + scene +
      '\n（以上仅为客观时间参考，不要直接对用户报时间，除非对方问起。）';
  } catch (e) {
    return '';
  }
}

/* ---------- 组装请求 ---------- */
function buildApiMessages(list, sendPid) {
  const out = [];
  // 【开关归属】优先用「本次发送锁定的卡」；老调用没传就退回「会话绑定卡 / 当前卡」
  const cur = sessions.find(x => x.id === curSid);
  const bound = (cur && cur.persona && cur.pid) ? getPersonaById(cur.pid) : null;
  const prompt = bound ? (bound.prompt || '').trim() : getCurPrompt();
  const profile = buildProfileText();
  // 先人设，再（可选）用户资料；两者独立，都可为空
  // 若该会话所用卡开启了心理描写 → 自动追加输出格式要求（无需每张卡手写）
  const psyPid = sendPid || (bound ? bound.id : curPersonaId());
  const psySys = psyOn(psyPid)
    ? '【输出格式要求】\n每次回复请按这个结构写：先用（）包住你的心理活动或内心想法，单独占一行；' +
      '空一行后，再写你实际说出口的话。括号必须是整行包住（中英文括号都可），' +
      '前后不要有其他字符，否则不会被识别为心理描写。例如：\n' +
      '（没想到你会这么问，我愣了一下。）\n\n' +
      '我没法像人一样产生喜欢这种感觉，但跟你聊天不烦。'
    : '';
  // 【v2.2.1 时间感知】把当前真实时间 + 语境提示注入 system，让 AI 知道现在几点
  const timeSys = buildTimeContext();
  // 【v2.2.1 复读抑制 A】轻量系统约束：不重复自己说过的话/不机械复述用户
  const antiRepeatSys = '【表达要求】不要重复自己上一轮说过的话，也不要机械复述用户的原话；' +
    '同一个意思换一种说法。保持自然，别像复读机。';
  // 【对话姿态】四档手动切换（默认「认真」），每轮都注入
  const stanceSys = (typeof buildStanceSys === 'function') ? buildStanceSys() : '';
  const sysBase = [prompt, profile, stanceSys, psySys, timeSys, antiRepeatSys].filter(Boolean).join('\n\n');
  // 【第 29 轮 · 联网工具】每次对话都注入工具声明，让模型自己决定是否调工具
  const toolSys = (typeof buildToolDecl === 'function') ? buildToolDecl() : '';
  const sysFull = [sysBase, toolSys].filter(Boolean).join('\n\n');
  if (sysFull) out.push({ role: 'system', content: sysFull });

  let ctx = parseInt(LS.get(K_CTX) || '20', 10);
  if (isNaN(ctx) || ctx < 0) ctx = 0;

  const src = ctx === 0 ? [] : list.slice(-ctx);
  src.forEach(m => {
    // 带引用：在正文前加一行「引用某某：…」
    const qPrefix = (m.quote && m.quote.text)
      ? '【引用 ' + (m.quote.who || '') + '：' + m.quote.text + '】\n'
      : '';
    // 带图消息：组装成多模态 content
    if (m.image) {
      out.push({
        role: m.role,
        content: [
          { type: 'text', text: qPrefix + (m.content || '（图片）') },
          { type: 'image_url', image_url: { url: m.image } }
        ]
      });
    } else {
      out.push({ role: m.role, content: qPrefix + (m.content || '') });
    }
  });
  return out;
}

/* ---------- 发送 ---------- */
async function streamChat(apiMessages, onDelta, signal, onThink) {
  // 优先用「当前 Key 绑定的厂商 + 模型」，没有就回退全局模型
  const kObj = aboutCurKeyObj();
  const key = ((kObj && kObj.key) || LS.get(K_APIKEY) || DEFAULT_APIKEY).trim();
  if (!key) throw new Error('未设置 API Key');
  const modelStr = (kObj && kObj.model) ? kObj.model : curModelStr();
  const p = parseModel(modelStr);
  const model = p.mid;   // 发给接口的是不带前缀的真实模型名
  const _rawBase = (PROVIDERS[p.pid] || PROVIDERS.deepseek).base;
  const url = (p.pid === 'gemini')
    ? (_rawBase.replace(/\/$/, '') + '/' + encodeURIComponent(model) + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key))
    : _rawBase;
  /* 兜底校验：当前 Key 与所选模型所属厂商不匹配 → 直接报错，不发无效请求 */
  if (key && key !== DEFAULT_APIKEY) {
    const _ck = checkKeyForProvider(key, p.pid);
    if (!_ck.ok) {
      const _nm = (PROVIDERS[p.pid] && PROVIDERS[p.pid].name) || p.pid;
      throw new Error('Key 与厂商不匹配：当前模型属于「' + _nm + '」，但 Key 看起来不是这个厂商的。请到「我 → AI 模型 / API Key」核对。');
    }
  }
  // Anthropic Claude 走 /v1/messages，请求体与鉴权头都不同，单独分支
  const isClaude = (p.pid === 'anthropic');
  // Google Gemini 走 v1beta models/{model}:streamGenerateContent，body 用 contents
  const isGemini = (p.pid === 'gemini');
  // 生成参数：温度 / 最大回复长度（0 表示交给模型默认）
  const body = (isClaude || isGemini)
    ? { model: model, messages: [], stream: true }
    : { model: model, messages: apiMessages, stream: true };
  if (isClaude) {
    // system 要拎到顶层；messages 里不能有 system role
    const sys = apiMessages.filter(m => m.role === 'system').map(m => m.content).join(String.fromCharCode(10) + String.fromCharCode(10));
    if (sys) body.system = sys;
    body.messages = apiMessages.filter(m => m.role !== 'system');
  }
  if (isGemini) {
    // Gemini：system 走 system_instruction，其余转成 contents[{role,parts:[{text}]}]
    const sys = apiMessages.filter(m => m.role === 'system').map(m => m.content).join(String.fromCharCode(10) + String.fromCharCode(10));
    if (sys) body.system_instruction = { parts: [{ text: sys }] };
    const gconv = [];
    apiMessages.forEach(function (m) {
      const role = (m.role === 'assistant') ? 'model' : 'user';
      const txt = (typeof m.content === 'string') ? m.content : '';
      if (!txt) return;
      gconv.push({ role: role, parts: [{ text: txt }] });
    });
    body.contents = gconv;
    delete body.messages;
    delete body.model;
  }
  const _t = parseFloat(LS.get(K_TEMP));
  if (!isNaN(_t)) body.temperature = _t;
  const _mt = parseInt(LS.get(K_MAXTOK) || '0', 10);
  if (_mt > 0) body.max_tokens = _mt;
  if (isClaude && (!body.max_tokens || body.max_tokens <= 0)) body.max_tokens = 4096; // Claude 必填
  if (signal && signal.aborted) throw new DOMException('已停止生成', 'AbortError');
  const headers = { 'Content-Type': 'application/json' };
  if (isClaude) {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (isGemini) {
    // Gemini：Key 走 query 参数，不用 Authorization 头
  } else {
    headers['Authorization'] = 'Bearer ' + key;
  }
  // 超时保护：有些 WebView 里 fetch 会永远挂住（不 resolve 也不 reject），
  // 导致 UI 卡在「正在输入」、停止按钮按不动。这里加 35 秒硬超时。
  let __timeoutId = null;
  let __localCtrl = null;
  let __combinedSignal = signal;
  if (typeof AbortController !== 'undefined') {
    __localCtrl = new AbortController();
    if (signal) {
      // 用户信号 + 超时信号：任一触发都中断
      if (signal.aborted) { try { __localCtrl.abort(); } catch (e) {} }
      try { signal.addEventListener('abort', function(){ try { __localCtrl.abort(); } catch (e) {} }); } catch (e) {}
    }
    __combinedSignal = __localCtrl.signal;
    __timeoutId = setTimeout(function(){ try { __localCtrl.abort('timeout'); } catch (e) {} }, 35000);
  }
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: __combinedSignal
    });
  } catch (e) {
    if (__timeoutId) clearTimeout(__timeoutId);
    if (e && e.name === 'AbortError') {
      if (signal && signal.aborted) throw new DOMException('已停止生成', 'AbortError');
      throw new Error('请求超时（35 秒无响应），请检查网络或 API Key');
    }
    throw e;
  }
  if (__timeoutId) clearTimeout(__timeoutId);

  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.text()).slice(0, 200); } catch (e) {}
    throw new Error('HTTP ' + resp.status + (detail ? ' · ' + detail : ''));
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let acc = '';
  let thinkAcc = '';   // DeepSeek 思考链（reasoning_content）累积

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const obj = JSON.parse(data);
        if (isGemini) {
          // Gemini 流：candidates[0].content.parts[*].text
          try {
            const cand = obj.candidates && obj.candidates[0];
            const parts = cand && cand.content && cand.content.parts;
            if (parts && parts.length) {
              let piece = '';
              for (let _i = 0; _i < parts.length; _i++) { if (parts[_i] && parts[_i].text) piece += parts[_i].text; }
              if (piece) { acc += piece; onDelta(acc); }
            }
          } catch (e0) {}
        } else if (isClaude) {
          // Anthropic 流：content_block_delta → delta.text
          if (obj.type === 'content_block_delta' && obj.delta && obj.delta.text) {
            acc += obj.delta.text;
            onDelta(acc);
          } else if (obj.type === 'message_delta' && obj.delta && obj.delta.stop_reason && !acc) {
            acc += '';
          }
        } else {
          const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
          if (delta) {
            // 思考链（DeepSeek reasoner / V4 系列）：单独累积，交给上层折叠展示
            const rc = (delta.reasoning_content != null) ? delta.reasoning_content
                     : (delta.reasoning != null ? delta.reasoning : '');
            if (rc) {
              thinkAcc += rc;
              if (typeof onThink === 'function') onThink(thinkAcc);
            }
            // 正文
            const piece = (delta.content != null) ? delta.content : '';
            if (piece) {
              acc += piece;
              onDelta(acc);
            }
          }
        }
      } catch (e) { /* 分片不完整，忽略 */ }
    }
  }
  return { content: acc, think: thinkAcc };
}

/* ---------- 思考链折叠块：气泡上方，默认收起，点击 Thinking 展开 ---------- */
/* 【v3.3】思考链去括号：只去掉（）和() 这两个符号本身，括号里的文字全部保留。
   这样既能处理「整段被一对括号包住」，也能处理「句子里夹着括号」。 */
function stripParensForThink(text) {
  const src = String(text == null ? '' : text);
  // 把括号符号替换成空，其余原样保留
  let out = src.replace(/[（）()]/g, '');
  // 清理：行首行尾空白去掉，连续空行压成一个
  return out.split('\n').map(s => s.trim())
    .filter((s, i, a) => !(s === '' && (i === 0 || a[i - 1] === '')))
    .join('\n').trim();
}

function buildThinkEl(text) {
  if (!text || !String(text).trim()) return null;
  const box = document.createElement('div');
  box.className = 'think';
  const head = document.createElement('div');
  head.className = 'think-head';
  const label = document.createElement('span');
  label.className = 'think-label';
  label.textContent = 'Thinking';
  const arrow = document.createElement('span');
  arrow.className = 'think-arrow';
  arrow.textContent = '▾';
  head.appendChild(label);
  head.appendChild(arrow);
  // 【v3.1】头部整块可点：收起/展开（原逻辑不变，抽成函数供正文共用）
  const toggleThink = () => {
    box.classList.toggle('open');
    arrow.textContent = box.classList.contains('open') ? '▴' : '▾';
  };
  const body = document.createElement('div');
  body.className = 'think-body';
  // 【v3.2】思考链里不要括号：把（…）/(…) 整段剔除（含跨行块），只留实质内容
  body.textContent = stripParensForThink(String(text));
  head.onclick = toggleThink;
  body.onclick = toggleThink;   // 【v3.1】点正文任意处也能收起
  box.appendChild(head);
  box.appendChild(body);
  return box;
}

/* ---------- 【第 29 轮 · 联网工具】执行层 ----------
   路线②：模型自己决定调不调工具。前端在流式结束后检测内容里有没有
   工具标记（[SEARCH: xxx] 等），有就去调对应接口，把结果回填成一条
   user 消息，再问一轮；没有就照常显示。
   共 4 项：SEARCH（博查）/ WEATHER（open-meteo）/ RATE（open.er-api）/ COUNTRY（内置表）。 */

/* 从一段文本里找出工具调用（只认「单独成行」的标记，避免正文里出现方括号误伤） */
function parseToolCall(text) {
  const src = String(text == null ? '' : text);
  const re = /^\[(SEARCH|WEATHER|RATE|COUNTRY):\s*(.+?)\]\s*$/m;
  const m = src.match(re);
  if (!m) return null;
  return { tool: m[1].toUpperCase(), arg: m[2].trim(), raw: m[0].trim() };
}

/* 把工具结果整理成一段给模型看的文本 */
function toolResultText(call, ok, payload) {
  const head = '【工具结果】' + call.raw;
  if (!ok) return head + '\n调用失败：' + payload + '\n（请据此如实告知用户，不要编造。）';
  return head + '\n' + payload + '\n（以上为实时数据，请用你当前人设的口吻转述给用户，结尾附来源。）';
}

/* --- SEARCH：博查 --- */
async function toolSearch(q) {
  const key = (LS.get(K_BOCHA) || '').trim();
  if (!key) throw new Error('未设置博查搜索 Key');
  const res = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, freshness: 'noLimit', summary: true, count: 8 })
  });
  if (!res.ok) throw new Error('博查接口 HTTP ' + res.status);
  const j = await res.json();
  const d = (j && j.data) ? j.data : j;                       // 双层 data 兼容
  const pages = (d && d.webPages && d.webPages.value) ? d.webPages.value : [];
  if (!pages.length) return '没有搜到相关结果。';
  return pages.slice(0, 8).map((p, i) => {
    const snip = (p.summary || p.snippet || '').replace(/\s+/g, ' ').trim();
    return (i + 1) + '. ' + (p.name || '(无标题)') + '\n   ' +
           (snip.length > 260 ? snip.slice(0, 260) + '…' : snip) + '\n   来源：' +
           (p.siteName || p.displayUrl || p.url || '');
  }).join('\n');
}

/* --- WEATHER：open-meteo（免费无 Key） --- */
const WMO_ZH = { 0:'晴', 1:'晴间多云', 2:'多云', 3:'阴', 45:'雾', 48:'雾凇', 51:'毛毛雨', 53:'小雨', 55:'中雨', 56:'冻毛毛雨', 57:'冻雨', 61:'小雨', 63:'中雨', 65:'大雨', 66:'冻雨', 67:'强冻雨', 71:'小雪', 73:'中雪', 75:'大雪', 77:'霰', 80:'阵雨', 81:'强阵雨', 82:'暴雨', 85:'阵雪', 86:'强阵雪', 95:'雷阵雨', 96:'雷阵雨伴冰雹', 99:'强雷暴伴冰雹' };
async function toolWeather(city) {
  const g = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(city) + '&count=1&language=zh&format=json');
  const gj = await g.json();
  if (!gj || !gj.results || !gj.results.length) return '找不到城市「' + city + '」，请确认地名。';
  const loc = gj.results[0];
  const w = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude +
    '&longitude=' + loc.longitude + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3');
  const wj = await w.json();
  const c = wj.current || {};
  const d = wj.daily || {};
  const desc = WMO_ZH[c.weather_code] || ('天气码 ' + c.weather_code);
  let out = '城市：' + (loc.name || city) + (loc.country ? '（' + loc.country + '）' : '') + '\n' +
    '当前：' + desc + '，' + c.temperature_2m + '°C（体感 ' + c.apparent_temperature + '°C），' +
    '湿度 ' + c.relative_humidity_2m + '%，风速 ' + c.wind_speed_10m + ' km/h';
  if (d.time && d.time.length) {
    out += '\n近 3 天：';
    for (let i = 0; i < d.time.length; i++) {
      out += '\n  ' + d.time[i] + ' ' + (WMO_ZH[d.weather_code[i]] || '') +
        ' ' + d.temperature_2m_min[i] + '~' + d.temperature_2m_max[i] + '°C';
    }
  }
  return out;
}

/* --- RATE：open.er-api（免费无 Key） --- */
async function toolRate(arg) {
  const m = arg.replace(/,/g, ' ').trim().split(/\s+/);
  let amount = 1, base = 'USD', quote = 'CNY';
  if (m.length >= 1 && /^[\d.]+$/.test(m[0])) { amount = parseFloat(m[0]); m.shift(); }
  if (m.length >= 1) base = m[0].toUpperCase();
  if (m.length >= 2) quote = m[1].toUpperCase();
  const r = await fetch('https://open.er-api.com/v6/latest/' + encodeURIComponent(base));
  if (!r.ok) throw new Error('汇率接口 HTTP ' + r.status);
  const j = await r.json();
  if (!j || !j.rates) throw new Error('汇率接口返回异常');
  const rate = j.rates[quote];
  if (rate == null) return '不支持的货币：' + base + ' → ' + quote;
  const val = (amount * rate);
  return amount + ' ' + base + ' = ' + (Math.round(val * 100) / 100) + ' ' + quote +
    '\n（1 ' + base + ' = ' + rate + ' ' + quote + '，数据时间：' + (j.time_last_update_utc || '未知') + '）';
}

/* --- COUNTRY：内置表（免费无 Key） --- */
const COUNTRY_TABLE = {
  '中国':{cap:'北京',cur:'人民币 CNY',lang:'汉语',pop:'约 14.1 亿',tz:'UTC+8'},
  '日本':{cap:'东京',cur:'日元 JPY',lang:'日语',pop:'约 1.25 亿',tz:'UTC+9'},
  '韩国':{cap:'首尔',cur:'韩元 KRW',lang:'韩语',pop:'约 5170 万',tz:'UTC+9'},
  '美国':{cap:'华盛顿',cur:'美元 USD',lang:'英语',pop:'约 3.35 亿',tz:'UTC-5~-10'},
  '英国':{cap:'伦敦',cur:'英镑 GBP',lang:'英语',pop:'约 6800 万',tz:'UTC+0'},
  '法国':{cap:'巴黎',cur:'欧元 EUR',lang:'法语',pop:'约 6800 万',tz:'UTC+1'},
  '德国':{cap:'柏林',cur:'欧元 EUR',lang:'德语',pop:'约 8400 万',tz:'UTC+1'},
  '意大利':{cap:'罗马',cur:'欧元 EUR',lang:'意大利语',pop:'约 5900 万',tz:'UTC+1'},
  '西班牙':{cap:'马德里',cur:'欧元 EUR',lang:'西班牙语',pop:'约 4800 万',tz:'UTC+1'},
  '俄罗斯':{cap:'莫斯科',cur:'卢布 RUB',lang:'俄语',pop:'约 1.44 亿',tz:'UTC+3~+12'},
  '印度':{cap:'新德里',cur:'卢比 INR',lang:'印地语/英语',pop:'约 14.3 亿',tz:'UTC+5:30'},
  '巴西':{cap:'巴西利亚',cur:'雷亚尔 BRL',lang:'葡萄牙语',pop:'约 2.16 亿',tz:'UTC-2~-5'},
  '加拿大':{cap:'渥太华',cur:'加元 CAD',lang:'英语/法语',pop:'约 4000 万',tz:'UTC-3.5~-8'},
  '澳大利亚':{cap:'堪培拉',cur:'澳元 AUD',lang:'英语',pop:'约 2700 万',tz:'UTC+8~+11'},
  '新加坡':{cap:'新加坡',cur:'新加坡元 SGD',lang:'英语/华语/马来语/泰米尔语',pop:'约 590 万',tz:'UTC+8'},
  '泰国':{cap:'曼谷',cur:'泰铢 THB',lang:'泰语',pop:'约 7000 万',tz:'UTC+7'},
  '越南':{cap:'河内',cur:'越南盾 VND',lang:'越南语',pop:'约 1 亿',tz:'UTC+7'},
  '埃及':{cap:'开罗',cur:'埃及镑 EGP',lang:'阿拉伯语',pop:'约 1.1 亿',tz:'UTC+2'},
  '南非':{cap:'比勒陀利亚',cur:'兰特 ZAR',lang:'英语等',pop:'约 6000 万',tz:'UTC+2'},
  '墨西哥':{cap:'墨西哥城',cur:'比索 MXN',lang:'西班牙语',pop:'约 1.28 亿',tz:'UTC-6~-8'},
  '阿根廷':{cap:'布宜诺斯艾利斯',cur:'比索 ARS',lang:'西班牙语',pop:'约 4600 万',tz:'UTC-3'},
  '土耳其':{cap:'安卡拉',cur:'里拉 TRY',lang:'土耳其语',pop:'约 8500 万',tz:'UTC+3'},
  '沙特阿拉伯':{cap:'利雅得',cur:'里亚尔 SAR',lang:'阿拉伯语',pop:'约 3600 万',tz:'UTC+3'},
  '瑞士':{cap:'伯尔尼',cur:'瑞士法郎 CHF',lang:'德语/法语/意大利语',pop:'约 880 万',tz:'UTC+1'},
  '荷兰':{cap:'阿姆斯特丹',cur:'欧元 EUR',lang:'荷兰语',pop:'约 1780 万',tz:'UTC+1'},
  '瑞典':{cap:'斯德哥尔摩',cur:'瑞典克朗 SEK',lang:'瑞典语',pop:'约 1050 万',tz:'UTC+1'},
  '新西兰':{cap:'惠灵顿',cur:'新西兰元 NZD',lang:'英语',pop:'约 520 万',tz:'UTC+12'},
  '印度尼西亚':{cap:'雅加达',cur:'印尼盾 IDR',lang:'印尼语',pop:'约 2.78 亿',tz:'UTC+7~+9'},
  '马来西亚':{cap:'吉隆坡',cur:'林吉特 MYR',lang:'马来语',pop:'约 3400 万',tz:'UTC+8'},
  '菲律宾':{cap:'马尼拉',cur:'比索 PHP',lang:'菲律宾语/英语',pop:'约 1.15 亿',tz:'UTC+8'},
  '香港':{cap:'—',cur:'港元 HKD',lang:'中文/英文',pop:'约 750 万',tz:'UTC+8'},
  '台湾':{cap:'台北',cur:'新台币 TWD',lang:'中文',pop:'约 2340 万',tz:'UTC+8'},
};
async function toolCountry(name) {
  const k = String(name || '').trim();
  const hit = COUNTRY_TABLE[k];
  if (!hit) {
    return '内置表里没有「' + k + '」的资料。可在回答里说明暂不掌握，或建议用户改用联网搜索。';
  }
  return k + '：\n首都/中心：' + hit.cap + '\n货币：' + hit.cur +
    '\n语言：' + hit.lang + '\n人口：' + hit.pop + '\n时区：' + hit.tz;
}

/* 统一入口：执行一次工具调用，返回结果文本（永不抛出，失败也返回可读文本） */
async function runToolCall(call) {
  try {
    let out;
    if (call.tool === 'SEARCH') out = await toolSearch(call.arg);
    else if (call.tool === 'WEATHER') out = await toolWeather(call.arg);
    else if (call.tool === 'RATE') out = await toolRate(call.arg);
    else if (call.tool === 'COUNTRY') out = await toolCountry(call.arg);
    else out = '未知工具：' + call.tool;
    return toolResultText(call, true, out);
  } catch (e) {
    return toolResultText(call, false, (e && e.message) ? e.message : String(e));
  }
}

async function askAI() {
  if (sending) return;
  const input = $('input');
  const text = (input.value || '').trim();
  const useImage = editing < 0 ? window.__pendingImage : null;
  // 没文字也没图 → 不发送；只有图没文字 → 允许发送
  if (!text && !useImage) return;

  const key = (LS.get(K_APIKEY) || DEFAULT_APIKEY).trim();
  if (!key) {
    showAlert(T('请先在左侧菜单填入 API Key'));
    return;
  }

  // 校验通过后再建 controller，避免提前 return 时残留
  __abortCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;

  // 【开关归属】本次发送锁定的卡 id —— 整轮回复过程中的「显示思考 / 显示推理过程」
  // 全部以它为判据，且写进消息里。之后即使用户切卡/切会话也不影响本轮。
  const sendPid = curPsyPid();

  const pendingImage = useImage;
  input.value = '';
  autoGrow(input);
  sending = true;
  showTyping(true);
  const sendBtn = $('send');
  if (sendBtn) { sendBtn.disabled = false; sendBtn.dataset.mode = 'stop'; sendBtn.textContent = T('停止'); }
  
  // 入列用户消息（编辑重发则替换）
  const userMsg = { role: 'user', content: text, ts: Date.now(), pid: sendPid };
  if (pendingImage) userMsg.image = pendingImage;
  if (pendingQuote) userMsg.quote = pendingQuote;

  if (editing >= 0) {
    msgList = msgList.slice(0, editing);
    editing = -1;
  }
  msgList.push(userMsg);
  clearPendingImage();
  setQuote(null);          // 引用用完即清
  renderAttachPreview(); // 发送后清掉输入框上方的预览条
  autoTitle(curSid);
  save();
  renderAll();
  const box = $('chat');
  // 让刚发出的用户气泡播一次入场动画（renderAll 之后手动挂，避免整屏历史重播）
  if (box) {
    const all = box.querySelectorAll('.msg');
    if (all.length) animMsgElFlat(all[all.length - 1]);
  }
  // 占位气泡
  const ph = buildMsgEl({ role: 'assistant', content: '', ts: Date.now() }, -1);
  const phBubble = ph.querySelector('.bubble');
  const phMeta = ph.querySelector('.meta');
  if (!phBubble) {
    // 空内容时 buildMsgEl 不生成 bubble，这里手动补
    const b = document.createElement('div');
    b.className = 'bubble';
    b.innerHTML = '&#8203;';
    const bodyEl = ph.querySelector('.msg-body');
    const metaEl = bodyEl ? bodyEl.querySelector('.meta') : null;
    if (bodyEl && metaEl) bodyEl.insertBefore(b, metaEl);
    else if (bodyEl) bodyEl.appendChild(b);
    else ph.appendChild(b);
  } else {
    phBubble.innerHTML = '&#8203;';
  }
  box.appendChild(ph);
  animMsgElFlat(ph);      // AI 占位/流式气泡：纯淡入，不跳
  scrollBottom(true);
  // p45：占位气泡是手动插入的（未走 renderAll），出生时必须自己补一次
  //      气泡磨砂对齐，否则它吃 CSS 兜底(size=cover/pos=center)，
  //      只会显示背景图正中央那一块 → 看着像「颜色和别的不一样」。
  scheduleLayoutBubbleBg();
  const liveBubble = ph.querySelector('.bubble');
  const liveMeta = ph.querySelector('.meta');
  let liveThink = null;      // 流式期间的 Thinking 折叠块
  let thinkText = '';        // 模型思考链原文（Thinking 块只放这个）
  // 把思考链写进 Thinking 块（没有就创建，插到气泡上方）
  const paintThink = () => {
    if (!thinkOn(sendPid)) return;   // 「显示推理过程」关着就不画 Thinking 块
    const txt = stripParensForThink(thinkText).trim();   // 【v3.2】思考链去掉（…）括号内容
    if (!txt) return;
    if (!liveThink) {
      liveThink = buildThinkEl(txt);
      if (liveThink) {
        const bodyEl = ph.querySelector('.msg-body');
        if (bodyEl) bodyEl.insertBefore(liveThink, bodyEl.firstChild);
      }
    } else {
      const bd = liveThink.querySelector('.think-body');
      if (bd) bd.textContent = txt;
    }
  };

  // 【v2.2.1 截断重试】非用户主动停止的异常中断 → 自动重试，最多 1 次
  let __retry = 0;
  const __MAX_RETRY = 1;
  for (;;) {
  try {
    let apiMessages = buildApiMessages(msgList, sendPid);
    /* ---------- 【第 29 轮 · 联网工具】探测轮（静默）
       先用一次空回调的流式调用问模型：如果它想调工具，会只回一个标记；
       此时不渲染、不落库，去调接口，把结果回填成 user 消息，再走下面的正常流式轮。
       仅在第一次尝试（__retry === 0）执行，重试时不再探测，避免重复扣费。 */
    /* 【第 30 轮】联网搜索开关开启 → 强制先搜一次（用户明确要求：开了就一定搜） */
    if (__retry === 0 && String(LS.get(K_WEBON) || '') === '1' &&
        String(LS.get(K_BOCHA) || '').trim() && typeof toolSearch === 'function') {
      let __forced = '';
      try { await showTyping(true); } catch (e) {}
      try { __forced = await toolSearch(text); } catch (e) { __forced = ''; }
      if (__forced) {
        const __fc = { tool: 'SEARCH', arg: text, raw: '[SEARCH: ' + text + ']' };
        const __ft = toolResultText(__fc, true, __forced);
        msgList.push({ role: 'user', content: __fc.raw, ts: Date.now(), pid: sendPid, __toolHidden: true });
        msgList.push({ role: 'user', content: __ft, ts: Date.now(), pid: sendPid, __toolHidden: true });
        apiMessages = buildApiMessages(msgList, sendPid);
        if (!msgList.length || msgList[msgList.length - 1].__toolHidden) msgList.pop();
        if (!msgList.length || msgList[msgList.length - 1].__toolHidden) msgList.pop();
      }
    }

    if (__retry === 0 && typeof parseToolCall === 'function') {
      let probeAcc = '';
      try {
        await streamChat(apiMessages, function (p) { probeAcc = String(p || ''); },
          __abortCtrl ? __abortCtrl.signal : undefined, function () {});
      } catch (e) { probeAcc = ''; }
      const call = parseToolCall(probeAcc);
      if (call) {
        // 显示动作气泡（用户可见「正在联网搜索…」）
        try { showTyping(true); } catch (e) {}
        const rtext = await runToolCall(call);
        // 回填：把模型的工具标记 + 工具结果，作为一条 user 消息塞进本次请求
        msgList.push({ role: 'user', content: call.raw, ts: Date.now(), pid: sendPid, __toolHidden: true });
        msgList.push({ role: 'user', content: rtext, ts: Date.now(), pid: sendPid, __toolHidden: true });
        apiMessages = buildApiMessages(msgList, sendPid);
        // 回填后从内存历史里移除这两条（只影响本次请求，不污染聊天记录）
        if (!msgList.length || msgList[msgList.length - 1].__toolHidden) msgList.pop();
        if (!msgList.length || msgList[msgList.length - 1].__toolHidden) msgList.pop();
      }
    }

    let __lastScroll = 0;
    const acc = await streamChat(apiMessages, async partial => {
      // 气泡照常渲染完整正文（含括号心理描写 → psyRender 出灰斜体）
      // 【硬规则】「显示思考」关着时：先剥掉正在生成中的括号块（含未闭合），
      //           再交 psyRender —— 保证从流式源头到落盘，全程不出现括号内容。
      const livePsyOn = psyOn(sendPid);
      const liveShow = livePsyOn ? partial : stripPsyLive(partial);

      // ---------- 单气泡路径（保持原样） ----------
      if (liveShow == null || String(liveShow).trim() === '') {
        if (!liveBubble.querySelector('.live-dots')) {
          liveBubble.innerHTML = '<span class="live-dots"><i></i><i></i><i></i></span>';
        }
      } else {
        const __d = liveBubble.querySelector('.live-dots');
        if (__d) liveBubble.innerHTML = '';
        liveBubble.innerHTML = psyRender(liveShow, livePsyOn);
      }
      paintThink();
      // 流式期间节流平滑跟随，避免每段字都触发滚动回弹（原来每字一次 scrollBottom，看着就是「一直跳」）
      const now = Date.now();
      if (now - __lastScroll > 220) { __lastScroll = now; scrollBottom(false); }
    }, __abortCtrl ? __abortCtrl.signal : undefined, thinkSoFar => {
      // 思考链增量：首次出现时在气泡上方插入折叠块，之后只更新内容
      thinkText = thinkSoFar;
      paintThink();
      scrollBottom(false);
    });
    const accRes = (acc && typeof acc === 'object') ? acc : { content: String(acc || ''), think: '' };
    // 【v2.2.1 格式兜底】先清洗正文（压重复标点/去装饰空行/统一换行），再走后续括号逻辑
    const accText = cleanText(accRes.content || '');     // 落库正文：保留心理描写
    const accThink = stripParensForThink(accRes.think || '');  // 【v3.2】落库 think：思考链，已剔除括号内容
    // 落库前剥括号（若该卡关着心理描写）
    const finalPsyOn = psyOn(sendPid);
    const finalShow = finalPsyOn ? accText : stripPsyLive(accText);
    // 防空：接口返回空内容时不落库、不留「0 字 · 约 0 tokens」的空气泡
    const accTrim = (accText || '').trim();
    if (!accTrim) {
      ph.remove(); liveMeta.textContent = '';
      renderAll();
      showToast && showToast(T('未收到内容，已忽略这条空回复'));
      return;
    }

    liveMeta.textContent = fmtTime(Date.now(), true) + ' · ' + accText.length + T(' 字');
    // 单条落库：整段回复作为一条 assistant 消息存下（历史永远不拆条）
    msgList.push({ role: 'assistant', content: accText, think: accThink, ts: Date.now(), pid: sendPid });
    save();
    // 屏幕上只有一个占位气泡，直接原地刷成最终内容，不整批重画
    if (liveBubble) liveBubble.innerHTML = psyRender(finalShow, finalPsyOn);
    if (liveMeta) liveMeta.textContent = fmtTime(Date.now(), true) + ' · ' + accText.length + T(' 字');
    scrollBottom(false);
    // p45：流式结束、最终内容落定（气泡高度可能又变了一次），再校正一次对齐
    scheduleLayoutBubbleBg();
    break;   // 【v2.2.1】成功生成，退出重试循环（否则会无限重发）
  } catch (err) {
    const aborted = !!(err && (err.name === 'AbortError' || (err.message && err.message.indexOf('已停止') >= 0)));
    if (aborted) {
      // ---------- 单气泡路径（原逻辑不变） ----------
      const abBubble = liveBubble || ph.querySelector('.bubble');
      const abMeta = liveMeta;
      // 用户主动停止：保留已生成的部分（有内容就把这部分存下来）
      const gotRaw = ((abBubble && abBubble.textContent) || '').replace(/^[……\u200B\s]*$/, '').trim();
      // 【硬规则】关思考时：停止这一刻的残留括号残片再剥一次，避免落库带括号
      const got = psyOn(sendPid) ? gotRaw : stripPsyLive(gotRaw);
      if (got) {
        if (abBubble) abBubble.innerHTML = psyRender(got, psyOn(sendPid));
        const stopThink = thinkText.trim();
        if (thinkOn(sendPid) && stopThink && !liveThink) {
          const tk0 = buildThinkEl(stopThink);
          const bodyEl0 = ph.querySelector('.msg-body');
          if (tk0 && bodyEl0) bodyEl0.insertBefore(tk0, bodyEl0.firstChild);
        }
        if (abMeta) abMeta.textContent = fmtTime(Date.now(), true) + ' · ' + got.length + T(' 字') + T('（已停止）');
        msgList.push({ role: 'assistant', content: got, think: stopThink, ts: Date.now(), pid: sendPid });
        save();
        renderAll();
      } else {
        if (abBubble) abBubble.innerHTML = '<span class="stopped">' + T('已停止生成') + '</span>';
      }
    } else {
      // 【v2.2.1 截断重试】网络/接口异常中断（非用户停止）→ 未超上限就重发一次
      if (__retry < __MAX_RETRY) {
        __retry++;
        // 重置流式残留，准备重来
        thinkText = '';
        if (liveThink) { try { liveThink.remove(); } catch (e) {} liveThink = null; }
        if (liveBubble) liveBubble.innerHTML = '<span class="live-dots"><i></i><i></i><i></i></span>';
        showToast && showToast(T('回复中断，正在重试…'));
        continue;   // 回到 for(;;) 重发
      }
      const erBubble = liveBubble || ph.querySelector('.bubble');
      if (erBubble) erBubble.innerHTML = '<span class="err">' + T('出错：') + esc(err && err.message ? err.message : String(err)) + '</span>';
      save();
    }
    break;   // 成功或已处理完毕，退出重试循环
  } finally {
    __abortCtrl = null;
    sending = false;
    showTyping(false);
    if (sendBtn) { sendBtn.disabled = false; sendBtn.dataset.mode = ''; sendBtn.textContent = T('发送'); }
    // 回复期间用户若已切回列表页 → 给该会话标未读
    const page = $('pageMsg');
    const onList = page && !page.classList.contains('mode-chat');
    if (onList) setUnread(curSid, true);
    renderMsgSessions();
  }
}
}

/* 停止生成：中断当前请求 */
function stopGen() {
  if (__abortCtrl) {
    try { __abortCtrl.abort('user-stop'); } catch (e) {}
  }
}

/* 重新生成：删掉最后一条 assistant，再发一次 */
async function regen() {
  if (sending) return;
  // 找到最后一条 assistant
  let lastAi = -1;
  for (let i = msgList.length - 1; i >= 0; i--) {
    if (msgList[i].role === 'assistant') { lastAi = i; break; }
  }
  if (lastAi < 0) return;

  // 找它前面最近的用户消息
  let lastUser = -1;
  for (let i = lastAi - 1; i >= 0; i--) {
    if (msgList[i].role === 'user') { lastUser = i; break; }
  }
  if (lastUser < 0) return;

  const userMsg = msgList[lastUser];
  const text = userMsg.content;

  // 先备份被删掉的这条回复，万一重发失败还能补回
  const backupAi = msgList[lastAi];

  msgList = msgList.slice(0, lastAi);
  const input = $('input');
  input.value = text;
  autoGrow(input);
  if (userMsg.image) window.__pendingImage = userMsg.image;
  editing = lastUser;
  await askAI();
  // 重发后若末尾没有新回复（被停止或彻底失败），把原来的补回去，避免白删
  const tail = msgList[msgList.length - 1];
  if (!tail || tail.role !== 'assistant' || tail === backupAi) {
    if (backupAi && !msgList.some(m => m === backupAi)) {
      msgList.push(backupAi);
      save();
      renderAll();
    }
  }
}

/* ---------- 长按消息菜单 ---------- */
let menuIdx = -1;

function showMsgMenu(idx) {
  menuIdx = idx;
  const m = $('msgMenu');
  if (!m) return;
  const isUser = msgList[idx] && msgList[idx].role === 'user';
  // 用户消息不显示「重新生成」
  m.querySelectorAll('button').forEach(b => {
    const act = b.getAttribute('data-act');
    if (act === 'regen') b.style.display = isUser ? 'none' : '';
  });

  // 先显示以便量尺寸（visibility 保持隐藏，避免闪一下）
  m.style.visibility = 'hidden';
  m.classList.add('open');

  // 找到被长按的那条消息气泡，把菜单贴到它旁边
  const el = document.querySelector('.msg[data-idx="' + idx + '"]');
  const box = el ? (el.querySelector('.bubble') || el) : null;
  const rect = box ? box.getBoundingClientRect() : null;
  const mw = m.offsetWidth, mh = m.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  const PAD = 8;

  let left, top;
  if (rect) {
    // 横向菜单：默认贴气泡正下方，下方空间不够就翻到正上方（不遮挡气泡）
    const GAP = 8;
    left = rect.left + (rect.width - mw) / 2;   // 水平居中对齐气泡
    top = rect.bottom + GAP;
    if (top + mh > vh - PAD) top = rect.top - mh - GAP;   // 下方放不下 → 改贴上方
  } else {
    left = (vw - mw) / 2;
    top = vh / 3;
  }
  // 左右夹紧（桌面宽度不够时不要溢出屏幕）
  left = Math.min(Math.max(PAD, left), vw - mw - PAD);
  // 上下夹紧（极端情况：上下都放不下时，退化为贴着边缘，但尽量不影响气泡）
  top = Math.min(Math.max(PAD, top), vh - mh - PAD);

  m.style.left = left + 'px';
  m.style.top = top + 'px';
  m.style.visibility = '';
}

function hideMsgMenu() {
  const m = $('msgMenu');
  if (m) m.classList.remove('open');
}

function bindMsgMenu() {
  const m = $('msgMenu');
  if (!m) return;

  m.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      const act = btn.getAttribute('data-act');
      const idx = menuIdx;
      hideMsgMenu();
      if (idx < 0 || !msgList[idx]) return;

      if (act === 'copy') {
        const t = msgList[idx].content || '';
        try {
          await navigator.clipboard.writeText(t);
          showToast(T('已复制'));
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = t; document.body.appendChild(ta); ta.select();
          const ok = document.execCommand('copy'); ta.remove();
          showToast(ok ? T('已复制') : T('复制失败，请长按选择复制'));
        }
      } else if (act === 'quote') {
        const m = msgList[idx];
        const who = (m.role === 'user') ? myDisplayName() : (aiNameForQuote());
        setQuote({ who: who, text: (m.content || '（图片）').replace(/\s+/g, ' ').slice(0, 60) });
      } else if (act === 'del') {
        msgList.splice(idx, 1);
        save();
        renderAll();
      } else if (act === 'regen') {
        regen();
      }
    };
  });

  document.addEventListener('click', e => {
    if (!m.contains(e.target)) hideMsgMenu();
  });
}

/* ---------- 引用回复 ---------- */
let pendingQuote = null;   // { who, text }

/* AI 在引用里显示的名字：会话绑定的卡名，否则当前卡名，否则「AI」 */
function aiNameForQuote() {
  const cur = sessions.find(x => x.id === curSid);
  const bound = (cur && cur.persona && cur.pid) ? getPersonaById(cur.pid) : null;
  if (bound && bound.name) return bound.name;
  const cp = getCurPersona();
  if (cp && cp.name) return cp.name;
  return 'AI';
}

function setQuote(q) {
  pendingQuote = q || null;
  renderQuoteBar();
}

function renderQuoteBar() {
  let bar = $('quoteBar');
  if (!pendingQuote) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'quote-bar';
    bar.id = 'quoteBar';
    const b1 = document.createElement('div');
    b1.className = 'qb-bar';
    const tx = document.createElement('div');
    tx.className = 'qb-text';
    const cls = document.createElement('button');
    cls.className = 'qb-close';
    cls.textContent = '×';
    cls.onclick = () => setQuote(null);
    bar.appendChild(b1);
    bar.appendChild(tx);
    bar.appendChild(cls);
    document.body.appendChild(bar);
  }
  const tx = bar.querySelector('.qb-text');
  tx.innerHTML = '';
  const who = document.createElement('span');
  who.className = 'qb-who';
  who.textContent = (pendingQuote.who || '') + '：';
  tx.appendChild(who);
  tx.appendChild(document.createTextNode(pendingQuote.text || ''));
}

/* ---------- 顶栏右上角「⋯」会话操作菜单 ---------- */
function chatMenuClose() {
  const p = $('chatMenu');
  if (p) p.classList.remove('open');
}
/* 当前会话对应的人设卡 id（无绑定则回退内置卡/第一张卡） */
function curChatPid() {
  const cur = sessions.find(s => s.id === curSid);
  let pid = (cur && cur.persona && cur.pid) ? cur.pid : '';
  if (!pid) {
    const list = getPersonas();
    const fb = list.find(x => x && x.builtin) || list[0];
    if (fb) pid = fb.id;
  }
  return pid;
}
function bindChatMore() {
  const btn = $('chatMore');
  const panel = $('chatMenu');
  if (!btn || !panel) return;
  btn.onclick = e => {
    e.stopPropagation();
    if (typeof closeStancePop === 'function') closeStancePop();
    panel.classList.toggle('open');
  };
  // 顶栏「详细资料」：点头像打开当前联系人的人设卡详情页
  const infoBtn = $('chatInfo');
  if (infoBtn) {
    infoBtn.onclick = e => {
      e.stopPropagation();
      const pid = curChatPid();
      if (!pid) { showAlert(T('这个会话还没有绑定人设卡。')); return; }
      openPersonaPage(pid);
    };
  }

  // 点面板外部关闭
  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && e.target !== btn) chatMenuClose();
  });

  panel.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const act = b.getAttribute('data-cact');
      chatMenuClose();
      const cur = sessions.find(s => s.id === curSid);
      if (!cur) return;

      if (act === 'rename') {
        askInput(T('重命名会话'), cur.title || T('新对话'), v => {
          const nv = (v || '').trim() || '新对话';
          if (nv !== cur.title) {
            if (!cur.alias) cur.alias = cur.title || '';
            cur.title = nv;
          } else if (cur.alias === cur.title) {
            cur.alias = '';
          }
          persist();
          const ne = $('chatName');
          if (ne) ne.textContent = cur.title;
          renderMsgSessions();
          renderSessions();
        });

      } else if (act === 'regen') {
        regen();

      } else if (act === 'find') {
        openChatFind();

      } else if (act === 'bg') {
        openChatBg();

      } else if (act === 'copy') {
        let last = '';
        for (let i = msgList.length - 1; i >= 0; i--) {
          if (msgList[i].role === 'assistant' && msgList[i].content) { last = msgList[i].content; break; }
        }
        if (!last) { showAlert(T('还没有 AI 回复可以复制。'), T('复制'), 'ℹ️'); return; }
        copyText(last).then(function(ok){ showToast(ok ? T('已复制 AI 回复') : T('复制失败，请长按选择复制')); });

      } else if (act === 'export') {
        exportSession(cur);

      } else if (act === 'clear') {
        askConfirm(T('清空这个会话的全部消息？会话本身会保留。'), T('清空会话'), () => {
          msgList = [];
          cur.msgs = [];
          save();
          renderAll();
          renderMsgSessions();
        });

      } else if (act === 'del') {
        askConfirm(T('删除这个会话？删了找不回来。'), T('删除会话'), () => {
          sessions = sessions.filter(x => x.id !== cur.id);
          if (!sessions.length) {
            curSid = '';
            msgList = [];
          } else if (curSid === cur.id) {
            curSid = sessions[0].id;
            msgList = (sessions.find(x => x.id === curSid) || {}).msgs || [];
          }
          save();
          msgMode('list');
          renderMsgSessions();
          renderSessions();
          renderAll();
        });
      }
    };
  });
}

/* ==================== v6: 会话内搜索高亮 ==================== */
let cfQuery = '';      // 当前会话内搜索关键词
let cfHits = [];       // 命中消息的索引数组
let cfCur = -1;        // 当前定位到第几个命中（cfHits 下标）

/* 打开会话内搜索条 */
function openChatFind() {
  const bar = $('chatFind');
  if (!bar) return;
  bar.classList.add('open');
  msgMode('chat');
  const inp = $('chatFindInput');
  if (inp) {
    inp.value = cfQuery || '';
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
  }
  if (!cfQuery) {
    cfHits = []; cfCur = -1;
    renderChatFind();
  } else {
    doChatFind(cfQuery, false);
  }
}

/* 关闭会话内搜索条 + 清除高亮 */
function closeChatFind() {
  const bar = $('chatFind');
  if (bar) bar.classList.remove('open');
  cfHits = []; cfCur = -1;
  renderChatFind();
  renderAll();
}

/* 执行搜索：收集命中消息索引并重绘高亮 */
function doChatFind(q, keepPos) {
  cfQuery = String(q || '').trim();
  cfHits = [];
  cfCur = -1;
  const kw = cfQuery.toLowerCase();
  if (kw) {
    msgList.forEach((m, i) => {
      if ((m.content || '').toLowerCase().indexOf(kw) >= 0) cfHits.push(i);
    });
    if (cfHits.length) cfCur = keepPos ? Math.min(cfCur, cfHits.length - 1) : 0;
    if (cfCur < 0) cfCur = cfHits.length ? 0 : -1;
  }
  renderChatFind();
  renderAll();
  if (cfCur >= 0) scrollToHit(cfCur, true);
}

/* 更新计数文字 */
function renderChatFind() {
  const c = $('chatFindCount');
  if (!c) return;
  if (!cfQuery) { c.textContent = ''; return; }
  c.textContent = cfHits.length ? ('第 ' + (cfCur + 1) + ' / ' + cfHits.length + ' 条') : '无匹配';
}

/* 滚动定位到第 n 个命中，并把它标为当前命中 */
function scrollToHit(n, doScroll) {
  const idx = cfHits[n];
  if (idx === undefined) return;
  const box = $('chat');
  if (!box) return;
  box.querySelectorAll('.msg.msg-hit').forEach(el => el.classList.remove('hl-cur-box'));
  box.querySelectorAll('.hl.hl-cur').forEach(el => el.classList.remove('hl-cur'));
  const el = box.querySelector('.msg[data-idx="' + idx + '"]');
  if (!el) return;
  el.classList.add('hl-cur-box');
  const marks = el.querySelectorAll('.hl');
  if (marks.length) {
    marks[marks.length - 1].classList.add('hl-cur');
    marks[0].classList.add('hl-cur');
  }
  if (doScroll) {
    try {
      const top = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } catch (e) { el.scrollIntoView({ block: 'center' }); }
  }
}

/* 绑定搜索条交互 */
function bindChatFind() {
  const inp = $('chatFindInput');
  const prev = $('chatFindPrev');
  const next = $('chatFindNext');
  const close = $('chatFindClose');
  if (inp) {
    let timer = null;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => doChatFind(inp.value, false), 180);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); stepChatFind(e.shiftKey ? -1 : 1); }
    });
  }
  if (prev) prev.addEventListener('click', () => stepChatFind(-1));
  if (next) next.addEventListener('click', () => stepChatFind(1));
  if (close) close.addEventListener('click', closeChatFind);
}

/* 上一个 / 下一个命中 */
function stepChatFind(delta) {
  if (!cfHits.length) return;
  cfCur = (cfCur + delta + cfHits.length) % cfHits.length;
  renderChatFind();
  scrollToHit(cfCur, true);
}

/* 把一段纯文本按关键词切成带高亮的 HTML（转义安全） */
function hlText(text, q) {
  const s = String(text == null ? '' : text);
  if (!q) return esc(s);
  const low = s.toLowerCase();
  const kw = q.toLowerCase();
  let out = '', from = 0, p;
  while ((p = low.indexOf(kw, from)) >= 0) {
    out += esc(s.slice(from, p));
    out += '<span class="hl">' + esc(s.slice(p, p + kw.length)) + '</span>';
    from = p + kw.length;
    if (kw.length === 0) break;
  }
  out += esc(s.slice(from));
  return out;
}

/* 在已渲染的 DOM 里给文本节点套高亮（跳过 code/pre，避免破坏代码块） */
function hlInNode(root, q) {
  if (!root || !q) return;
  const kw = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.toLowerCase().indexOf(kw) < 0) return NodeFilter.FILTER_REJECT;
      let p = n.parentNode;
      while (p && p !== root) {
        const tag = p.nodeName;
        if (tag === 'CODE' || tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (p.classList && p.classList.contains('hl')) return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const targets = [];
  let node;
  while ((node = walker.nextNode())) targets.push(node);

  targets.forEach(tn => {
    const s = tn.nodeValue;
    const low = s.toLowerCase();
    const frag = document.createDocumentFragment();
    let from = 0, p;
    while ((p = low.indexOf(kw, from)) >= 0) {
      if (p > from) frag.appendChild(document.createTextNode(s.slice(from, p)));
      const span = document.createElement('span');
      span.className = 'hl';
      span.textContent = s.slice(p, p + kw.length);
      frag.appendChild(span);
      from = p + kw.length;
    }
    if (from < s.length) frag.appendChild(document.createTextNode(s.slice(from)));
    if (tn.parentNode) tn.parentNode.replaceChild(frag, tn);
  });
}

/* 导出单个会话为 JSON 文件 */
function exportSession(s) {
  const nm = String((s && s.title) || '会话').slice(0, 18);
  askConfirm(
    '将把会话「' + nm + '」导出为 JSON 文件。\n确认后系统会弹出保存框，选择保存位置即可。',
    '导出会话',
    function () { doExportSession(s); }
  );
}

function doExportSession(s) {
  try {
    const data = {
      app: '像素蜘蛛',
      kind: 'single-session',
      exportedAt: new Date().toISOString(),
      session: s
    };
    const text = JSON.stringify(data, null, 2);
    const safe = String(s.title || "会话").replace(/[\\/:*?"<>|]/g, "_").slice(0, 24);
    const fn = '像素蜘蛛_' + safe + '_' + Date.now() + '.json';
    showExportPanel(fn, text);
  } catch (e) {
    showAlert(T('导出失败：') + (e && e.message ? e.message : e), T('导出'), '⚠️');
  }
}

/* ---------- 滚动到底部按钮 ---------- */
function bindBackTop() {
  const box = $('chat');
  const btn = $('backTop');
  if (!box || !btn) return;

  const NEAR = 60;   // 距底部小于该像素视为「已在底部」

  const upd = () => {
    const gap = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (gap > NEAR) btn.classList.add('show');
    else btn.classList.remove('show');
  };

  box.addEventListener('scroll', upd, { passive: true });
  window.addEventListener('resize', upd);
  // p44 → 方案②：背景图与内容同速滚动，气泡相对背景【恒定】，
  // 故滚动时【不再重算】—— 这正是消除顿挫的关键。
  // 仅在窗口尺寸变化（内容坐标系数值变了）时才重算。
  window.addEventListener('resize', scheduleLayoutBubbleBg);
  btn.onclick = () => {
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  };

  // 供 renderAll 等调用后刷新按钮状态
  window.__updBackTop = upd;
  upd();
  scheduleLayoutBubbleBg();   // p43：首次进入也算一遍
}
/* ---------- 输入 ---------- */
function autoGrow(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  const MAX = 140;                 // 上限：约 6 行，超过就内部滚动
  const LINE = 40;                 // 单行总高：20 文字行 + 10 上 padding + 10 下 padding
  // 先归零再量（border-box 下高度含 padding，故量出来已含 20）
  el.style.height = 'auto';
  const need = el.scrollHeight;
  // 单行：固定 LINE，避开 WebView 行高取整导致文字偏移
  const single = need <= LINE + 2;
  const h = single ? LINE : Math.min(need, MAX);
  el.style.height = h + 'px';
  el.style.overflowY = (!single && need > MAX) ? 'auto' : 'hidden';
}

function bindInput() {
  const input = $('input');
  const send = $('send');
  if (send) send.onclick = () => {
    if (sending) { stopGen(); return; }   // 生成中 → 点一下停止
    askAI();
  };

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askAI();
      }
    });
    input.addEventListener('input', () => autoGrow(input));
    autoGrow(input);
  }


  // 传图
  const imgBtn = $('imgBtn');
  const fileInput = $('fileInput');
  if (imgBtn && fileInput) {
    imgBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        // 先压缩再存：480px / JPEG 0.7，几 MB 的截图降到几十 KB
        compressImage(reader.result, 480, 0.7).then(compressed => {
          window.__pendingImage = compressed;
          renderAttachPreview();
        });
      };
      reader.readAsDataURL(f);
      fileInput.value = '';
    };
  }
}

/* 压缩图片：最长边 480px、JPEG 0.7，把 2-5MB 的截图压到几十 KB，
   这样存 localStorage 才放得下，旧图也能保留可看。 */
function compressImage(dataUrl, maxSide, quality) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const g = cv.getContext('2d');
      // 白底填充：JPEG 不支持透明，不铺白底的话透明区会变黑
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      try {
        resolve(cv.toDataURL('image/jpeg', quality));
      } catch (e) {
        resolve(dataUrl); // 压缩失败就退回原图
      }
    };
    img.onerror = () => resolve(dataUrl); // 图加载失败也退回原图
    img.src = dataUrl;
  });
}

/* 头像专用：读文件 → 居中裁成正方形 → 缩到 256px → JPEG 0.82
   这样一张头像约 10KB，不会撑爆 localStorage 5MB */
function shrinkImage(file, maxSide) {
  const side = maxSide || 256;
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => resolve('');
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve('');
      img.onload = () => {
        const w0 = img.width, h0 = img.height;
        const s = Math.min(w0, h0);                 // 取短边
        const sx = (w0 - s) / 2, sy = (h0 - s) / 2; // 居中
        const out = Math.min(side, s);
        const cv = document.createElement('canvas');
        cv.width = out;
        cv.height = out;
        const g = cv.getContext('2d');
        g.fillStyle = '#fff';                      // JPEG 无透明，铺白底
        g.fillRect(0, 0, out, out);
        g.drawImage(img, sx, sy, s, s, 0, 0, out, out);
        try {
          resolve(cv.toDataURL('image/jpeg', 0.82));
        } catch (e) {
          resolve('');
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* 头像裁剪器：选图后弹出浮层，拖动/缩放框选，确定后裁成方形 JPEG
   用法：cropImage(file, base64 => {...})，取消时回调收到 '' */
function cropImage(file, cb) {
  const reader = new FileReader();
  reader.onerror = () => cb('');
  reader.onload = () => {
    const src = reader.result;
    const raw = new Image();
    raw.onerror = () => cb('');
    raw.onload = () => {
      // ---- 浮层 ----
      const mask = document.createElement('div');
      mask.className = 'crop-mask';
      const panel = document.createElement('div');
      panel.className = 'crop-panel';

      const stage = document.createElement('div');
      stage.className = 'crop-stage';

      const frame = document.createElement('div');
      frame.className = 'crop-frame';

      const pic = document.createElement('img');
      pic.className = 'crop-img';
      pic.src = src;

      stage.appendChild(pic);
      stage.appendChild(frame);

      const tip = document.createElement('div');
      tip.className = 'crop-tip';
      tip.textContent = T('拖动图片调整位置，滑杆缩放');

      const zoom = document.createElement('input');
      zoom.type = 'range';
      zoom.min = '100';
      zoom.max = '300';
      zoom.value = '100';
      zoom.className = 'crop-zoom';

      const btns = document.createElement('div');
      btns.className = 'crop-btns';
      const cancel = document.createElement('button');
      cancel.className = 'crop-btn crop-cancel';
      cancel.textContent = T('取消');
      const ok = document.createElement('button');
      ok.className = 'crop-btn crop-ok';
      ok.textContent = T('确定');
      btns.appendChild(cancel);
      btns.appendChild(ok);

      panel.appendChild(stage);
      panel.appendChild(tip);
      panel.appendChild(zoom);
      panel.appendChild(btns);
      mask.appendChild(panel);
      document.body.appendChild(mask);

      // ---- 几何：显示区为正方形，同时受视口宽、高约束，保证浮层完整可见 ----
      // 面板其它部分约占：padding16*2 + 提示30 + 滑块34 + 按钮40 + 间距 ≈ 154
      const availH = window.innerHeight - 154;
      const SIZE = Math.max(160, Math.min(window.innerWidth - 64, availH, 320));
      stage.style.width = SIZE + 'px';
      stage.style.height = SIZE + 'px';

      // 图片铺满显示区时的「基准尺寸」（cover：短边贴合，保证框内无空白）
      const baseScale = Math.max(SIZE / raw.width, SIZE / raw.height);
      let scale = baseScale;      // 当前实际缩放
      let ox = 0, oy = 0;         // 当前位移（相对居中）

      function layout() {
        const w = raw.width * scale;
        const h = raw.height * scale;
        // 限制：图片必须盖满显示区
        const minOx = SIZE - w, maxOx = 0;
        const minOy = SIZE - h, maxOy = 0;
        ox = Math.min(maxOx, Math.max(minOx, ox));
        oy = Math.min(maxOy, Math.max(minOy, oy));
        pic.style.width = w + 'px';
        pic.style.height = h + 'px';
        pic.style.left = ox + 'px';
        pic.style.top = oy + 'px';
      }
      // 初始居中
      ox = (SIZE - raw.width * scale) / 2;
      oy = (SIZE - raw.height * scale) / 2;
      layout();

      // ---- 拖动 ----
      let dragging = false, sx = 0, sy = 0, sox = 0, soy = 0;
      const onDown = e => {
        dragging = true;
        const p = e.touches ? e.touches[0] : e;
        sx = p.clientX; sy = p.clientY; sox = ox; soy = oy;
        e.preventDefault();
      };
      const onMove = e => {
        if (!dragging) return;
        const p = e.touches ? e.touches[0] : e;
        ox = sox + (p.clientX - sx);
        oy = soy + (p.clientY - sy);
        layout();
        e.preventDefault();
      };
      const onUp = () => { dragging = false; };
      stage.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      stage.addEventListener('touchstart', onDown, { passive: false });
      stage.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);

      // ---- 缩放（以显示区中心为锚点）----
      zoom.addEventListener('input', () => {
        const k = parseInt(zoom.value, 10) / 100;
        const cx = SIZE / 2, cy = SIZE / 2;
        const ix = (cx - ox) / scale;   // 中心对应的原图坐标
        const iy = (cy - oy) / scale;
        scale = baseScale * k;
        ox = cx - ix * scale;
        oy = cy - iy * scale;
        layout();
      });

      // ---- 收尾清理 ----
      function cleanup() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        if (mask.parentNode) mask.parentNode.removeChild(mask);
      }

      cancel.onclick = () => { cleanup(); cb(''); };
      ok.onclick = () => {
        // 反推：显示区(0,0)-(SIZE,SIZE) 对应的原图区域
        const sw = SIZE / scale;
        const sh = SIZE / scale;
        const sxp = -ox / scale;
        const syp = -oy / scale;
        const OUT = 256;
        const cv = document.createElement('canvas');
        cv.width = OUT;
        cv.height = OUT;
        const g = cv.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, OUT, OUT);
        g.drawImage(raw, sxp, syp, sw, sh, 0, 0, OUT, OUT);
        let out = '';
        try { out = cv.toDataURL('image/jpeg', 0.82); } catch (e) { out = ''; }
        cleanup();
        cb(out);
      };
    };
    raw.src = src;
  };
  reader.readAsDataURL(file);
}

/* 背景专用裁剪器（第27轮）：与头像裁剪器同套路，但按 3:4 竖构图裁，
   用法：bgCropImage(file, base64 => {...})，取消时回调收到 ''。
   不共用 cropImage 的类名/CSS，避免回归头像功能。 */
function bgCropImage(file, cb) {
  const AR = 3 / 4;   // 宽/高 = 3:4 竖构图
  const reader = new FileReader();
  reader.onerror = () => cb('');
  reader.onload = () => {
    const src = reader.result;
    const raw = new Image();
    raw.onerror = () => cb('');
    raw.onload = () => {
      // ---- 浮层 ----
      const mask = document.createElement('div');
      mask.className = 'bcrop-mask';
      const panel = document.createElement('div');
      panel.className = 'bcrop-panel';

      const title = document.createElement('div');
      title.className = 'bcrop-title';
      title.textContent = T('裁剪背景图');

      const sub = document.createElement('div');
      sub.className = 'bcrop-sub';
      sub.textContent = T('拖动调整位置，滑杆缩放');

      const stage = document.createElement('div');
      stage.className = 'bcrop-stage';

      const pic = document.createElement('img');
      pic.className = 'bcrop-img';
      pic.src = src;

      const frame = document.createElement('div');
      frame.className = 'bcrop-frame';

      stage.appendChild(pic);
      stage.appendChild(frame);

      const zoomWrap = document.createElement('div');
      zoomWrap.className = 'bcrop-zoom';
      const z1 = document.createElement('span');
      z1.textContent = '−';
      const zoom = document.createElement('input');
      zoom.type = 'range';
      zoom.min = '100';
      zoom.max = '300';
      zoom.value = '100';
      const z2 = document.createElement('span');
      z2.textContent = '+';
      zoomWrap.appendChild(z1);
      zoomWrap.appendChild(zoom);
      zoomWrap.appendChild(z2);
      /* 第 28 轮：清晰/模糊拉条（真 blur，默认 0 = 不模糊） */
      let blurVal = 0;
      const blurWrap = document.createElement('div');
      blurWrap.className = 'bcrop-zoom';
      const b1 = document.createElement('span');
      b1.textContent = T('清晰');
      const blur = document.createElement('input');
      blur.type = 'range';
      blur.min = '0';
      blur.max = '30';
      blur.value = '0';
      const b2 = document.createElement('span');
      b2.textContent = T('模糊');
      blurWrap.appendChild(b1);
      blurWrap.appendChild(blur);
      blurWrap.appendChild(b2);
      /* 实时预览：只模糊裁剪框里的图，不影响布局 */
      blur.oninput = () => {
        blurVal = parseInt(blur.value, 10) || 0;
        try { pic.style.filter = blurVal ? ('blur(' + blurVal + 'px)') : ''; } catch (e) {}
      };

      const btns = document.createElement('div');
      btns.className = 'bcrop-btns';
      const cancel = document.createElement('button');
      cancel.className = 'bcrop-btn';
      cancel.textContent = T('取消');
      const ok = document.createElement('button');
      ok.className = 'bcrop-btn bcrop-ok';
      ok.textContent = T('确定');
      btns.appendChild(cancel);
      btns.appendChild(ok);

      panel.appendChild(title);
      panel.appendChild(sub);
      panel.appendChild(stage);
      panel.appendChild(zoomWrap);
      panel.appendChild(blurWrap);
      panel.appendChild(btns);
      mask.appendChild(panel);
      document.body.appendChild(mask);
      requestAnimationFrame(() => mask.classList.add('open'));

      // ---- 几何：显示区 W×H（3:4），受视口宽、高约束 ----
      // 面板其它部分约占：padding18*2 + 标题22 + 副标题30 + 滑块34 + 按钮44 + 间距 ≈ 190
      const availH = window.innerHeight - 234;   // 第 28 轮：为新增的「清晰/模糊」行多留 ~44px
      const availW = window.innerWidth - 72;
      let H = Math.min(availH, 380);
      let W = H * AR;
      if (W > availW) { W = availW; H = W / AR; }
      H = Math.max(160, H);
      W = H * AR;
      stage.style.width = W + 'px';
      stage.style.height = H + 'px';
      const SW = W, SH = H;

      // 图片铺满显示区时的基准缩放（cover）
      const baseScale = Math.max(SW / raw.width, SH / raw.height);
      let scale = baseScale;
      let ox = 0, oy = 0;

      function layout() {
        const w = raw.width * scale;
        const h = raw.height * scale;
        const minOx = SW - w, maxOx = 0;
        const minOy = SH - h, maxOy = 0;
        ox = Math.min(maxOx, Math.max(minOx, ox));
        oy = Math.min(maxOy, Math.max(minOy, oy));
        pic.style.width = w + 'px';
        pic.style.height = h + 'px';
        pic.style.left = ox + 'px';
        pic.style.top = oy + 'px';
      }
      ox = (SW - raw.width * scale) / 2;
      oy = (SH - raw.height * scale) / 2;
      layout();

      // ---- 拖动 ----
      let dragging = false, sx = 0, sy = 0, sox = 0, soy = 0;
      const onDown = e => {
        dragging = true;
        const p = e.touches ? e.touches[0] : e;
        sx = p.clientX; sy = p.clientY; sox = ox; soy = oy;
        e.preventDefault();
      };
      const onMove = e => {
        if (!dragging) return;
        const p = e.touches ? e.touches[0] : e;
        ox = sox + (p.clientX - sx);
        oy = soy + (p.clientY - sy);
        layout();
        e.preventDefault();
      };
      const onUp = () => { dragging = false; };
      stage.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      stage.addEventListener('touchstart', onDown, { passive: false });
      stage.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);

      // ---- 缩放（以显示区中心为锚点）----
      zoom.addEventListener('input', () => {
        const k = parseInt(zoom.value, 10) / 100;
        const cx = SW / 2, cy = SH / 2;
        const ix = (cx - ox) / scale;
        const iy = (cy - oy) / scale;
        scale = baseScale * k;
        ox = cx - ix * scale;
        oy = cy - iy * scale;
        layout();
      });

      function cleanup() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        if (mask.parentNode) mask.parentNode.removeChild(mask);
      }

      cancel.onclick = () => { cleanup(); cb(''); };
      ok.onclick = () => {
        // 显示区(0,0)-(SW,SH) 对应的原图区域
        const sw = SW / scale;
        const sh = SH / scale;
        const sxp = -ox / scale;
        const syp = -oy / scale;
        // 输出：宽高上限 1440，保持 3:4
        const OUTW = 1080;
        const OUTH = 1440;
        const cv = document.createElement('canvas');
        cv.width = OUTW;
        cv.height = OUTH;
        const g = cv.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, OUTW, OUTH);
        g.drawImage(raw, sxp, syp, sw, sh, 0, 0, OUTW, OUTH);
        let out = '';
        try { out = cv.toDataURL('image/jpeg', 0.82); } catch (e) { out = ''; }
        cleanup();
        /* 第 28 轮：把模糊值编进返回值（形如  图片|blur:8 ），空图/0 则不编 */
        if (out && blurVal) out = out + '|blur:' + blurVal;
        cb(out);
      };
    };
    raw.src = src;
  };
  reader.readAsDataURL(file);
}

/* 第 28 轮：拆开裁剪器返回值（图片 + 可选 blur 值） */
function bgCropSplit(v) {
  let src = v || '', blur = 0;
  const i = src.lastIndexOf('|blur:');
  if (i >= 0) {
    const n = parseFloat(src.slice(i + 6));
    if (!isNaN(n)) blur = Math.max(0, Math.min(30, Math.round(n)));
    src = src.slice(0, i);
  }
  return { src: src, blur: blur };
}
/* 压平已有 base64（避免图片过大占 localStorage）：长边压到 maxSide */
function shrinkDataUrl(dataUrl, maxSide) {
  const side = maxSide || 1440;
  return new Promise(resolve => {
    const img = new Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      const w0 = img.width, h0 = img.height;
      const k = Math.min(1, side / Math.max(w0, h0));
      if (k >= 1) { resolve(dataUrl); return; }
      const w = Math.max(1, Math.round(w0 * k));
      const h = Math.max(1, Math.round(h0 * k));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      try { resolve(cv.toDataURL('image/jpeg', 0.82)); }
      catch (e) { resolve(dataUrl); }
    };
    img.src = dataUrl;
  });
}

/* 全局是否显示头像（默认开） */
function showAvatarOn() {
  const p = getProfile();
  return p.showAvatar === undefined ? true : !!p.showAvatar;
}

/* 「我」的头像 */
function myAvatar() {
  return getProfile().avatar || '';
}

/* AI 的头像：优先当前会话绑定的卡 → 全局当前卡 */
function aiAvatar() {
  const cur = sessions.find(x => x.id === curSid);
  const bound = (cur && cur.persona && cur.pid) ? getPersonaById(cur.pid) : null;
  const c = bound || getCurPersona();
  return (c && c.avatar) || '';
}

/* 某个会话对应的 AI 头像：绑卡用卡头像，否则用当前卡头像 */
function sessAvatar(s) {
  const bound = (s && s.persona && s.pid) ? getPersonaById(s.pid) : null;
  const c = bound || getCurPersona();
  return (c && c.avatar) || '';
}
function renderAttachPreview() {
  let bar = $('attachPreview');
  const img = window.__pendingImage;
  if (!img) {
    if (bar) bar.remove();
    // 没有待发送图：去掉标记，聊天内容区恢复原高度
    document.body.classList.remove('has-attach');
    return;
  }
  // 有待发送图：给 body 打标记，让聊天内容区往上让出预览条的高度，避免被挡
  document.body.classList.add('has-attach');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'attach-preview';
    bar.id = 'attachPreview';
    // 直接挂到 body（fixed 定位，靠 CSS 贴住输入框上方），
    // 绝不能插到 header 旁边，否则会跑到左上角
    document.body.appendChild(bar);
  }
  bar.innerHTML = '';
  const thumb = document.createElement('div');
  thumb.className = 'attach-thumb';
  const im = document.createElement('img');
  im.src = img;
  const rm = document.createElement('button');
  rm.className = 'attach-rm';
  rm.textContent = '×';
  rm.onclick = () => { clearPendingImage(); renderAttachPreview(); };
  thumb.appendChild(im);
  thumb.appendChild(rm);
  bar.appendChild(thumb);
}

function clearPendingImage() {
  window.__pendingImage = null;
}

/* ---------- 底部 Tab 切换 ---------- */
const TABS = ['msg', 'contacts', 'moments', 'me'];

/* ================= 切 tab 滑动过渡（小说平移翻页） =================
   旧页整体滑出屏外，新页从另一侧同步滑入。
   用 transition + 显式 transform（不用 animation，避免 fill-mode:both 卡屏）。
   关键：全局动画锁 —— 快速连切时，先把上一次动画"强制终结"干净再开新的，
        否则两次动画会互相踩 class/inline style，导致页面卡死＝白屏。 */
let _tabAnimTimer = null;
let _tabAnimCleanup = null;

/* 无条件终结当前动画：清定时器、执行清理、清掉所有页的滑动痕迹 */
function _killTabAnim() {
  if (_tabAnimTimer) { clearTimeout(_tabAnimTimer); _tabAnimTimer = null; }
  if (typeof _tabAnimCleanup === 'function') {
    try { _tabAnimCleanup(); } catch (e) { /* 忽略 */ }
    _tabAnimCleanup = null;
  }
  document.querySelectorAll('.tab-page').forEach(p => {
    p.classList.remove('tab-sliding', 'tab-slide-in', 'tab-slide-out');
    p.style.transform = '';
    p.style.transition = '';
    p.style.visibility = '';
  });
  document.body.classList.remove('tab-anim');
}

function switchTab(name) {
  if (TABS.indexOf(name) < 0) name = 'msg';
  /* ---- 切页滑动过渡：像小说平移翻页，旧页滑出、新页同步滑入 ---- */
  const prevName = document.body.getAttribute('data-tab') || 'msg';
  const dir = TABS.indexOf(name) >= TABS.indexOf(prevName) ? 1 : -1;  // 1=向右切，-1=向左切
  const prevPage = $('page' + prevName.charAt(0).toUpperCase() + prevName.slice(1));
  const page = $('page' + name.charAt(0).toUpperCase() + name.slice(1));
  const animate = (page && prevPage && prevPage !== page);
  // 底部 tab 按钮高亮
  document.querySelectorAll('.tab-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === name);
  });
  /* ★ 先强制终结上一次可能还在跑的动画，杜绝竞态 */
  _killTabAnim();
  if (animate) {
    document.body.classList.add('tab-anim');   // 动画期裁剪，配合旧页隐藏
    // 新页：先无过渡地放到屏外那一侧，然后挂上 active（display 生效）
    const inFrom = dir > 0 ? '100%' : '-100%';
    page.classList.add('tab-slide-in');
    page.style.transition = 'none';
    page.style.transform = 'translateX(' + inFrom + ')';
    page.classList.add('active');
    // 旧页保持 active 参与滑出
    const outTo = dir > 0 ? '-100%' : '100%';
    prevPage.classList.add('tab-slide-out');
    // 强制重排，让上面的初始位置先落地
    void page.offsetWidth;
    // 打开过渡，两页同时开始平移
    page.classList.add('tab-sliding');
    prevPage.classList.add('tab-sliding');
    page.style.transition = '';
    prevPage.style.transition = '';
    page.style.transform = 'translateX(0)';
    prevPage.style.transform = 'translateX(' + outTo + ')';
    // 本次动画的专属清理（只清这两页），并登记为全局 cleanup
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      page.classList.remove('tab-sliding', 'tab-slide-in', 'tab-slide-out');
      page.style.transition = '';
      page.style.transform = '';
      prevPage.classList.remove('tab-sliding', 'tab-slide-in', 'tab-slide-out');
      prevPage.style.transition = '';
      prevPage.style.transform = '';
      prevPage.style.visibility = '';
      // 只有确认「当前页就是新页」时才摘旧页的 active，避免打断后续切换
      if (document.body.getAttribute('data-tab') === name) {
        prevPage.classList.remove('active');
        document.body.classList.remove('tab-anim');
      }
      page.removeEventListener('transitionend', onEnd);
      prevPage.removeEventListener('transitionend', onEnd);
      if (_tabAnimCleanup === cleanup) _tabAnimCleanup = null;
      if (_tabAnimTimer) { clearTimeout(_tabAnimTimer); _tabAnimTimer = null; }
    };
    const onEnd = (e) => { if (e.propertyName === 'transform') cleanup(); };
    page.addEventListener('transitionend', onEnd);
    prevPage.addEventListener('transitionend', onEnd);
    _tabAnimCleanup = cleanup;
    _tabAnimTimer = setTimeout(cleanup, 420);    // 兜底，防 transitionend 不触发
    // 先登记 data-tab，让 cleanup 里的判定能正确识别"当前页"
    document.body.setAttribute('data-tab', name);
  } else {
    // 不播动画（同名/首次）：直接瞬切
    document.querySelectorAll('.tab-page').forEach(p => {
      if (p !== page) p.classList.remove('active');
    });
    if (page && !page.classList.contains('active')) page.classList.add('active');
    document.body.setAttribute('data-tab', name);
  }
  if (name === 'moments') renderMoments();
  if (name === 'contacts') renderSessions();
  if (name === 'me') { refreshProfileSub(); bindMeAccordion(); }
  // 消息 tab 默认回到「会话列表」态
  if (name === 'msg') {
    closeAllSessSwipe();
    renderMsgSessions();
    msgMode('list');
  }
}

/* 消息页两种形态：list（会话列表）/ chat（正在聊天） */
function msgMode(mode) {
  const page = $('pageMsg');
  if (!page) return;
  const nameEl = $('chatName');
  const backEl = $('chatBack');
  if (mode === 'chat') {
    page.classList.add('mode-chat');
    page.classList.remove('mode-list');
    document.body.classList.add('msg-chat');
    // 聊天态：显示返回键 + 顶部显示当前联系人名（只读，不可编辑）
    if (backEl) backEl.style.display = '';
    if (typeof syncStanceUI === 'function') syncStanceUI();
    if (nameEl) {
      nameEl.setAttribute('contenteditable', 'false');
      nameEl.classList.remove('fixed-title');
      const cur = sessions.find(s => s.id === curSid);
      nameEl.textContent = (cur && cur.title) ? cur.title : T('新对话');
    }
  } else {
    page.classList.add('mode-list');
    page.classList.remove('mode-chat');
    document.body.classList.remove('msg-chat');
    // 列表态：隐藏返回键 + 固定标题「消息」，禁止编辑
    if (backEl) backEl.style.display = 'none';
    if (typeof closeStancePop === 'function') closeStancePop();
    if (nameEl) {
      nameEl.setAttribute('contenteditable', 'false');
      nameEl.classList.add('fixed-title');
      nameEl.textContent = T('消息');
    }
    // A方案：返回会话列表时，清掉待发送的图并移除预览条（预览条挂在 body 上，是 fixed 定位，不会随页面切换消失）
    if (typeof clearPendingImage === 'function') clearPendingImage();
    if (typeof renderAttachPreview === 'function') renderAttachPreview();
    // 返回会话列表时，关闭会话内搜索条（它挂在 body 上，fixed 定位，不会随页面切换消失）
    var cfBar = $('chatFind');
    if (cfBar) cfBar.classList.remove('open');
    cfQuery = ''; cfHits = []; cfCur = -1;
    if (typeof renderChatFind === 'function') renderChatFind();
    if (typeof renderAll === 'function') renderAll();
  }
}

/* 标题渲染：备注优先，角色原名用灰色小字括号跟在后面（参考微信/QQ） */
function fillTitle(el, s) {
  el.textContent = '';
  const title = (s && s.title) ? s.title : T('新对话');
  const alias = (s && s.alias) ? String(s.alias).trim() : '';
  el.appendChild(document.createTextNode(title));
  // 只有「改过备注、且原名与备注不同」时才补灰色括号，避免重复显示
  if (alias && alias !== title) {
    const al = document.createElement('span');
    al.className = 'sess-alias';
    al.textContent = '(' + alias + ')';
    el.appendChild(al);
  }
}

/* 会话摘要：取最后一条消息的文字（跳过图片标记）
   注意：消息正文存在 m.content，不是 m.text */
function lastPreview(s) {
  const list = (s && s.msgs) || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const t = String(list[i].content || '').trim();
    if (t) {
      // 与聊天气泡口径统一：缩略永远抠掉括号心理描写（不看「显示思考」开关）。
      // 若整条被抠光（纯心理消息），回退原文，避免缩略变空白。
      const stripped = stripPsyForSplit(t).replace(/\s+/g, ' ').trim();
      return stripped || t.replace(/\s+/g, ' ');
    }
  }
  return list.length ? T('[图片]') : T('还没有聊过，点进来聊聊吧');
}
/* 会话列表时间：取最后一条消息的 ts（不受 save() 改写会话 ts 影响），
   无消息时退回会话自身的 ts */
function sessTime(s) {
  const list = (s && s.msgs) || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].ts) return list[i].ts;
  }
  return (s && s.ts) || Date.now();
}

/* 微信/QQ 风格的会话列表 */
function renderMsgSessions() {
  const box = $('msgSessionList');
  if (!box) return;
  // 有搜索词时，列表区交给搜索结果渲染（切 tab / 返回列表都保持搜索态）
  if (typeof searchQ !== 'undefined' && searchQ) {
    renderSearchResults();
    return;
  }
  box.classList.remove('search-results');
  const _page = $('pageMsg');
  if (_page) _page.classList.remove('searching');
  box.innerHTML = '';

  if (!sessions.length) {
    const em = document.createElement('div');
    em.className = 'sess-empty';
    em.innerHTML = T('还没有对话') + '<br>' + T('去「联系人」点一位开始聊天吧');
    box.appendChild(em);
    return;
  }

  sessions.slice().sort((a, b) => {
    // 置顶优先，其次按最近时间
    const pa = a.pin ? 1 : 0, pb = b.pin ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return sessTime(b) - sessTime(a);
  }).forEach(s => {
    // 外层：滑动容器（overflow hidden），内层 .sess 左右平移
    const swipe = document.createElement('div');
    swipe.className = 'sess-swipe';

    const del = document.createElement('button');
    del.className = 'sess-del-slide';
    del.textContent = T('删除');
    swipe.appendChild(del);

    const it = document.createElement('div');
    it.className = 'sess';

    const avatar = document.createElement('div');
    avatar.className = 'sess-avatar';
    const sAv = sessAvatar(s);
    if (showAvatarOn() && sAv) {
      avatar.classList.add('sess-avatar-img');
      const im = document.createElement('img');
      im.src = sAv;
      im.alt = '';
      avatar.appendChild(im);
    } else {
      avatar.textContent = (s.title || T('对')).trim().charAt(0);
    }

    const main = document.createElement('div');
    main.className = 'sess-main';
    const ti = document.createElement('div');
    ti.className = 'sess-title';
    fillTitle(ti, s);
    // 未读红点
    if (isUnread(s.id)) {
      const dot = document.createElement('span');
      dot.className = 'sess-dot';
      ti.appendChild(dot);
    }
    // 置顶标记
    if (s.pin) {
      const pf = document.createElement('span');
      pf.className = 'sess-pin-flag';
      pf.textContent = T('置顶');
      ti.appendChild(pf);
    }
    const sub = document.createElement('div');
    sub.className = 'sess-sub';
    sub.textContent = lastPreview(s);
    main.appendChild(ti);
    main.appendChild(sub);

    const side = document.createElement('div');
    side.className = 'sess-side';
    const tm = document.createElement('div');
    tm.className = 'sess-time';
    tm.textContent = fmtTime(sessTime(s));
    side.appendChild(tm);

    it.appendChild(avatar);
    it.appendChild(main);
    it.appendChild(side);
    swipe.appendChild(it);
    box.appendChild(swipe);

    // 点整行 = 进这个对话（滑开状态下点一下先收起）
    it.onclick = () => {
      if (it.classList.contains('open')) { closeSessSwipe(it); return; }
      openChat(s.id);
    };

    // 左滑出现「删除」
    attachSessSwipe(swipe, it, del);

    // 长按 → 置顶/取消置顶
    let pinTimer = null, pinMoved = false;
    it.addEventListener('touchstart', () => {
      pinMoved = false;
      pinTimer = setTimeout(() => {
        if (pinMoved) return;
        const cur2 = sessions.find(x => x.id === s.id);
        if (!cur2) return;
        askConfirm(cur2.pin ? T('取消置顶这个对话？') : T('把这个对话置顶？'),
          cur2.pin ? T('取消置顶') : T('置顶对话'), () => {
            cur2.pin = !cur2.pin;
            persist();
            renderMsgSessions();
            renderSessions();
          });
      }, 600);
    }, { passive: true });
    it.addEventListener('touchmove', () => { pinMoved = true; if (pinTimer) clearTimeout(pinTimer); }, { passive: true });
    it.addEventListener('touchend', () => { if (pinTimer) clearTimeout(pinTimer); }, { passive: true });

    del.onclick = e => {
      e.stopPropagation();
      askConfirm(T('删除这个对话？删了找不回来。'), T('删除对话'), () => {
        sessions = sessions.filter(x => x.id !== s.id);
        if (!sessions.length) {
          curSid = '';
          msgList = [];
        } else if (curSid === s.id) {
          curSid = sessions[0].id;
        }
        msgList = (sessions.find(x => x.id === curSid) || {}).msgs || [];
        save();
        renderMsgSessions();
        renderSessions();
        renderAll();
      });
    };
  });
}

/* 左滑删除：给单个会话条目绑手势 */
function closeSessSwipe(el) {
  el.style.transform = 'translateX(0)';
  el.classList.remove('open');
  if (el.parentNode) {
    el.parentNode.classList.remove('swiped');
    const db = el.parentNode.querySelector('.sess-del-slide');
    if (db) db.style.opacity = '';   // 清掉拖动时写的内联 opacity，交回 CSS 接管
  }
}
function attachSessSwipe(wrap, el, delBtn) {
  const W = 76;              // 删除按钮宽度（与 CSS 中 .sess-del-slide 保持一致）
  let startX = 0, startY = 0, dx = 0, moved = false, locked = false, open = false;

  el.addEventListener('touchstart', e => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    dx = 0; moved = false; locked = false;
    open = el.classList.contains('open');
    el.style.transition = 'none';
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    const t = e.touches[0];
    const mx = t.clientX - startX, my = t.clientY - startY;
    if (!locked) {
      // 第一次判定方向：横向滑动才接管，纵向交给列表滚动
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      locked = true;
      if (Math.abs(my) > Math.abs(mx)) { moved = false; return; }
    }
    if (Math.abs(my) > Math.abs(mx)) return;
    moved = true;
    e.preventDefault();
    dx = open ? Math.min(0, mx - W) : Math.max(-W, Math.min(0, mx));
    el.style.transform = 'translateX(' + dx + 'px)';
    // 拖动过程中实时同步删除按钮透明度，避免露出白底
    if (delBtn) delBtn.style.opacity = Math.min(1, Math.abs(dx) / W).toFixed(3);
  }, { passive: false });

  const finish = () => {
    el.style.transition = '';
    if (!moved) { closeSessSwipe(el); return; }
    if (dx <= -W / 2) {
      el.style.transform = 'translateX(-' + W + 'px)';
      el.classList.add('open');
      if (wrap) wrap.classList.add('swiped');
    } else {
      closeSessSwipe(el);
    }
  };
  el.addEventListener('touchend', finish);
  el.addEventListener('touchcancel', finish);

  // 点删除：滑回去再交给外部（外部已绑 onclick）
  delBtn.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
}

/* 聊天页 / 切换 tab 时，收起所有已滑开的条目 */
function closeAllSessSwipe() {
  document.querySelectorAll('.sess.open').forEach(el => closeSessSwipe(el));
}

/* 进入某个会话的聊天页 */
function openChat(sid) {
  const s = sessions.find(x => x.id === sid);
  if (!s) return;
  closeAllSessSwipe();
  curSid = s.id;
  msgList = s.msgs || [];
  setUnread(s.id, false);   // 打开即视为已读
  save();
  renderAll('enter');       // 开屏/切会话：可见区气泡播一次整齐入场
  renderMsgSessions();
  // 切到消息 tab 并进入聊天态
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  const page = $('pageMsg');
  if (page) page.classList.add('active');
  document.querySelectorAll('.tab-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === 'msg');
  });
  document.body.setAttribute('data-tab', 'msg');
  msgMode('chat');
  const ne = $('chatName');
  if (ne) ne.textContent = s.title || T('新对话');
  // 开屏定位：用两次 rAF 等布局/字体稳定后再一次跳到底，避免「先看到顶部再猛地跳一下」
  scrollBottomAfterPaint();
  setTimeout(scrollBottomAfterPaint, 60);
}

function bindTabbar() {
  document.querySelectorAll('.tab-item').forEach(btn => {
    btn.onclick = () => switchTab(btn.getAttribute('data-tab'));
  });
  // 聊天页返回键 → 回到会话列表
  const back = $('chatBack');
  if (back) back.onclick = () => {
    closeAllSessSwipe();
    msgMode('list');
    renderMsgSessions();
  };
  // 二级页遮罩
  const mask = $('mask');
  if (mask) mask.onclick = () => closeProfile();
  // 「我」里的折叠块：默认全收起 + 互斥（点开一个自动收其它），不写 localStorage
  bindMeAccordion();
}

/* 「我」页抽屉：默认全收起 + 互斥（点开一个自动收起其它）。
   进页面时若没有任何展开的块，就全部收起；有展开的则保持，保证只可能有一个展开。 */
function bindMeAccordion() {
  const page = document.getElementById('pageMe');
  if (!page) return;
  const blocks = Array.from(page.querySelectorAll('.drawer-block[data-key]'));
  if (!blocks.length) return;

  // 首次进入：强制全部收起（默认收起，绝不一进来就展开）
  if (!page.dataset.meAccInit) {
    blocks.forEach(b => b.classList.add('collapsed'));
    page.dataset.meAccInit = '1';
  }

  blocks.forEach(block => {
    const head = block.querySelector(':scope > .drawer-head');
    if (!head) return;
    head.onclick = () => {
      const willOpen = block.classList.contains('collapsed');
      blocks.forEach(b => b.classList.add('collapsed'));   // 先全收
      if (willOpen) block.classList.remove('collapsed');    // 再按需打开被点的
    };
  });
}

/* 旧抽屉逻辑已废弃（抽屉被拆成底部 tab），保留空函数防止历史调用报错 */
function openDrawer() {}
function closeDrawer() {}
function loadCollapseState() {
  document.querySelectorAll('.drawer-block').forEach(block => {
    // 「我」页的块由 bindTabbar 单独接管（默认全收起 + 互斥，不读 localStorage），这里跳过
    if (block.closest('#pageMe')) return;
    const key = block.getAttribute('data-key');
    if (!key) return;
    if (LS.get('ps_collapse_' + key) === '1') block.classList.add('collapsed');
  });
}

/* ---------- 人设卡编辑页：手风琴（互斥折叠） ----------
   点开一个块 → 自动收起同级其它块；「基础」块不参与（始终展开）。
   状态不写入 localStorage（每次进编辑页恢复默认：全收起）。 */
function bindPersonaAccordion() {
  const page = $('personaEditPage');
  if (!page) return;
  const blocks = Array.from(page.querySelectorAll('.pf-acc'));
  if (!blocks.length) return;
  // 默认全部收起（仅首次绑定，避免重复进入时把用户展开态重置）
  if (!page.dataset.accInit) {
    blocks.forEach(b => b.classList.add('collapsed'));
    page.dataset.accInit = '1';
  }
  blocks.forEach(block => {
    const head = block.querySelector(':scope > .drawer-head');
    if (!head) return;
    head.onclick = () => {
      const willOpen = block.classList.contains('collapsed');
      // 互斥：先全收起，再按需打开被点的那一个
      blocks.forEach(b => b.classList.add('collapsed'));
      if (willOpen) block.classList.remove('collapsed');
    };
  });
}

/* ---------- 通用输入弹窗（WebView 里 prompt 不可靠，自己实现） ---------- */
function askInput(title, defaultValue, onOk) {
  const mask = $('inputMask');
  if (!mask) { onOk && onOk(defaultValue || ''); return; }
  const box = $('inputBox');
  $('inputTitle').textContent = title || T('输入');
  if (box) box.value = defaultValue || '';
  const ok = $('inputOk');
  const cancel = $('inputCancel');
  const close = () => { mask.classList.remove('open'); ok.onclick = null; cancel.onclick = null; if (box) box.onkeydown = null; };
  ok.onclick = () => { const v = box ? box.value : ''; close(); onOk && onOk(v); };
  cancel.onclick = close;
  if (box) box.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
  mask.onclick = e => { if (e.target === mask) close(); };
  mask.classList.add('open');
  if (box) setTimeout(() => { box.focus(); box.select(); }, 60);
}

/* ---------- 通用确认弹窗（WebView 里 confirm 不可靠，自己实现） ---------- */
function askConfirm(text, title, onOk) {
  const mask = $('confirmMask');
  if (!mask) { onOk && onOk(); return; }
  $('confirmTitle').textContent = title || T('确认');
  $('confirmText').textContent = text || '';
  const ok = $('confirmOk');
  const cancel = $('confirmCancel');
  const close = () => { mask.classList.remove('open'); ok.onclick = null; cancel.onclick = null; };
  ok.onclick = () => { close(); onOk && onOk(); };
  cancel.onclick = close;
  mask.onclick = e => { if (e.target === mask) close(); };
  mask.classList.add('open');
}

/* ---------- 通用提示弹窗（替代 WebView 原生 alert，样式统一） ---------- */
function showAlert(msg, title, icon) {
  const mask = $('alertMask');
  if (!mask) return;
  $('alertIcon').textContent = icon || '✓';
  $('alertTitle').textContent = title || T('提示');
  $('alertText').textContent = msg || '';
  const ok = $('alertOk');
  const close = () => { mask.classList.remove('open'); ok.onclick = null; };
  ok.onclick = close;
  mask.onclick = e => { if (e.target === mask) close(); };
  mask.classList.add('open');
}

/* ---------- 底部轻提示（复制成功等） ---------- */
let _psToastTimer = null;
function showToast(msg) {
  let el = document.getElementById('psToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'psToast';
    el.className = 'ps-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg || '';
  el.classList.add('show');
  if (_psToastTimer) clearTimeout(_psToastTimer);
  _psToastTimer = setTimeout(() => { el.classList.remove('show'); }, 1600);
}

/* ---------- 导出面板（替代 WebView 系统下载框） ---------- */
function copyText(txt) {
  return new Promise(function (resolve) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { resolve(true); }, function () { resolve(fallbackCopy(txt)); });
    } else {
      resolve(fallbackCopy(txt));
    }
  });
}
function fallbackCopy(txt) {
  try {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, txt.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) { return false; }
}
function showExportPanel(fn, text) {
  const mask = $('expMask');
  if (!mask) { showAlert(T('已生成（共 ') + text.length + T(' 字符），但本机弹窗不可用，无法展示。'), T('导出'), '⚠️'); return; }
  const name = $('expName'), body = $('expBody'), stat = $('expStat');
  name.textContent = fn;
  body.value = text;
  stat.textContent = T('共 ') + text.length + T(' 字符 / 约 ') + Math.ceil(text.length / 1024) + ' KB';
  const close = function () { mask.classList.remove('open'); };
  const cName = $('expCopyName'), cBody = $('expCopy'), cl = $('expClose');
  cName.onclick = function () { copyText(fn).then(function (ok) { showAlert(ok ? T('文件名已复制：') + '\n' + fn : T('复制失败，请长按上方文件名手动全选复制'), T('复制文件名'), ok ? '✓' : '⚠️'); }); };
  cBody.onclick = function () { copyText(text).then(function (ok) { showAlert(ok ? T('已复制全部内容（') + text.length + T(' 字符）') + '\n' + T('下一步：新建一个 .json 文件粘贴保存即可。') : T('复制失败，请长按下方文本框全选复制'), T('复制内容'), ok ? '✓' : '⚠️'); }); };
  cl.onclick = close;
  mask.onclick = function (e) { if (e.target === mask) close(); };
  mask.classList.add('open');
  try { body.focus(); body.setSelectionRange(0, 0); } catch (e) {}
}

/* ---------- 导出 / 导入备份 ---------- */
let pendingImport = null;   // 暂存待导入的数据
const K_BEFORE_IMPORT = 'pixelspider_before_import';  // 导入前自动留档，防误操作

function exportBackup() {
  const nS = sessions.length, nM = moments.length;
  askConfirm(
    T('将把 ') + nS + T(' 个对话、') + nM + T(' 条动态、人设卡与偏好设置导出为 JSON 文件。') + '\n' + T('确认后系统会弹出保存框，选择保存位置即可。'),
    '导出备份',
    doExportBackup
  );
}

function doExportBackup() {
  try {
    // 收集每张人设卡的「自动动态 / 自动评论」开关（按卡 id 存，键名带前缀）
    const momPrefs = {};
    const cards = getPersonas();
    cards.forEach(c => {
      if (!c || !c.id) return;
      const a = LS.get(K_MOMAUTO_P + c.id);
      const b = LS.get(K_MOMCMT_P + c.id);
      if (a !== null) momPrefs['auto_' + c.id] = a;
      if (b !== null) momPrefs['cmt_' + c.id] = b;
    });

    const data = {
      app: 'pixelspider',
      version: 2,
      exportedAt: Date.now(),
      sessions: sessions,
      current: curSid,
      name: LS.get(K_NAME) || DEFAULT_NAME,
      prompt: getCurPrompt(),                                       // 兼容旧字段：当前卡内容
      personas: getPersonas(),                                      // 多张人设卡
      personaCur: curPersonaId(),
      profile: LS.get(K_PROFILE) || '',
      ctx: LS.get(K_CTX) || '20',
      temp: LS.get(K_TEMP) || '0.7',                  // 温度
      maxTok: LS.get(K_MAXTOK) || '0',                // 最大回复长度
      fontSize: LS.get(K_FONTSIZE) || 'normal',       // 字体档位
      unread: LS.get(K_UNREAD) || '[]',               // 未读会话
      momPrefs: momPrefs,                                           // 每卡自动开关
      moments: moments,                                              // 动态（朋友圈）数据
      momImgs: LS.get(K_MOMIMG) || ''                  // 动态图片（DataURL 映射）
    };
    const text = JSON.stringify(data, null, 2);
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const fn = '像素蜘蛛备份_' + d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + '.json';
    showExportPanel(fn, text);
  } catch (e) {
    showAlert(T('导出失败：') + e.message);
  }
}

function pickImportFile() {
  const f = $('importFile');
  if (f) { f.value = ''; f.click(); }
}

function onImportFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let data = null;
    try {
      data = JSON.parse(ev.target.result);
    } catch (err) {
      showAlert(T('文件不是合法的 JSON，导入失败。'));
      return;
    }
    // 兼容两种格式：完整备份对象 / 纯 sessions 数组
    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.sessions)) list = data.sessions;
    if (!list || !list.length) { showAlert(T('文件里没有找到任何对话。')); return; }
    // 规范化：确保每条都有 id / msgs / title
    list = list.filter(s => s && typeof s === 'object').map(s => {
      const o = {
        id: s.id || uid(),
        title: s.title || '导入的对话',
        msgs: Array.isArray(s.msgs) ? s.msgs : [],
        ts: s.ts || Date.now()
      };
      // 保留备注原名（灰色括号用），没有就不写这个键
      if (s.alias) o.alias = String(s.alias);
      // 关键：保留「会话绑定人设卡」的标记，否则导入后删卡清不掉这些会话
      if (s.persona) {
        o.persona = true;
        o.pid = s.pid || '';
      }
      return o;
    });
    pendingImport = { list: list, meta: (data && !Array.isArray(data)) ? data : {} };
    $('importCount').textContent = String(list.length);
    $('importMask').classList.add('open');
  };
  reader.readAsText(file);
}

function doImport(mode) {
  if (!pendingImport) return;
  // 导入前先把当前数据留档（键 pixelspider_before_import），导错了能救
  try {
    LS.set(K_BEFORE_IMPORT, JSON.stringify({
      sessions: sessions, current: curSid,
      personas: getPersonas(), personaCur: curPersonaId(),   // 人设卡一同留档，防导入冲掉
      at: Date.now()
    }));
  } catch (e) {}

  const list = pendingImport.list;
  if (mode === 'replace') {
    sessions = list;
  } else {
    // 合并：避免 id 冲突，重复的重新分配 id
    const used = new Set(sessions.map(s => s.id));
    list.forEach(s => {
      if (used.has(s.id)) s.id = uid();
      used.add(s.id);
      sessions.push(s);
    });
  }
  curSid = sessions.length ? sessions[0].id : '';
  msgList = sessions.length ? sessions[0].msgs : [];
  // 导入备份里的偏好设置（仅覆盖模式，且备份里有才用）
  const m = pendingImport.meta || {};
  if (mode === 'replace') {
    if (typeof m.name === 'string') LS.set(K_NAME, m.name);
    if (Array.isArray(m.personas) && m.personas.length) {
      // 新版备份：人设卡「合并」——保留本机已有的卡，备份里的卡按 id 去重后并入
      const cur = getPersonas();               // 会顺带保证内置卡存在
      const byId = new Map(cur.map(x => [x.id, x]));
      m.personas.forEach(x => {
        if (!x || typeof x !== 'object' || !x.id) return;
        if (byId.has(x.id)) return;            // 同 id 视为同一张，保留本机的
        byId.set(x.id, { id: x.id, name: x.name || '未命名', prompt: x.prompt || '', avatar: x.avatar || '' });
      });
      const merged = Array.from(byId.values());
      try {
        LS.set(K_PERSONAS, JSON.stringify(merged));
        const wantCur = m.personaCur;
        LS.set(K_PERSONA_CUR,
          merged.some(x => x.id === wantCur) ? wantCur : merged.some(x => x.id === curPersonaId()) ? curPersonaId() : merged[0].id);
      } catch (e) {
        console.warn('导入人设卡失败（可能超限）', e);
        if (typeof showAlert === 'function') {
          showAlert(T('导入人设卡失败：本地存储已满，请先删除一些会话或图片后重试。'), T('导入失败'), '⚠️');
        }
      }
    } else if (typeof m.prompt === 'string') {
      // 旧版备份：单一人设 -> 并入本机卡列表（不冲掉已有的人设卡）
      const cur = getPersonas();
      if (!cur.some(x => x.prompt === m.prompt)) {
        cur.push({ id: 'p' + Date.now(), name: '导入的人设', prompt: m.prompt });
      }
      try {
        LS.set(K_PERSONAS, JSON.stringify(cur));
        LS.set(K_PROMPT, m.prompt);
      } catch (e) {
        console.warn('导入旧版人设失败（可能超限）', e);
        if (typeof showAlert === 'function') {
          showAlert(T('导入人设失败：本地存储已满，请先删除一些会话或图片后重试。'), T('导入失败'), '⚠️');
        }
      }
    }
    if (typeof m.profile === 'string') LS.set(K_PROFILE, m.profile);
    if (m.ctx != null) LS.set(K_CTX, String(m.ctx));
    // 偏好设置（新版备份才有）
    if (m.temp != null) LS.set(K_TEMP, String(m.temp));
    if (m.maxTok != null) LS.set(K_MAXTOK, String(m.maxTok));
    if (m.fontSize != null) LS.set(K_FONTSIZE, String(m.fontSize));
    if (typeof m.unread === 'string') LS.set(K_UNREAD, m.unread);
    // 每卡自动开关（键名前缀 auto_ / cmt_ 还原回带前缀的存储键）
    if (m.momPrefs && typeof m.momPrefs === 'object') {
      Object.keys(m.momPrefs).forEach(k => {
        const isAuto = k.indexOf('auto_') === 0;
        const isCmt = k.indexOf('cmt_') === 0;
        if (!isAuto && !isCmt) return;
        const pid = k.slice(isAuto ? 5 : 4);
        if (!pid) return;
        try { LS.set((isAuto ? K_MOMAUTO_P : K_MOMCMT_P) + pid, String(m.momPrefs[k])); } catch (e) {}
      });
    }
    // 动态（朋友圈）：数组直接接管，图片映射原样写回
    if (Array.isArray(m.moments)) {
      moments = m.moments.filter(x => x && typeof x === 'object');
      try { LS.set(K_MOMENTS, JSON.stringify(moments)); } catch (e) {}
    }
    if (typeof m.momImgs === 'string') {
      try {
        if (m.momImgs) LS.set(K_MOMIMG, m.momImgs);
        else LS.del(K_MOMIMG);
      } catch (e) {}
    }
    refreshProfileSub();
  }
  pendingImport = null;
  $('importMask').classList.remove('open');
  persist();
  renderSessions();
  renderAll();
  if (typeof renderMoments === 'function') renderMoments();   // 动态页同步刷新
  // 同步刷新界面上的名字 / 人设 / 上下文
  // 顶部标题由 msgMode 统一接管（列表态固定「消息」，聊天态显示会话名）
  if (typeof msgMode === 'function') msgMode(document.body.classList.contains('msg-chat') ? 'chat' : 'list');
  if (typeof loadPromptToForm === 'function') loadPromptToForm();
  if (typeof renderPersonaList === 'function') renderPersonaList();
  if (typeof refreshPersonaHint === 'function') refreshPersonaHint();
  const cr = $('ctxRange');
  if (cr) { cr.value = LS.get(K_CTX) || '20'; const cv = $('ctxVal'); if (cv) cv.textContent = cr.value; }
  showAlert(T('导入完成，现在共有 ') + sessions.length + T(' 个对话。'));
}

function bindBackup() {
  const eb = $('exportBtn');
  if (eb) eb.onclick = () => exportBackup();
  const ib = $('importBtn');
  if (ib) ib.onclick = () => pickImportFile();
  const fi = $('importFile');
  if (fi) fi.onchange = onImportFileChosen;
  const mc = $('importCancel');
  if (mc) mc.onclick = () => { pendingImport = null; $('importMask').classList.remove('open'); };
  const mm = $('importMerge');
  if (mm) mm.onclick = () => doImport('merge');
  const mr = $('importReplace');
  if (mr) mr.onclick = () => doImport('replace');
}


/* ---------- 朋友圈（动态） ---------- */
let moments = [];          // [{ id, text, img, ts }]
let momPendingImg = null;  // 待发布的图片（压缩后 DataURL）
let momImgToken = 0;          // 选图序号，防止异步压缩回填已删除的图

function loadMoments() {
  try {
    const raw = LS.get(K_MOMENTS);
    moments = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(moments)) moments = [];
  } catch (e) { moments = []; }
}

/* 写入前剥掉图片，避免 localStorage 超限（与 stripImages 同思路） */
/* 清扫遗留脏数据：作者卡已被删除的动态（连图片/赞/评论）一律清掉 */
function purgeOrphanMoments() {
  if (!moments.length) return;
  const ids = {};
  getPersonas().forEach(c => { if (c && c.id) ids[c.id] = 1; });
  const before = moments.length;
  let touched = false;
  const keep = [];
  moments.forEach(m => {
    if (!m || typeof m !== 'object') { touched = true; return; }
    const a = m.author ? m.author : 'me';
    if (a !== 'me' && !ids[a]) {           // 作者卡已不存在 → 整条删
      setMomImg(m.id, null);
      touched = true;
      return;
    }
    if (Array.isArray(m.likes)) {
      const n = m.likes.length;
      m.likes = m.likes.filter(x => x === 'me' || ids[x]);
      if (m.likes.length !== n) touched = true;
    }
    if (Array.isArray(m.comments)) {
      const n = m.comments.length;
      m.comments = m.comments.filter(c => c && (c.author === 'me' || ids[c.author]));
      if (m.comments.length !== n) touched = true;
    }
    keep.push(m);
  });
  moments = keep;
  if (touched || before !== moments.length) persistMoments();
}

function persistMoments() {
  try {
    const thin = moments.map(m => ({
      id: m.id, text: m.text, ts: m.ts, author: m.author || 'me', hasImage: !!m.img,
      likes: Array.isArray(m.likes) ? m.likes.slice() : [],
      comments: Array.isArray(m.comments) ? m.comments.map(c => ({ id: c.id, text: c.text, ts: c.ts, author: c.author || 'me' })) : []
    }));
    LS.set(K_MOMENTS, JSON.stringify(thin));
  } catch (e) {}
}

/* 图片单独存在另一个键，防止混在一起把整包撑爆 */
const K_MOMIMG = 'pixelspider_moment_imgs';
function loadMomImgs() {
  try {
    const raw = LS.get(K_MOMIMG);
    const map = raw ? JSON.parse(raw) : {};
    return (map && typeof map === 'object') ? map : {};
  } catch (e) { return {}; }
}
function saveMomImgs(map) {
  try { LS.set(K_MOMIMG, JSON.stringify(map)); } catch (e) {}
}
function getMomImg(id) {
  const map = loadMomImgs();
  return map[id] || null;
}
function setMomImg(id, dataUrl) {
  const map = loadMomImgs();
  if (dataUrl) map[id] = dataUrl;
  else delete map[id];
  saveMomImgs(map);
}

/* 取某条动态的作者信息（名字 + 头像）。author 为 'me' 或人设卡 id */
function momAuthorName(m) {
  const a = m && m.author ? m.author : 'me';
  if (a === 'me') return myDisplayName();
  const c = getPersonaById(a);
  // 找不到对应卡（已被删除）：不要回落到「我」，否则会显示成本人发的
  return c ? (c.name || '未命名') : '';   // 理论到不了（脏数据已在启动时清掉）
}
function momAuthorAvatar(m) {
  const a = m && m.author ? m.author : 'me';
  if (a === 'me') return myAvatar();
  const c = getPersonaById(a);
  return (c && c.avatar) ? c.avatar : '';
}

/* ---------- 让 TA 自己发朋友圈（按卡独立开关） ---------- */
const K_MOMAUTO = 'pixelspider_mom_auto';        // 旧全局键（仅作迁移来源）
const K_MOMAUTO_P = 'pixelspider_mom_auto_';     // 每卡键前缀
const K_MOMCMT_P  = 'pixelspider_mom_cmt_';      // 每卡评论键前缀

/* 某张卡是否开了「让 TA 自己发朋友圈」（不传 pid 则读旧全局值） */
function momAutoOn(pid) {
  if (!pid) return LS.get(K_MOMAUTO) === '1';
  return LS.get(K_MOMAUTO_P + pid) === '1';
}
/* 旧接口保留（写全局），新代码请用 setMomAutoFor */
function setMomAuto(on) {
  LS.set(K_MOMAUTO, on ? '1' : '0');
}
/* 设置某张卡的发动态开关 */
function setMomAutoFor(pid, on) {
  if (!pid) return;
  LS.set(K_MOMAUTO_P + pid, on ? '1' : '0');
}
/* 已开「自己发朋友圈」的卡 / 已开「主动评论互动」的卡 */
function activeAutoCards() {
  return getPersonas().filter(c => c && c.id && momAutoOn(c.id));
}

/* 取人设卡里的某个【字段】值，如 【性别】女 */
function personaField(prompt, label) {
  const t = String(prompt || '');
  const m = t.match(new RegExp('【' + label + '】([\\s\\S]*?)(?=【[^】]+】|$)'));
  return m ? String(m[1] || '').replace(/\s+/g, ' ').trim() : '';
}

/* 随机挑一张【开了发动态开关】的卡，返回卡片对象 */
function pickRandomPersona() {
  const list = activeAutoCards();
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/* 让某张卡生成一条动态文案（返回文本，不入库） */
async function genMomentText(card) {
  const p = String((card && card.prompt) || '').trim();
  const sys = [
    '你现在完全以这个角色的身份发一条朋友圈（社交动态）。',
    '要求：第一人称，符合角色口吻和性格；只写正文，30 字以内，不要引号、不要话题标签、不要解释、不要换行。',
    p ? ('【角色设定】\n' + p) : ''
  ].filter(Boolean).join('\n');
  const msgs = [
    { role: 'system', content: sys },
    { role: 'user', content: '发一条' }
  ];
  const txt = await streamChat(msgs, () => {});
  return String(txt || '').trim().replace(/^["'“”]+|["'“”]+$/g, '');
}

/* 点「让 TA 发一条动态」：取当前详情页这张卡 → 生成 → 预览确认 → 入库 */
async function genMomentByAI() {
  const btn = $('pcMomGen');
  if (!btn) return;
  // 【修复】不再随机抽卡：发「当前详情页打开的那张卡」，避免在 A 卡页面却发成 B 卡
  const pg = $('personaPage');
  const curPid = pg ? (pg.dataset.pid || '') : '';
  let card = curPid ? getPersonaById(curPid) : null;
  if (card && !momAutoOn(card.id)) {
    showAlert(T('这张卡还没打开「让 TA 自己发朋友圈」开关。') + '\n' + T('请先打开上方开关，再点按钮。'));
    return;
  }
  // 兜底：拿不到当前卡时（理论上到不了）才回退到随机一张开了开关的卡
  if (!card) card = pickRandomPersona();
  if (!card) { showAlert(T('还没有卡打开「让 TA 自己发朋友圈」。') + '\n' + T('请进人设卡详情页，给想发动态的卡单独打开开关。')); return; }

  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '🪄 ' + T('正在生成…');
  try {
    let text = await genMomentText(card);
    if (!text) { showAlert(T('TA 这次没想出内容，再试一次吧。')); return; }
    btn.disabled = false;
    btn.textContent = old;
    askInput(T('TA 发的动态（可修改后发布）'), text, v => {
      const t = String(v || '').trim();
      if (!t) return;
      const id = uid();
      moments.push({ id, text: t, ts: Date.now(), author: card.id });
      persistMoments();
      renderMoments();
      // 【修复】同步刷新「人设卡详情页 → 朋友圈」预览行，否则要重进页面才显示
      try { renderPcFriendList(card.id); } catch (e) {}
      try { renderMomPersonMoments(card.id); } catch (e) {}
      showAlert(T('已发布到动态，来自') + '「' + (card.name || '未命名') + '」。');
      // 方案A：AI 发的动态也触发其他卡互动
      const np = moments[moments.length - 1];
      if (np && activeCmtCards().length) aiInteractWithMoment(np).catch(() => {});
    });
  } catch (e) {
    showAlert(T('生成失败：') + (e && e.message ? e.message : e));
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

/* ---------- 主动评论互动（点赞 + 评论，按卡独立开关） ---------- */
const K_MOMCMT = 'pixelspider_mom_cmt';     // 旧全局键（仅作迁移来源）

/* 某张卡是否开了「主动评论互动」（不传 pid 则读旧全局值） */
function momCmtOn(pid) {
  if (!pid) return LS.get(K_MOMCMT) === '1';
  return LS.get(K_MOMCMT_P + pid) === '1';
}
/* 旧接口保留（写全局），新代码请用 setMomCmtFor */
function setMomCmt(on) {
  LS.set(K_MOMCMT, on ? '1' : '0');
}
/* 设置某张卡的评论互动开关 */
function setMomCmtFor(pid, on) {
  if (!pid) return;
  LS.set(K_MOMCMT_P + pid, on ? '1' : '0');
}

/* 某条动态的点赞者 id 列表（'me' 或卡 id） */
function momLikes(m) {
  return (m && Array.isArray(m.likes)) ? m.likes : [];
}
function momHasLike(m, who) {
  return momLikes(m).indexOf(who) >= 0;
}
function toggleLike(m, refresh) {
  if (!Array.isArray(m.likes)) m.likes = [];
  const i = m.likes.indexOf('me');
  if (i >= 0) m.likes.splice(i, 1);
  else m.likes.push('me');
  persistMoments();
  (typeof refresh === 'function' ? refresh : renderMoments)();
}
/* 点赞者名字，给界面显示：谁赞过 */
function momLikeNames(m) {
  return momLikes(m).map(id => {
    if (id === 'me') return myDisplayName();
    const c = getPersonaById(id);
    return c ? (c.name || '未命名') : '我';
  });
}

/* 某条动态的评论列表 */
function momComments(m) {
  return (m && Array.isArray(m.comments)) ? m.comments : [];
}
/* 你手动评论 */
function addMyComment(m, text, refresh) {
  const t = String(text || '').trim();
  if (!t) return;
  if (!Array.isArray(m.comments)) m.comments = [];
  m.comments.push({ id: uid(), text: t, ts: Date.now(), author: 'me' });
  persistMoments();
  (typeof refresh === 'function' ? refresh : renderMoments)();
}
/* 删除自己的某条评论 */
function delMyComment(m, cid, refresh) {
  if (!m || !Array.isArray(m.comments)) return;
  const i = m.comments.findIndex(c => c && c.id === cid);
  if (i < 0) return;
  if (m.comments[i].author !== 'me') return;
  m.comments.splice(i, 1);
  persistMoments();
  (typeof refresh === 'function' ? refresh : renderMoments)();
}

/* 已开「主动评论互动」的卡 */
function activeCmtCards() {
  return getPersonas().filter(c => c && c.id && momCmtOn(c.id));
}

/* 随机挑 1~2 张开了开关的卡，排除某作者自己（不让 TA 评论自己发的） */
function pickCmtCards(owner, max) {
  let list = activeCmtCards().filter(c => c.id !== owner);
  if (!list.length) return [];
  // 洗牌
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = list[i]; list[i] = list[j]; list[j] = t;
  }
  const n = Math.min(list.length, Math.max(1, max || (1 + Math.floor(Math.random() * 2))));
  return list.slice(0, n);
}

/* 生成一条评论：让 card 评论 post（可以是别人/自己的动态） */
async function genCommentText(card, post) {
  const p = String((card && card.prompt) || '').trim();
  const owner = momAuthorName(post);
  const sys = [
    '你现在完全以这个角色的身份，去朋友圈给别人的动态留一句评论。',
    '要求：第一人称，符合角色口吻和性格；只写评论正文，20 字以内，不要引号、不要话题标签、不要解释、不要换行、不要 @ 任何人。',
    p ? ('【角色设定】\n' + p) : ''
  ].filter(Boolean).join('\n');
  const msgs = [
    { role: 'system', content: sys },
    { role: 'user', content: '「' + owner + '」发的动态：' + String(post.text || '(图片)') + '\n评论一句' }
  ];
  const txt = await streamChat(msgs, () => {});
  return String(txt || '').trim().replace(/^["'“”]+|["'“”]+$/g, '');
}

/* 让 TA 们去评论 / 点赞某条动态（owner 为动态作者 id） */
async function aiInteractWithMoment(post, opt, refresh) {
  const opts = opt || {};
  const cards = pickCmtCards(post.author || 'me', opts.max);
  if (!cards.length) return;
  let changed = false;
  for (const card of cards) {
    try {
      // 先点赞
      if (!Array.isArray(post.likes)) post.likes = [];
      if (post.likes.indexOf(card.id) < 0) { post.likes.push(card.id); changed = true; }
      // 再评论
      const ctext = await genCommentText(card, post);
      if (ctext) {
        if (!Array.isArray(post.comments)) post.comments = [];
        post.comments.push({ id: uid(), text: ctext, ts: Date.now(), author: card.id });
        changed = true;
      }
    } catch (e) { /* 单张卡失败不影响其它 */ }
  }
  if (changed) { persistMoments(); (typeof refresh === 'function' ? refresh : renderMoments)(); }
}

/* 让 TA 们去互动最新一条动态（小窗/主动触发入口） */
async function aiInteractLatest() {
  if (!moments.length) { showAlert(T('还没有动态可以让 TA 互动。')); return; }
  if (!activeCmtCards().length) { showAlert(T('还没有打开「主动评论互动」的人设卡。')); return; }
  const latest = moments.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
  await aiInteractWithMoment(latest);
}

/* 对外入口：小窗/外部调用。可传 { max, target } —— target 为动态 id 或不传=最新一条 */
async function triggerMomInteract(opt) {
  const o = opt || {};
  loadMoments();
  if (!moments.length) return { ok: false, msg: T('还没有动态。') };
  if (!activeCmtCards().length) return { ok: false, msg: T('没有卡打开「主动评论互动」开关。') };
  let post = null;
  if (o.target) post = moments.find(x => x.id === o.target) || null;
  if (!post) post = moments.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
  await aiInteractWithMoment(post, { max: o.max });
  renderMoments();
  return { ok: true, id: post.id };
}
window.__momInteract = triggerMomInteract;

/* 人设卡详情页：同步动态开关状态 + 绑定按钮 */
function bindPersonaMomentUI() {
  const pg = $('personaPage');
  const pid = pg ? (pg.dataset.pid || '') : '';
  const sw = $('pcMomAuto');
  if (sw) {
    sw.checked = momAutoOn(pid);
    sw.onchange = () => {
      setMomAutoFor(pid, sw.checked);
      const btn = $('pcMomGen');
      if (btn) btn.disabled = !sw.checked;
    };
  }
  const btn = $('pcMomGen');
  if (btn) {
    btn.onclick = genMomentByAI;
    btn.disabled = !momAutoOn(pid);
  }
  const cw = $('pcMomCmt');
  if (cw) {
    cw.checked = momCmtOn(pid);
    cw.onchange = () => { setMomCmtFor(pid, cw.checked); };
  }
}

/* 人设卡详情页：朋友圈预览行（微信式）
   - 这一行始终显示，只是右侧缩略为空
   - 有图：显示最近 4 张缩略图
   - 纯文字：显示开头第一个字/符号 */
function renderPcFriendList(pid) {
  const box = $('pcFriendPreview');
  if (!box) return;
  box.innerHTML = '';

  const mine = (moments || []).filter(m => m.author === pid);
  if (!mine.length) return;

  const list = mine.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 4);
  list.forEach(m => {
    const imgSrc = getMomImg(m.id);
    const cell = document.createElement('div');
    cell.title = (m.text || '').slice(0, 30);

    if (imgSrc) {
      cell.className = 'pc-friend-thumb';
      const im = document.createElement('img');
      im.src = imgSrc;
      im.alt = '';
      cell.appendChild(im);
    } else {
      cell.className = 'pc-friend-char';
      cell.textContent = (m.text || '').trim().charAt(0) || '·';
    }
    box.appendChild(cell);
  });
}

/* 渲染动态卡片列表到指定容器（供「动态」tab 与人设卡朋友圈子页共用）
   box  : 目标容器
   srcList : 要渲染的动态数组
   opts : { rerender: 删除/评论后如何重绘, deleteLabel: 删除按钮是否显示 } */
function renderMomentsInto(box, srcList, opts) {
  if (!box) return;
  opts = opts || {};
  const list0 = Array.isArray(srcList) ? srcList : [];
  const rerender = typeof opts.rerender === 'function' ? opts.rerender : renderMoments;
  box.innerHTML = '';

  if (!list0.length) {
    const empty = document.createElement('div');
    empty.className = 'moment-empty';
    empty.textContent = opts.emptyText || T('还没有动态，发一条记录一下吧～');
    box.appendChild(empty);
    return;
  }

  list0.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach(m => {
    const item = document.createElement('div');
    item.className = 'moment-item';

    const avSrc = momAuthorAvatar(m);
    if (showAvatarOn()) {
      const mav = document.createElement('div');
      mav.className = 'moment-avatar';
      if (avSrc) {
        // 有头像：画图片（同联系人 sess-avatar-img 模式）
        mav.classList.add('moment-avatar-img');
        const mim = document.createElement('img');
        mim.src = avSrc;
        mim.alt = '';
        mav.appendChild(mim);
      } else {
        // 没设置头像：兜底画圆圈 + 名字首字（参考联系人列表）
        mav.classList.add('moment-avatar-txt');
        const nm = (momAuthorName(m) || '').trim();
        mav.textContent = nm.charAt(0) || ((m.author && m.author === 'me') ? T('我') : T('人'));
      }
      item.appendChild(mav);
    }

    const main = document.createElement('div');
    main.className = 'moment-main';
    const who = document.createElement('div');
    who.className = 'moment-name';
    who.textContent = momAuthorName(m);
    main.appendChild(who);

    if (m.text) {
      const txt = document.createElement('div');
      txt.className = 'moment-text';
      txt.textContent = m.text;
      main.appendChild(txt);
    }

    const imgSrc = getMomImg(m.id);
    if (imgSrc) {
      const wrap = document.createElement('div');
      wrap.className = 'moment-img';
      const im = document.createElement('img');
      im.src = imgSrc;
      im.onclick = () => openPreview(imgSrc);
      wrap.appendChild(im);
      main.appendChild(wrap);
    }

    // 点赞区
    const likesWrap = document.createElement('div');
    likesWrap.className = 'moment-likes';
    likesWrap.style.display = 'none';
    main.appendChild(likesWrap);

    // 评论区（DOM 位置挪到操作行之后，见下方）
    const cmtWrap = document.createElement('div');
    cmtWrap.className = 'moment-cmt-list';
    cmtWrap.style.display = 'none';

    (() => {
      const ids = momLikes(m);
      if (ids.length) {
        likesWrap.style.display = 'flex';
        const n = document.createElement('span');
        n.className = 'lk-names';
        ids.forEach((id, i) => {
          if (i > 0) n.appendChild(document.createTextNode('、'));
          if (id === 'me') {
            const s = document.createElement('span');
            s.className = 'lk-me';
            s.textContent = myDisplayName();
            n.appendChild(s);
          } else {
            const c = getPersonaById(id);
            const s = document.createElement('span');
            s.className = 'lk-persona';
            s.textContent = c ? (c.name || '未命名') : '我';
            n.appendChild(s);
          }
        });
        n.appendChild(document.createTextNode(T(' 觉得很赞')));
        likesWrap.appendChild(n);
      }
      const list = momComments(m);
      if (list.length) {
        cmtWrap.style.display = 'flex';
        list.forEach(c => {
          const row = document.createElement('div');
          row.className = 'moment-cmt';
          const who = document.createElement('span');
          who.className = 'cmt-who' + (c.author === 'me' ? ' cmt-me' : '');
          who.textContent = momAuthorName({ author: c.author }) + '：';
          const tx = document.createElement('span');
          tx.className = 'cmt-tx';
          tx.textContent = c.text;
          row.appendChild(who);
          row.appendChild(tx);
          if (c.author === 'me') {
            const del = document.createElement('button');
            del.className = 'cmt-del';
            del.type = 'button';
            del.textContent = '×';
            del.title = T('删除');
            del.onclick = (e) => {
              e.stopPropagation();
              askConfirm(T('删除这条评论？'), T('删除评论'), () => delMyComment(m, c.id, rerender));
            };
            row.appendChild(del);
          }
          cmtWrap.appendChild(row);
        });
      }
    })();

    // 操作行：赞 / 评论 / 让 TA 们互动
    const acts = document.createElement('div');
    acts.className = 'moment-acts';
    const likeBtn = document.createElement('button');
    likeBtn.className = 'moment-act' + (momHasLike(m, 'me') ? ' on' : '');
    likeBtn.textContent = momHasLike(m, 'me') ? T('❤️ 已赞') : T('🤍 赞');
    likeBtn.onclick = () => toggleLike(m, rerender);
    const cmtBtn = document.createElement('button');
    cmtBtn.className = 'moment-act';
    cmtBtn.textContent = T('💬 评论');
    cmtBtn.onclick = () => { askInput(T('说点什么'), '', v => addMyComment(m, v, rerender)); };
    acts.appendChild(likeBtn);
    acts.appendChild(cmtBtn);
    if (activeCmtCards().length) {
      const aiBtn = document.createElement('button');
      aiBtn.className = 'moment-act';
      aiBtn.textContent = T('🤖 让 TA 们互动');
      aiBtn.onclick = async () => {
        const old = aiBtn.textContent;
        aiBtn.disabled = true;
        aiBtn.textContent = T('互动中…');
        try { await aiInteractWithMoment(m, null, rerender); }
        finally { aiBtn.disabled = false; aiBtn.textContent = old; }
      };
      acts.appendChild(aiBtn);
    }
    main.appendChild(acts);

    // 评论块：放在「已赞/评论」操作行下方
    main.appendChild(cmtWrap);

    const foot = document.createElement('div');
    foot.className = 'moment-foot';
    const tm = document.createElement('span');
    tm.textContent = fmtTime(m.ts);
    const del = document.createElement('button');
    del.className = 'moment-del';
    del.textContent = T('删除');
    del.onclick = () => {
      askConfirm(T('删除后无法恢复。'), T('删除这条动态'), () => {
        moments = moments.filter(x => x.id !== m.id);
        setMomImg(m.id, null);
        persistMoments();
        rerender();
      });
    };
    foot.appendChild(tm);
    foot.appendChild(del);
    main.appendChild(foot);

    item.appendChild(main);
    box.appendChild(item);
  });
}

/* 「动态」tab：渲染全部动态 */
function renderMoments() {
  renderMomentsInto($('momentList'), moments);
}

/* ---------- 某人设卡的朋友圈子页（微信「TA 的朋友圈」） ---------- */
function renderMomPersonMoments(pid) {
  const box = $('momPersonList');
  if (!box) return;
  const mine = (moments || []).filter(m => m.author === pid);
  renderMomentsInto(box, mine, {
    emptyText: T('TA 还没有发过朋友圈'),
    // 子页里删除后只重绘子页（不影响 tab 页）
    rerender: () => { renderMomPersonMoments(pid); renderMoments(); renderPcFriendList(pid); }
  });
}

/* 打开某张卡的朋友圈子页 */
function openMomPersonPage(pid) {
  const card = getPersonaById(pid);
  if (!card) return;
  const p = $('momPersonPage');
  if (!p) return;

  p.dataset.pid = pid;

  const av = $('mpAvatar');
  if (av) {
    av.innerHTML = '';
    if (showAvatarOn() && card.avatar) {
      const im = document.createElement('img');
      im.src = card.avatar;
      im.alt = '';
      av.appendChild(im);
    } else {
      av.textContent = personaNameOf(card).trim().charAt(0) || T('人');
    }
  }
  const nm = $('mpName');
  if (nm) nm.textContent = personaNameOf(card);
  const tt = $('momPersonTitle');
  if (tt) tt.textContent = T('朋友圈');

  renderMomPersonMoments(pid);

  try { p.scrollTop = 0; } catch (e) {}
  try { if (p.scrollTo) p.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {}
  p.classList.add('open');
  setTimeout(() => {
    try { p.scrollTop = 0; } catch (e) {}
    const sb = p.querySelector('.settings-body');
    if (sb) { try { sb.scrollTop = 0; } catch (e) {} }
  }, 320);
}

/* 关闭朋友圈子页 */
function closeMomPersonPage() {
  const p = $('momPersonPage');
  if (p) p.classList.remove('open');
}

function publishMoment() {
  const t = $('momText');
  const text = (t ? t.value : '').trim();
  if (!text && !momPendingImg) { showAlert(T('写点什么，或者加张图吧。')); return; }
  const id = uid();
  moments.push({ id, text: text, ts: Date.now(), author: 'me' });
  if (momPendingImg) setMomImg(id, momPendingImg);
  persistMoments();
  momPendingImg = null;
  momImgToken++;              // 作废还没跑完的压缩回调
  if (t) { t.value = ''; t.style.height = 'auto'; }
  const mfi = $('momFile');
  if (mfi) mfi.value = '';
  updateMomImgHint();
  renderMoments();
  // 滚到顶部看新发的
  const body = document.querySelector('#pageMoments .tab-body');
  if (body) body.scrollTop = 0;
  // 方案A：发布后自动让开了开关的卡来互动
  const newPost = moments[moments.length - 1];
  if (newPost && activeCmtCards().length) aiInteractWithMoment(newPost).catch(() => {});
}

function updateMomImgHint() {
  const hint = $('momImgHint');
  if (hint) {
    hint.textContent = momPendingImg ? T('已选 1 张图') : '';
    hint.classList.toggle('filled', !!momPendingImg);
  }
  renderMomImgUI();
}
/* 渲染「已选图缩略图 + 删除按钮」 */
function renderMomImgUI() {
  const wrap = $('momImgThumb');
  const pic = $('momImgThumbPic');
  const del = $('momImgDel');
  if (del && !del._momBound) {
    del._momBound = true;
    del.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      clearMomPendingImg();
    });
  }
  if (momPendingImg) {
    if (pic) pic.src = momPendingImg;
    if (wrap) wrap.classList.add('show');
    if (del) del.classList.add('show');
  } else {
    if (pic) pic.removeAttribute('src');
    if (wrap) wrap.classList.remove('show');
    if (del) del.classList.remove('show');
  }
}
/* 清掉待发图（删除按钮 / 发布完成后调用） */
function clearMomPendingImg() {
  momPendingImg = null;
  const fi = $('momFile');
  if (fi) fi.value = '';
  updateMomImgHint();
  showToast(T('已删除待发布图片'));
}

function bindMoments() {
  loadMoments();
  const mt = $('momText');
  if (mt) {
    mt.addEventListener('input', () => autoGrow(mt));
  }
  const ib = $('momImgBtn');
  const fi = $('momFile');
  if (ib && fi) ib.onclick = () => { fi.value = ''; fi.click(); };
  if (fi) fi.onchange = e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    const token = ++momImgToken;
    reader.onload = ev => {
      compressImage(ev.target.result, 900, 0.72).then(d => {
        if (token !== momImgToken) return;
        momPendingImg = d;
        updateMomImgHint();
      }).catch(() => {
        if (token !== momImgToken) return;
        momPendingImg = ev.target.result;
        updateMomImgHint();
      });
    };
    reader.readAsDataURL(f);
  };
  const pb = $('momPost');
  if (pb) pb.onclick = publishMoment;
  updateMomImgHint();
  renderMoments();
}

/* ---------- 旧抽屉逻辑（已废弃，抽屉拆成底部 tab） ---------- */
function bindDrawer() {
  bindTabbar();
}

/* ---------- 会话列表 ---------- */
/* 联系人页：只渲染人设卡（聊天会话列表见消息页 renderMsgSessions） */
function renderSessions() {
  const box = $('sessionList');
  if (!box) return;

  // 联系人页：置顶卡（内置）单独装一张卡片，其余联系人按首字母 A-Z → 特殊符号排序
  const cards = getPersonas();
  const pinnedCards = cards.filter(c => isBuiltinPersona(c.id));
  const restCards = sortContacts(cards.filter(c => !isBuiltinPersona(c.id)));

  box.innerHTML = '';

  if (pinnedCards.length) {
    const topBox = document.createElement('div');
    topBox.className = 'session-list sess-list-top';
    box.appendChild(topBox);
    renderPersonaContacts(topBox, pinnedCards);
  }
  if (restCards.length) {
    const restBox = document.createElement('div');
    restBox.className = 'session-list';
    box.appendChild(restBox);
    renderPersonaContacts(restBox, restCards, true);
  }
  if (!pinnedCards.length && !restCards.length) {
    renderPersonaContacts(box, cards);
  }

  // 底部统计：共 N 位联系人（浅色小字，居中）
  // 方案 A：作为列表最后一项，跟在所有卡片后面（文档流内），
  // 随列表滚动、永远位于最后一张卡下方，物理上不会与卡片重叠。
  let cnt = document.getElementById('contactsCount');
  if (!cnt) {
    cnt = document.createElement('div');
    cnt.id = 'contactsCount';
    cnt.className = 'contacts-count';
  }
  cnt.textContent = T('共 ') + cards.length + T(' 位联系人');
  box.appendChild(cnt);

  renderIndexBar(box);
}

/* 生成右侧 A–# 索引条，并绑定点击/滑动跳转 */
function renderIndexBar(scrollBox) {
  const bar = $('idxBar');
  if (!bar) return;
  bar.innerHTML = '';
  const heads = scrollBox.querySelectorAll('.sess-group');
  if (!heads.length) { bar.style.display = 'none'; return; }
  bar.style.display = '';

  heads.forEach(h => {
    const it = document.createElement('span');
    it.className = 'idx-item';
    it.textContent = h.dataset.letter;
    it.dataset.letter = h.dataset.letter;
    bar.appendChild(it);
  });

  const jumpTo = letter => {
    const target = scrollBox.querySelector('.sess-group[data-letter="' + letter + '"]');
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
  };
  const fromPoint = (x, y) => {
    // 用坐标找最近的小字母（滑动时也能跟手）
    let best = null, bestD = 1e9;
    bar.querySelectorAll('.idx-item').forEach(el => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(y - (r.top + r.height / 2));
      if (d < bestD) { bestD = d; best = el; }
    });
    return best;
  };
  let dragging = false;
  const onMove = e => {
    if (!dragging) return;
    const t = e.touches ? e.touches[0] : e;
    const el = fromPoint(t.clientX, t.clientY);
    if (el) jumpTo(el.dataset.letter);
    e.preventDefault();
  };
  bar.addEventListener('touchstart', e => { dragging = true; onMove(e); }, { passive: false });
  bar.addEventListener('touchmove', onMove, { passive: false });
  bar.addEventListener('touchend', () => { dragging = false; });
  bar.addEventListener('mousedown', e => { dragging = true; onMove(e); });
  bar.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', () => { dragging = false; });
}

/* ---------- 重命名弹窗 ---------- */
let renameSid = '';

function openRename(sid) {
  const s = sessions.find(x => x.id === sid);
  if (!s) return;
  renameSid = sid;
  const mask = $('renameMask');
  const input = $('renameInput');
  if (input) input.value = s.title || '';
  if (mask) mask.classList.add('open');
  if (input) setTimeout(() => input.focus(), 60);
}

function closeRename() {
  const mask = $('renameMask');
  if (mask) mask.classList.remove('open');
  renameSid = '';
}

function bindRename() {
  const ok = $('renameOk');
  const cancel = $('renameCancel');
  const input = $('renameInput');

  if (ok) ok.onclick = () => {
    const s = sessions.find(x => x.id === renameSid);
    if (s && input) {
      const v = (input.value || '').trim();
      const next = v || T('新对话');
      // 改名时：把第一次出现的原名记进 alias（角色名），供列表括号显示
      if (next !== s.title) {
        if (!s.alias) s.alias = s.title || '';
        s.title = next;
      } else if (s.alias === s.title) {
        s.alias = '';   // 备注被改回原名，括号就没必要显示了
      }
      persist();
      renderSessions();
      renderMsgSessions();   // 消息页列表同步新备注
    }
    closeRename();
  };
  if (cancel) cancel.onclick = closeRename;
  if (input) input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (ok) ok.click(); }
  });
}

/* ---------- 设置项 ---------- */
function bindSettings() {
  bindGenParams();
  // 顶部标题：固定不可编辑（列表态「消息」/ 聊天态联系人名）
  // 备注改名改走「联系人二级页」的小弹窗，不再依赖 contenteditable
  const nameEl = $('chatName');
  if (nameEl) {
    nameEl.textContent = T('消息');
    nameEl.setAttribute('contenteditable', 'false');
    nameEl.classList.add('fixed-title');
  }

  // 人设卡（系统提示词）—— 改为 17 个分行输入框
  const promptEl = $('systemPrompt');
  const promptLen = $('promptLen');
  const promptTokens = $('promptTokens');
  const refreshPromptStat = () => {
    syncHiddenPrompt();
    const v = (promptEl.value || '');
    if (promptLen) promptLen.textContent = v.length;
    if (promptTokens) promptTokens.textContent = estTokens(v);
    // 已填写 N / 17 项（人设卡编辑页底部提示条）
    const statEl = $('ppStatEdit');
    if (statEl) {
      let n = 0;
      PF_FIELDS.forEach(([id]) => {
        const el = $(id);
        if (el && (el.value || '').trim()) n++;
      });
      statEl.textContent = T('已填写 ') + n + ' / ' + PF_FIELDS.length + T(' 项');
    }
  };
  loadPromptToForm = function () {
    const c = getPersonaById(targetPersonaId()) || getCurPersona();
    unpackPromptToFields(c ? (c.prompt || '') : '');
    refreshPromptStat();
  };
  // 17 个框任一输入 → 实时更新字数（只绑一次，避免重复叠加）
  PF_FIELDS.forEach(([id]) => {
    const el = $(id);
    if (el && !el.dataset.bound) {
      el.dataset.bound = '1';
      el.addEventListener('input', refreshPromptStat);
    }
  });
  loadPromptToForm();
  // 「人设卡」入口副标题（已废弃的二级页入口，保留空实现防报错）
  refreshPersonaSub = function () {};

  // 人设卡 →「编辑人设内容」独立页：入口行（已隐藏，逻辑抽到 openPersonaEditor 供 ⋯ 菜单复用）
  const editRow = $('personaEditRow');
  const editPage = $('personaEditPage');
  if (editRow && editPage) {
    editRow.onclick = openPersonaEditor;
  }
  const editBack = $('personaEditBack');
  if (editBack && editPage) {
    editBack.onclick = () => {
      persistCurPersona();                         // 返回时自动存，防忘点保存
      editingPersonaId = '';                       // 退出编辑态，回到「当前使用卡」
      editPage.classList.remove('open');           // 正常返回：只关编辑页，不跳详情页
      if (typeof refreshPersonaHint === 'function') refreshPersonaHint();
    };
  }


  const savePrompt = $('savePrompt');
  if (savePrompt) savePrompt.onclick = () => {
    // 【修复·保存目标确定化】保存前先把编辑锁定钉死为「当前使用卡」（若编辑态已被污染则纠正），
    // 保证「点保存」永远写到你在列表里选中的那张卡，而不是某次点开过的详情页那张。
    if (!editingPersonaId || !getPersonaById(editingPersonaId)) {
      editingPersonaId = curPersonaId();
    }
    persistCurPersona();
    const saved = getPersonaById(targetPersonaId()) || {};
    showAlert(T('已保存到') + '「' + (saved.name || '') + '」，' + T('下次对话生效。'));
  };
  // 新建（重命名/删除已改为「⋯」菜单，见 bindPersonaMenu）
  const pAdd = $('personaAdd');
  if (pAdd) pAdd.onclick = addPersona;

  // 「⋯」菜单按钮绑定（只绑一次）
  bindPersonaMenu();

  renderPersonaList();
  refreshPersonaHint();

  // 人设卡页开关（旧二级页已移除，改为抽屉，此处不再需要）

  // 上下文滑块
  const ctxRange = $('ctxRange');
  const ctxVal = $('ctxVal');
  if (ctxRange) {
    ctxRange.value = LS.get(K_CTX) || '20';
    if (ctxVal) ctxVal.textContent = ctxRange.value;
    ctxRange.oninput = () => {
      if (ctxVal) ctxVal.textContent = ctxRange.value;
      LS.set(K_CTX, ctxRange.value);
    };
  }

  // API Key（多 key 管理）
  // 数据结构：localStorage[K_KEYS] = { list:[{id,name,key}], cur:id }
  // 旧单 key（K_APIKEY）首次访问时自动迁移成一条。
  function loadKeys() {
    let o = null;
    try {
      const raw = LS.get(K_KEYS);
      if (raw) o = JSON.parse(raw);
    } catch (e) { o = null; }
    if (!o || !Array.isArray(o.list)) o = { list: [], cur: '' };
    o.list = o.list.filter(x => x && typeof x.key === 'string')
                   .map(x => {
                     const key = x.key;
                     // 厂商：已存的优先，否则按 key 前缀猜
                     const pid = (x.provider && PROVIDERS[x.provider]) ? x.provider : guessProvider(key);
                     // 模型：已存的优先，否则取该厂商第一个模型
                     // 注意：存储格式是 "provider/model"，比较前必须先去前缀
                     let mids = String(x.model || '');
                     const si = mids.indexOf('/');
                     if (si > 0) mids = mids.slice(si + 1);
                     if (!mids || !PROVIDERS[pid] || !PROVIDERS[pid].models[mids]) {
                       mids = Object.keys(PROVIDERS[pid].models)[0];
                     }
                     return {
                       id: x.id || ('k' + Math.random().toString(36).slice(2)),
                       name: x.name || 'Key',
                       key: key,
                       provider: pid,
                      model: joinModel(pid, mids)
                    };
                  });
    // 旧单 key 自动迁移
    if (!o.list.length) {
      const old = (LS.get(K_APIKEY) || '').trim();
      if (old) {
        const pid = guessProvider(old);
        o.list.push({ id: 'k' + Date.now(), name: '默认', key: old, provider: pid, model: joinModel(pid, Object.keys(PROVIDERS[pid].models)[0]) });
        o.cur = o.list[0].id;
        try { LS.set(K_KEYS, JSON.stringify(o)); } catch (e) {}
      }
    }
    // cur 失效时回落到第一条
    if (!o.list.filter(x => x.id === o.cur).length) o.cur = o.list.length ? o.list[0].id : '';
    return o;
  }
  function saveKeysRaw(o) {
    try { LS.set(K_KEYS, JSON.stringify(o)); } catch (e) {}
  }
  // 当前生效的 key（供 streamChat / 发送校验读取）
  function activeKey() {
    const o = loadKeys();
    const it = o.list.filter(x => x.id === o.cur)[0];
    if (it) return it.key || '';
    return (LS.get(K_APIKEY) || '').trim();
  }
  // 渲染抽屉里的已保存列表
  // 渲染抽屉里的已保存列表
  function renderKeyList() {
    const el = $('keyList');
    if (!el) return;
    const o = loadKeys();
    /* 先清掉可能残留在 body 上的旧菜单 */
    document.querySelectorAll('body > .key-menu').forEach(m => m.remove());
    if (!o.list.length) {
      el.innerHTML = '<div class="key-empty">' + T('还没有保存过 Key') + '</div>';
      return;
    }
    el.innerHTML = '';
    o.list.forEach(it => {
      const row = document.createElement('div');
      row.className = 'key-item' + (it.id === o.cur ? ' cur' : '');

      /* ① 左列：仅 Key 缩略（不显示厂商/模型） */
      const colA = document.createElement('div');
      colA.className = 'key-col-a';
      const sub = document.createElement('div');
      sub.className = 'key-item-sub';
      sub.textContent = it.key ? (it.key.slice(0, 6) + '…' + it.key.slice(-4)) : T('（空）');
      colA.appendChild(sub);
      row.appendChild(colA);

      /* ② 右列：「⋯」按钮 */
      const colC = document.createElement('div');
      colC.className = 'key-col-c';
      const moreBtn = document.createElement('button');
      moreBtn.className = 'key-more-btn';
      moreBtn.type = 'button';
      moreBtn.textContent = '⋯';
      moreBtn.title = T('更多操作');
      colC.appendChild(moreBtn);
      row.appendChild(colC);
      el.appendChild(row);

      /* ③ 菜单内联在行内，放在 ⋯ 按钮左侧 */
      const menu = document.createElement('div');
      menu.className = 'key-menu';
      const closeMenu = () => {
        menu.classList.remove('open');
        moreBtn.classList.remove('on');
        row.classList.remove('menu-open');
      };
      const mkItem = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'key-menu-item ' + cls;
        b.textContent = label;
        b.onclick = (ev) => {
          ev.stopPropagation();
          closeMenu();
          setTimeout(fn, 130);
        };
        return b;
      };
      /* 修改 */
      menu.appendChild(mkItem(T('修改'), 'key-menu-edit', function () { openKeyEditor(it.id); }));
      /* 使用 */
      const useBtn = mkItem(T('使用'), 'key-menu-use', function () {
        const o2 = loadKeys();
        o2.cur = it.id;
        saveKeysRaw(o2);
        const cur = o2.list.filter(x => x.id === it.id)[0];
        LS.set(K_APIKEY, cur ? cur.key : '');
        syncKeyInput();
        refreshKeyUI();
      });
      menu.appendChild(useBtn);
      /* 删除 */
      menu.appendChild(mkItem(T('删除'), 'key-menu-del', function () {
        askConfirm(T('删除') + '「' + (it.name || 'Key') + '」？', T('删除 Key'), function () {
          const o2 = loadKeys();
          o2.list = o2.list.filter(x => x.id !== it.id);
          if (o2.cur === it.id) o2.cur = o2.list.length ? o2.list[0].id : '';
          saveKeysRaw(o2);
          const cur = o2.list.filter(x => x.id === o2.cur)[0];
          LS.set(K_APIKEY, cur ? cur.key : '');
          syncKeyInput();
          refreshKeyUI();
        });
      }));
      /* 已是当前生效 Key：「使用」隐藏 */
      if (it.id === o.cur) useBtn.style.display = 'none';

      moreBtn.onclick = function (ev) {
        ev.stopPropagation();
        const willOpen = !menu.classList.contains('open');
        /* 收起所有已打开的菜单 */
        document.querySelectorAll('.key-menu.open').forEach(m => {
          m.classList.remove('open');
          if (m.__btn) m.__btn.classList.remove('on');
          if (m.__row) m.__row.classList.remove('menu-open');
        });
        if (!willOpen) return;
        /* 行内展开：菜单就在 ⋯ 左侧，无需绝对定位 */
        menu.classList.add('open');
        moreBtn.classList.add('on');
        row.classList.add('menu-open');
      };
      menu.__btn = moreBtn;
      menu.__row = row;
      colC.insertBefore(menu, moreBtn);
    });

    /* 点空白 / 滚动 / 缩放：收起所有菜单 */
    if (!document.__keyOutsideBound) {
      document.__keyOutsideBound = true;
      const closeAll = function () {
        document.querySelectorAll('.key-menu.open').forEach(function (m) {
          m.classList.remove('open');
          if (m.__btn) m.__btn.classList.remove('on');
          if (m.__row) m.__row.classList.remove('menu-open');
        });
      };
      document.addEventListener('click', closeAll);
      window.addEventListener('scroll', closeAll, true);
      window.addEventListener('resize', closeAll);
    }
  }


  /* ---------- API Key 编辑弹窗（名字 / Key / 厂商 / 模型） ---------- */
  function openKeyEditor(id) {
    const mask = $('keyEdMask');
    if (!mask) return;
    const o = loadKeys();
    const isNew = !id;
    const it = isNew ? { id: '', name: '', key: '', provider: '', model: '' }
                     : o.list.filter(x => x.id === id)[0];
    if (!it) { showAlert(T('这条 Key 已不存在')); return; }

    /* 标题 / 按钮文案：新增与编辑区分 */
    const titleEl = $('kedTitle');
    const okBtnText = $('kedOk');
    if (titleEl) titleEl.textContent = T(isNew ? '新增 API Key' : '编辑 API Key');
    if (okBtnText) okBtnText.textContent = T(isNew ? '添加' : '保存');

    let pid = (it.provider && PROVIDERS[it.provider]) ? it.provider : guessProvider(it.key);
    let mid = it.model ? it.model.split('/')[1] : '';
    if (!mid || !PROVIDERS[pid] || !PROVIDERS[pid].models[mid]) {
      mid = Object.keys(PROVIDERS[pid].models || {})[0] || '';
    }

    const nameEl = $('kedName');
    const keyEl = $('kedKey');
    const provEl = $('kedProv');
    const modelEl = $('kedModel');
    if (nameEl) nameEl.value = it.name || (isNew ? ('Key ' + (o.list.length + 1)) : '');
    if (keyEl) keyEl.value = it.key || '';

    /* 厂商 chips */
    const renderProv = () => {
      if (!provEl) return;
      provEl.innerHTML = '';
      Object.keys(PROVIDERS).forEach(k => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ked-chip' + (k === pid ? ' on' : '');
        b.textContent = PROVIDERS[k].name || k;
        b.onclick = () => {
          pid = k;
          const mids = Object.keys(PROVIDERS[k].models || {});
          mid = mids[0] || '';
          renderProv();
          renderModel();
        };
        provEl.appendChild(b);
      });
    };

    /* 模型列表 */
    const renderModel = () => {
      if (!modelEl) return;
      modelEl.innerHTML = '';
      const box = PROVIDERS[pid] || PROVIDERS.deepseek;
      const models = box.models || {};
      Object.keys(models).forEach(m => {
        const info = models[m] || {};
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ked-model' + (m === mid ? ' on' : '');
        const nm = document.createElement('div');
        nm.className = 'ked-model-name';
        nm.textContent = m;
        b.appendChild(nm);
        const ds = document.createElement('div');
        ds.className = 'ked-model-desc';
        ds.textContent = (info.tag ? info.tag + ' · ' : '') + (info.desc || '');
        b.appendChild(ds);
        b.onclick = () => { mid = m; renderModel(); };
        modelEl.appendChild(b);
      });
      if (!Object.keys(models).length) {
        const e = document.createElement('div');
        e.className = 'ked-empty';
        e.textContent = T('该厂商暂无内置模型');
        modelEl.appendChild(e);
      }
    };

    renderProv();
    renderModel();

    /* 明文/掩码切换 */
    const eye = $('kedEye');
    let plain = true;
    if (keyEl) keyEl.type = 'text';
    if (eye) eye.classList.add('on');
    if (eye) eye.onclick = () => {
      plain = !plain;
      if (keyEl) keyEl.type = plain ? 'text' : 'password';
      eye.classList.toggle('on', plain);
    };

    const close = () => {
      mask.classList.remove('open');
      ['kedClose', 'kedCancel', 'kedOk'].forEach(i => { const b = $(i); if (b) b.onclick = null; });
      if (eye) eye.onclick = null;
      mask.onclick = null;
    };
    const ok = $('kedOk');
    const cancel = $('kedCancel');
    const closeBtn = $('kedClose');
    if (closeBtn) closeBtn.onclick = close;
    if (cancel) cancel.onclick = close;
    if (ok) ok.onclick = () => {
      const nn = nameEl ? nameEl.value.trim() : '';
      const kk = keyEl ? keyEl.value.trim() : '';
      if (!kk) { showAlert(T('API Key 不能为空'), T('提示'), '!'); return; }
      /* 校验 Key 与所选厂商是否匹配，不匹配就拦下并弹窗 */
      const chk = checkKeyForProvider(kk, pid);
      if (!chk.ok) {
        showAlert(chk.msg, T('Key 与厂商不匹配'), '⚠️');
        return;
      }
      const o2 = loadKeys();
      if (isNew) {
        /* 新增：追加一条并切为当前生效 */
        const nid = 'k' + Date.now();
        o2.list.push({
          id: nid,
          name: nn || ('Key ' + (o2.list.length + 1)),
          key: kk,
          provider: pid,
          model: joinModel(pid, mid)
        });
        o2.cur = nid;
        saveKeysRaw(o2);
        LS.set(K_APIKEY, kk);
        close();
        syncKeyInput();
        refreshKeyUI();
        refreshAbout();
        setTimeout(function () {
          showAlert(T('已新增并切换到') + '「' + (nn || 'Key') + '」', T('完成'), '🔑');
        }, 160);
        return;
      }
      o2.list.forEach(x => {
        if (x.id !== id) return;
        x.name = nn || 'Key';
        x.key = kk;
        x.provider = pid;
        x.model = joinModel(pid, mid);
      });
      /* 若改的是当前生效 Key，同步写入 K_APIKEY */
      if (o2.cur === id) LS.set(K_APIKEY, kk);
      saveKeysRaw(o2);
      close();
      syncKeyInput();
      refreshKeyUI();
      refreshAbout();
    };
    mask.onclick = e => { if (e.target === mask) close(); };

    mask.classList.add('open');
    if (nameEl) setTimeout(() => { try { nameEl.focus(); } catch (e) {} }, 80);
  }



  /* 取当前选中 Key 的完整对象（streamChat 依赖） */
  function curKeyObj() {
    const o = loadKeys();
    const cur = o.list.filter(x => x.id === o.cur)[0];
    if (cur) return cur;
    return o.list.length ? o.list[0] : null;
  }

  /* 改某条 Key 的厂商（手动纠正） */
  function setKeyProvider(id, pid) {
    if (!PROVIDERS[pid]) return;
    const o = loadKeys();
    o.list.forEach(x => {
      if (x.id !== id) return;
      x.provider = pid;
      let mm = String(x.model || ''); const _si = mm.indexOf('/'); if (_si > 0) mm = mm.slice(_si + 1);
      if (!mm || !PROVIDERS[pid].models[mm]) mm = Object.keys(PROVIDERS[pid].models || {})[0] || '';
      x.model = joinModel(pid, mm);
    });
    saveKeysRaw(o);
    renderKeyList();
    refreshAbout();
  }

  /* 改某条 Key 的模型 */
  function setKeyModel(id, mid) {
    const o = loadKeys();
    o.list.forEach(x => { if (x.id === id) x.model = joinModel(x.provider, mid); });
    saveKeysRaw(o);
    refreshAbout();
  }
  const keyInput = $('apiKeyInput');
  const keyState = $('keyState');
  const keyEye = $('keyEye');
  const keyEyeOpen = $('keyEyeOpen');
  const keyEyeOff = $('keyEyeOff');
  // 掩码开关：false = 隐藏（显示 sk-9962****6708），true = 明文
  let keyVisible = false;
  // 掩码规则：保留前 8 位 + 后 4 位，中间一律用 *
  const maskKey = (s) => {
    s = (s || '');
    if (!s) return '';
    if (s.length <= 12) return s.slice(0, 3) + '****';
    const n = Math.max(4, Math.min(s.length - 12, 8)); // 中间星号数量 4~8
    return s.slice(0, 8) + '*'.repeat(n) + s.slice(-4);
  };
  // 取「真实值」：隐藏态下 value 是掩码，靠 dataset.realKey 记真实值
  const realKeyValue = () => {
    if (!keyInput) return '';
    if (!keyVisible && keyInput.dataset.masked === '1') return keyInput.dataset.realKey || '';
    return keyInput.value || '';
  };
  // 按当前开关状态重绘输入框内容
  const applyKeyMask = () => {
    if (!keyInput) return;
    const real = keyInput.dataset.masked === '1' ? (keyInput.dataset.realKey || '') : (keyInput.value || '');
    if (keyVisible) {
      keyInput.readOnly = false;
      keyInput.value = real;
      delete keyInput.dataset.masked; delete keyInput.dataset.realKey;
    } else {
      keyInput.dataset.realKey = real;
      keyInput.dataset.masked = '1';
      keyInput.readOnly = true;
      keyInput.value = maskKey(real);
    }
    if (keyEyeOpen) keyEyeOpen.classList.toggle('hidden', !keyVisible);
    if (keyEyeOff) keyEyeOff.classList.toggle('hidden', keyVisible);
  };
  const refreshKeyState = () => {
    const saved = activeKey().trim();
    const typed = realKeyValue().trim();
    if (keyState) {
      if (!saved && !typed) { keyState.textContent = T('未设置'); }
      else if (typed !== saved) { keyState.textContent = T('有未保存的修改'); }
      else { keyState.textContent = T('已设置（') + saved.slice(0, 6) + '…' + saved.slice(-4) + '）'; }
    }
  };
  const syncKeyInput = () => {
    if (!keyInput) return;
    delete keyInput.dataset.masked; delete keyInput.dataset.realKey;
    keyInput.value = activeKey();
    applyKeyMask();
    refreshKeyState();
  };
  const refreshKeyUI = () => { refreshKeyState(); renderKeyList(); };
  if (keyInput) {
    keyInput.value = activeKey();
    refreshKeyState();
    applyKeyMask();   // 默认隐藏显示
    keyInput.addEventListener('input', () => { keyInput.dataset.realKey = keyInput.value; refreshKeyState(); });
  }
  // 眼睛按钮：切换明文 / 掩码
  if (keyEye) {
    keyEye.onclick = () => {
      if (!keyInput) return;
      keyVisible = !keyVisible;
      applyKeyMask();
      refreshKeyState();
    };
  }
  renderKeyList();   // 首次渲染已保存的 Key 列表
  // 保存：写回「当前选中的那条」，没有就新建一条
  const saveKey = $('saveKey');
  if (saveKey) saveKey.onclick = () => {
    const v = realKeyValue().trim();
    const o = loadKeys();
    if (o.cur) {
      const it = o.list.filter(x => x.id === o.cur)[0];
      if (it) { it.key = v; }
      else { o.list.push({ id: 'k' + Date.now(), name: 'Key ' + (o.list.length + 1), key: v }); o.cur = o.list[o.list.length - 1].id; }
    } else if (v) {
      o.list.push({ id: 'k' + Date.now(), name: 'Key 1', key: v });
      o.cur = o.list[0].id;
    }
    saveKeysRaw(o);
    LS.set(K_APIKEY, v);   // 兼容旧读取点
    refreshKeyUI();
    closeDrawer();
    showAlert(v ? T('已保存并启用当前 Key') : T('已清空当前 Key 内容'), T('完成'), '🔑');
  };
  // 清除：只清空当前这条的 key 内容
  const clearKey = $('clearKey');
  if (clearKey) clearKey.onclick = () => {
    if (keyInput) { delete keyInput.dataset.masked; delete keyInput.dataset.realKey; keyInput.value = ''; }
    const o = loadKeys();
    if (o.cur) {
      const it = o.list.filter(x => x.id === o.cur)[0];
      if (it) it.key = '';
      saveKeysRaw(o);
    }
    LS.set(K_APIKEY, '');
    refreshKeyUI();
    if (typeof applyKeyMask === 'function') applyKeyMask();
  };
  /* ---------- 【第 30 轮】联网搜索开关（输入栏左侧按钮，真开关） ---------- */
  /* 规则：手动开启、手动关闭，发消息不自动关；没有博查 Key 时禁止开启。 */
  (function bindWebToggle() {
    const wb = $('webBtn');
    if (!wb) return;
    const webOnNow = () => String(LS.get(K_WEBON) || '') === '1';
    const hasKey = () => !!String(LS.get(K_BOCHA) || '').trim();
    const paint = () => {
      const on = webOnNow();
      wb.classList.toggle('on', on && hasKey());
      wb.classList.toggle('locked', !hasKey());
      wb.title = !hasKey() ? '先在设置里填博查搜索 Key' : (on ? '联网搜索：开' : '联网搜索：关');
    };
    wb.onclick = () => {
      if (!hasKey()) {
        if (typeof showAlert === 'function') showAlert('请先在设置里填写「博查搜索 Key」', '联网搜索不可用', '🔍');
        return;
      }
      LS.set(K_WEBON, webOnNow() ? '0' : '1');
      paint();
    };
    paint();
    // 博查 Key 的保存/清除会改变可用性 → 由 bindBochaKey 调此刷新
    window.__refreshWebToggle = paint;
  })();

  /* ---------- 博查搜索 Key（联网搜索专用，独立键，唯一不可新增） ---------- */
  (function bindBochaKey() {
    const bi = $('bochaKeyInput');
    if (!bi) return;
    const bs = $('bochaKeyState');
    const be = $('bochaKeyEye');
    const beOpen = $('bochaKeyEyeOpen');
    const beOff = $('bochaKeyEyeOff');
    let bVisible = false;
    const bMask = (s) => {
      s = String(s || '');
      if (!s) return '';
      if (s.length <= 12) return s.slice(0, 3) + '****';
      const n = Math.max(4, Math.min(s.length - 12, 8));
      return s.slice(0, 8) + '*'.repeat(n) + s.slice(-4);
    };
    const bReal = () => (bi.dataset.masked === '1') ? (bi.dataset.realKey || '') : (bi.value || '');
    const bApplyMask = () => {
      if (bVisible) {
        if (bi.dataset.masked === '1') bi.value = bi.dataset.realKey || '';
        delete bi.dataset.masked; delete bi.dataset.realKey;
        bi.readOnly = false;
      } else {
        const real = (bi.dataset.masked === '1') ? (bi.dataset.realKey || '') : (bi.value || '');
        bi.dataset.realKey = real; bi.dataset.masked = '1';
        bi.value = real ? bMask(real) : '';
        bi.readOnly = false;
      }
      // 打码（bVisible=false）→ 显示闭眼；明文 → 显示睁眼
      if (beOpen) beOpen.classList.toggle('hidden', !bVisible);
      if (beOff) beOff.classList.toggle('hidden', bVisible);
    };
    const bState = () => {
      if (!bs) return;
      const saved = String(LS.get(K_BOCHA) || '').trim();
      const typed = String(bReal() || '').trim();
      if (!saved && !typed) bs.textContent = '未设置（联网搜索不可用）';
      else if (typed !== saved) bs.textContent = '有未保存的修改';
      else bs.textContent = '已设置（' + saved.slice(0, 6) + '…' + saved.slice(-4) + '）';
    };
    bi.dataset.realKey = String(LS.get(K_BOCHA) || '');
    bi.dataset.masked = '1';
    bApplyMask(); bState();
    bi.addEventListener('input', () => {
      bi.dataset.masked = '0';
      bi.dataset.realKey = bi.value;
      bState();
    });
    if (be) be.onclick = () => { bVisible = !bVisible; bApplyMask(); bState(); };
    const bSave = $('saveBochaKey');
    if (bSave) bSave.onclick = () => {
      const v = String(bReal() || '').trim();
      LS.set(K_BOCHA, v);
      bi.dataset.realKey = v; bi.dataset.masked = '1';
      bApplyMask(); bState();
      if (typeof window.__refreshWebToggle === 'function') window.__refreshWebToggle();
      if (typeof showAlert === 'function') showAlert(v ? '博查搜索 Key 已保存' : '已清空博查搜索 Key', '完成', '🔍');
    };
    const bClear = $('clearBochaKey');
    if (bClear) bClear.onclick = () => {
      delete bi.dataset.masked; delete bi.dataset.realKey;
      bi.value = '';
      LS.set(K_BOCHA, '');
      bApplyMask(); bState();
      if (typeof window.__refreshWebToggle === 'function') window.__refreshWebToggle();
    };
  })();
  // 新增 Key：走与「修改」同一套美化弹窗（openKeyEditor 新增模式）
  const addKeyBtn = $('addKey');
  if (addKeyBtn) addKeyBtn.onclick = () => {
    const MAX_KEYS = 10;
    const cnt = loadKeys().list.length;
    if (cnt >= MAX_KEYS) {
      showAlert(T('最多只能保存 10 个 API Key，请先删除不用的再新增'), T('提示'), '!');
      return;
    }
    openKeyEditor(null);
  };

  // 模型自定义下拉
  bindModelDrop();

  // 图片预览关闭
  const pc = $('previewClose');
  const ip = $('imgPreview');
  if (pc && ip) pc.onclick = () => ip.classList.remove('open');
  if (ip) ip.onclick = e => { if (e.target === ip) ip.classList.remove('open'); };
}

function bindModelDrop() {
  const list = $('modelList');
  if (!list) return;

  /* 静默复制：无 UI、无文字提示 */
  const silentCopy = (txt) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt);
        showToast(T('复制成功'));
        return;
      }
    } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(T('复制成功'));
    } catch (e) {}
  };

  list.innerHTML = '';
  Object.keys(PROVIDERS).forEach(pid => {
    const p = PROVIDERS[pid];
    const card = document.createElement('div');
    card.className = 'mprov';

    /* 厂商头：名称 + 官网/获取 Key 两个复制按钮 */
    const head = document.createElement('div');
    head.className = 'mprov-head';
    const pn = document.createElement('span');
    pn.className = 'mprov-name';
    pn.textContent = p.name;
    head.appendChild(pn);

    const mkCopy = (label, url) => {
      const b = document.createElement('span');
      b.className = 'mprov-copy mprov-link';
      b.textContent = label;
      b.onclick = (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        let w = null;
        try { w = window.open(url, '_blank'); } catch (e) {}
        if (!w) { try { location.href = url; } catch (e) {} }
      };
      return b;
    };
    head.appendChild(mkCopy(T('官网'), p.site));
    head.appendChild(mkCopy(T('获取 Key'), p.keyUrl));
    card.appendChild(head);

    /* 厂商卡可折叠：点厂商头展开/收起（点“官网/获取 Key”不触发） */
    card.dataset.pid = pid;
    const ck = 'ps_mprov_' + pid;
    if (LS.get(ck) === '1') card.classList.add('collapsed');
    head.onclick = (e) => {
      if (e.target && e.target.closest && e.target.closest('.mprov-copy')) return;
      card.classList.toggle('collapsed');
      LS.set(ck, card.classList.contains('collapsed') ? '1' : '0');
    };

    /* baseURL：点击复制 */
    const bu = document.createElement('div');
    bu.className = 'mprov-base';
    bu.textContent = p.base.replace(/^https?:\/\//, '').split('/')[0];
    bu.onclick = () => silentCopy(p.base);
    card.appendChild(bu);

    /* Key 形态提示 */
    if (p.keyHint) {
      const kh = document.createElement('div');
      kh.className = 'mprov-keyhint';
      kh.textContent = T('Key 形如') + '：' + p.keyHint;
      card.appendChild(kh);
    }

    /* 模型清单：名称 + 标签 + 免费/付费 + 能力描述 */
    Object.keys(p.models || {}).forEach(mid => {
      const m = p.models[mid];
      const row = document.createElement('div');
      row.className = 'mprov-model';
      const t = document.createElement('div');
      t.className = 'mpm-title';
      t.textContent = mid;
      row.appendChild(t);
      const meta = document.createElement('div');
      meta.className = 'mpm-meta';
      const tag = document.createElement('span');
      tag.className = 'mpm-badge';
      tag.textContent = m.tag || '';
      meta.appendChild(tag);
      const price = document.createElement('span');
      const isFree = !!m.free || /免费/.test(m.tag || '');
      price.className = 'mpm-price' + (isFree ? ' free' : '');
      price.textContent = isFree ? T('免费') : T('付费');
      meta.appendChild(price);
      row.appendChild(meta);
      if (m.desc) {
        const d = document.createElement('div');
        d.className = 'mpm-desc';
        d.textContent = m.desc;
        row.appendChild(d);
      }
      card.appendChild(row);
    });

    list.appendChild(card);
  });
}

/* ---------- 启动 ---------- */
function init() {
  loadAll();
  // 启动清扫：删掉作者卡已不存在的遗留动态（含图片/赞/评论）
  loadMoments();
  purgeOrphanMoments();
  bindInput();
  bindDrawer();
  bindSettings();
  bindProfile();        // 个人资料页（侧边栏第一个入口）
  try { helpBind(); } catch (e) {}   // AI 客服：输入/发送/清空
  bindPersonaPage();    // 人设卡详情页（联系人点进去）
  bindMsgMenu();
  bindChatMore();       // 顶栏「⋯」会话操作菜单
  bindChatFind();       // v6: 会话内搜索条
  try { bindStance(); } catch (e) {}   // 对话姿态：顶栏按钮 + 浮层
  bindStorageWarn();    // v6: 存储容量预警条按钮
  bindBackTop();        // 滚动到底部按钮
  bindRename();
  bindChatBgPage();    // 第 25 轮：聊天背景面板
  bindBackup();
  bindMoments();        // 动态（朋友圈）
  bindSearch();         // 消息页：聊天记录搜索
  loadCollapseState();
  bindPersonaAccordion();
  renderSessions();
  renderAll();
  // 启动即进入「消息 → 会话列表」首屏
  document.body.setAttribute('data-tab', 'msg');   // 让顶部栏显示出来（否则 header 是 display:none）
  renderMsgSessions();
  msgMode('list');
  renderAttachPreview(); // 清掉可能残留的预览条（无图时自动移除）
  migrateChatBg();       // 第 26 轮：旧背景键迁移到 default 皮肤键
  initSkin();            // 启动恢复上次选中的皮肤
  applyRadius();         // 启动恢复圆角风格
  bindRadiusSeg();       // 换肤页圆角切换绑定
  applyBubble();         // 启动恢复气泡形状
  bindBubbleSeg();       // 换肤页气泡形状切换绑定
  applyFontType();       // 启动恢复字体样式（系统/黑体/宋体）
  bindTypeSeg();
  applyTextBold();       // 启动恢复字体加粗
  bindBoldSeg();
  applyTextItal();       // 启动恢复斜体
  bindItalSeg();
  applyLang();           // 启动恢复界面语言
  bindLangSeg();
  applyFontSize();       // 应用已保存的字体档位（整体缩放所有页面）
  bindFontSizeSeg();     // 个性装扮页 5 档字号切换绑定
  bindZoomBase();        // 缩放基准宽随屏幕尺寸/旋转更新
  applyChatBg();         // 第 25 轮：恢复聊天背景
  bindPageBgPage();      // 第 28 轮：页面背景设置页绑定
  applyPageBg();         // 第 28 轮：恢复四页页面背景
  initFonts();           // 启动恢复自定义字体（在线 / 本地导入）
  bindFontEvents();      // 字体块事件绑定（选择 / 删除 / 导入 / 还原）
  renderQuoteBar();      // 清掉可能残留的引用条
  setTimeout(checkStorageWarn, 800);   // v6: 启动后检查存储占用，超阈值弹预警
  // 启动即刷新关于页动态信息（防止刷新后停在关于页时显示 -）
  // 注意：refreshAbout 内部会用到 curKeyObj 等局部依赖，顶层调用需做防御，失败不影响启动
  if (typeof refreshAbout === 'function') { try { refreshAbout(); } catch (e) {} }

  // 账号系统：检查登录状态，未登录则显示登录页（异步，不阻塞启动）
  try { initAuth(); } catch (e) { console.warn('[auth] initAuth 异常', e); }
  // 启动遮罩兜底：万一 initAuth 中途抛异常没走到收口，3 秒后强制揭开，避免白屏死锁
  setTimeout(function () { try { bootMaskDone(); } catch (e) {} }, 3000);

  // 云端同步：绑定抽屉交互
  try { bindCloud(); } catch (e) { console.warn('[cloud] bindCloud 异常', e); }
}

/* ---------- 字体大小档位 ---------- */
/* 5 档（个性装扮页）：xs 特小 / small 小 / normal 中 / large 大 / xl 特大
   兼容旧的 3 档存储值（small/normal/large 全部保留，无需迁移） */
const FONT_STEPS = ['xs', 'small', 'normal', 'large', 'xl'];
function getFontSize() {
  const v = LS.get(K_FONTSIZE);
  return FONT_STEPS.indexOf(v) >= 0 ? v : 'normal';
}
function applyFontSize() {
  const v = getFontSize();
  const b = document.body;
  const r = document.documentElement;
  b.classList.remove('fs-xs', 'fs-small', 'fs-normal', 'fs-large', 'fs-xl');
  b.classList.add('fs-' + v);
  /* 整体缩放用属性选择器驱动（见 style.css「字体档位：整体缩放」）。
     必须写在【根元素 html】上：主布局（顶栏/底栏/输入框）都是 position: fixed，
     zoom 挂 body 时 fixed 子元素不缩放，会出现「中间变大、顶底栏没变」的错位。
     属性写法与 CSS 同步，天然只触发一次重绘，不会闪。 */
  r.setAttribute('data-fs', v);
  r.style.setProperty('--zoom-base', zoomBaseSize() + 'px');
  // 个性装扮页的 5 档切换
  const seg5 = $('fontSizeSeg');
  if (seg5) {
    seg5.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('on', btn.getAttribute('data-fs') === v);
    });
  }
}
/* 缩放基准宽度：100vw / zoom 会得到“CSS 布局宽度”。
   缩放后布局宽度必须仍等于视口宽，页面才满宽无留白。
   手机竖屏布局宽度都小于 500px，这里按 500 做基准就不会溢出；
   ≥500px 的设备和横屏退回真实宽度，保证不出横向滚动条。 */
const ZOOM_BASE_MAX = 500;
function zoomBaseSize() {
  const w = (window.visualViewport && window.visualViewport.width) || window.innerWidth || 400;
  return Math.min(w, ZOOM_BASE_MAX);
}
function bindZoomBase() {
  if (document.body._zoomBaseBound) return;
  document.body._zoomBaseBound = true;
  let t = null;
  const onResize = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      document.documentElement.style.setProperty('--zoom-base', zoomBaseSize() + 'px');
    }, 180);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
}
function bindFontSizeSeg() {
  const seg5 = $('fontSizeSeg');
  if (!seg5 || seg5._bound) return;
  seg5._bound = true;
  seg5.addEventListener('click', e => {
    const btn = e.target.closest('button[data-fs]');
    if (!btn) return;
    const v = btn.getAttribute('data-fs');
    if (FONT_STEPS.indexOf(v) < 0) return;
    LS.set(K_FONTSIZE, v);
    applyFontSize();
  });
}
function bindFontSeg() {
  /* 已移除：关于页的 3 档字号切换已合并到个性装扮页的 5 档控件 */
}

/* ---------- 生成参数（温度 / 最大长度） ---------- */
function bindGenParams() {
  const tR = $('tempRange'), tV = $('tempVal');
  const mR = $('maxTokRange'), mV = $('maxTokVal');

  function syncTemp() {
    const v = parseFloat(LS.get(K_TEMP));
    const val = isNaN(v) ? 1.0 : v;
    if (tR) tR.value = val;
    if (tV) tV.textContent = val.toFixed(1);
  }
  function syncTok() {
    const v = parseInt(LS.get(K_MAXTOK) || '0', 10);
    const val = isNaN(v) ? 0 : v;
    if (mR) mR.value = val;
    if (mV) mV.textContent = val > 0 ? String(val) : T('不限');
  }
  syncTemp(); syncTok();

  if (tR && !tR._bound) {
    tR._bound = true;
    tR.addEventListener('input', () => {
      const val = parseFloat(tR.value);
      LS.set(K_TEMP, String(val));
      if (tV) tV.textContent = val.toFixed(1);
    });
  }
  if (mR && !mR._bound) {
    mR._bound = true;
    mR.addEventListener('input', () => {
      const val = parseInt(mR.value, 10) || 0;
      LS.set(K_MAXTOK, String(val));
      if (mV) mV.textContent = val > 0 ? String(val) : T('不限');
    });
  }
}

/* ==================== 启动时自动检查更新 ====================
   每次打开 App 静默比对云端 version.json：
   - 有新版本 → 让 SW 重新拉资源并刷新（controllerchange 里已挂 reload）
   - 无新版本 → 什么都不做
   静默执行，不弹窗打扰。 */
async function autoCheckUpdateOnBoot() {
  try {
    if (!navigator.onLine) return;
    const r = await fetchRemoteVersion();
    if (!r.ok) return;
    const localBuild = (typeof LOCAL_BUILD === 'number') ? LOCAL_BUILD : 0;
    if (r.build <= localBuild) return;   // 已是最新
    /* 有新版本：强刷缓存并让 SW 更新 */
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const reg = window.__swReg || await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
    /* 兜底：若 SW 没触发 controllerchange（例如 SW 曾未注册成功），直接刷新一次。
       ★ 防无限刷新加固：30 秒冷却窗口，跨 reload 用 sessionStorage 记忆，
         避免「云端 build 一直大于本地 → 每次启动都 reload」的死循环。 */
    try {
      const now = Date.now();
      const last = parseInt(sessionStorage.getItem('upd_reload_ts') || '0', 10);
      if (now - last < 30000) return;   // 30 秒内已刷过，不再刷
      sessionStorage.setItem('upd_reload_ts', String(now));
    } catch (e) {}
    setTimeout(() => { location.reload(); }, 1200);
  } catch (e) { /* 静默失败，不打扰用户 */ }
}
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('load', () => { setTimeout(autoCheckUpdateOnBoot, 1500); });

/* ==================== 聊天记录搜索 ==================== */
/* 模式：fuzzy=模糊（子串包含、忽略大小写）；exact=精确（整串完全相等、区分大小写） */
let searchMode = 'fuzzy';
let searchQ = '';

function getSearchMode() { return searchMode === 'exact' ? 'exact' : 'fuzzy'; }

/* 判断一条消息是否命中 */
function searchHit(text, q, mode) {
  if (!text || !q) return -1;
  const src = String(text);
  if (mode === 'exact') {
    // 精确：整段内容与关键词完全相同（区分大小写），或整行等于关键词
    if (src === q) return 0;
    const lines = src.split(/\r?\n/);
    const li = lines.findIndex(L => L.trim() === q);
    return li < 0 ? -1 : 0;
  }
  // 模糊：不区分大小写的子串包含
  return src.toLowerCase().indexOf(q.toLowerCase());
}

/* 生成带高亮的片段（fuzzy 用正则全局标记；exact 整段命中直接全标） */
function buildHitHtml(text, q, mode) {
  const src = String(text || '');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (mode === 'exact') return esc(src).replace(/\r?\n/g, '<br>');
  const ql = q.toLowerCase();
  const lo = src.toLowerCase();
  let out = '';
  let i = 0;
  while (true) {
    const p = lo.indexOf(ql, i);
    if (p < 0) { out += esc(src.slice(i)); break; }
    out += esc(src.slice(i, p));
    out += '<mark>' + esc(src.slice(p, p + q.length)) + '</mark>';
    i = p + q.length;
    if (q.length === 0) break;
  }
  return out.replace(/\r?\n/g, '<br>');
}

/* 取命中附近的片段（长文本截断，围绕首个命中点） */
function hitSnippet(text, q, mode) {
  const src = String(text || '').replace(/\r?\n/g, '\n');
  if (mode === 'exact') return src.length > 160 ? src.slice(0, 160) + '…' : src;
  const p = src.toLowerCase().indexOf(q.toLowerCase());
  if (p < 0) return src.slice(0, 120);
  const start = Math.max(0, p - 40);
  const end = Math.min(src.length, p + q.length + 80);
  return (start > 0 ? '…' : '') + src.slice(start, end) + (end < src.length ? '…' : '');
}

/* 执行搜索，返回分组结果 */
function doSearch(q, mode) {
  const groups = [];
  sessions.forEach(s => {
    // 该会话对应的角色名：优先会话绑定的人设卡，其次当前卡，兜底「AI」
    const bound = (s && s.persona && s.pid) ? getPersonaById(s.pid) : null;
    const cur = getCurPersona();
    const aiName = (bound && bound.name) ? bound.name
                 : ((cur && cur.name) ? cur.name : 'AI');
    const msgs = s.msgs || [];
    const hits = [];
    msgs.forEach((m, idx) => {
      const raw = String(m.content || '');
      if (!raw) return;
      if (searchHit(raw, q, mode) < 0) return;
      hits.push({ idx: idx, role: m.role === 'user' ? T('我') : aiName, text: raw });
    });
    if (hits.length) groups.push({ s: s, hits: hits });
  });
  // 有命中的会话，按最后时间倒序
  groups.sort((a, b) => (b.s.ts || 0) - (a.s.ts || 0));
  return groups;
}

/* 跳转到某会话的某条消息 */
function jumpToMsg(sid, idx) {
  const s = sessions.find(x => x.id === sid);
  if (!s) return;
  closeAllSessSwipe();
  curSid = s.id;
  msgList = s.msgs || [];
  save();
  renderAll();
  renderMsgSessions();
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  const page = $('pageMsg');
  if (page) page.classList.add('active');
  document.querySelectorAll('.tab-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === 'msg');
  });
  document.body.setAttribute('data-tab', 'msg');
  msgMode('chat');
  const ne = $('chatName');
  if (ne) ne.textContent = s.title || T('新对话');
  // 定位并高亮目标消息
  setTimeout(() => {
    const box = $('chat');
    if (!box) return;
    const el = box.querySelector('.msg[data-idx="' + idx + '"]');
    if (!el) { scrollBottom(); return; }
    box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    el.classList.add('msg-flash');
    setTimeout(() => el.classList.remove('msg-flash'), 1200);
  }, 40);
}

/* 渲染搜索结果 */
function renderSearchResults() {
  const box = $('msgSessionList');
  if (!box) return;
  const q = searchQ;
  const page = $('pageMsg');
  if (!q) {
    box.classList.remove('search-results');
    if (page) page.classList.remove('searching');
    renderMsgSessions();
    return;
  }
  if (page) page.classList.add('searching');
  box.classList.add('search-results');
  box.innerHTML = '';

  const mode = getSearchMode();
  const groups = doSearch(q, mode);
  if (!groups.length) {
    const em = document.createElement('div');
    em.className = 'search-empty';
    em.textContent = T('没有找到包含') + '「' + q + '」' + T('的聊天记录');
    box.appendChild(em);
    return;
  }

  let total = 0;
  groups.forEach(g => {
    total += g.hits.length;
    const card = document.createElement('div');
    card.className = 'search-group';

    const head = document.createElement('div');
    head.className = 'search-group-head';
    const nm = document.createElement('span');
    nm.className = 'search-group-name';
    nm.textContent = g.s.title || '新对话';
    const ct = document.createElement('span');
    ct.textContent = g.hits.length + T(' 条');
    head.appendChild(nm);
    head.appendChild(ct);
    card.appendChild(head);

    g.hits.forEach(h => {
      const row = document.createElement('div');
      row.className = 'search-hit';
      const role = document.createElement('div');
      role.className = 'search-hit-role';
      role.textContent = h.role;
      const tx = document.createElement('div');
      tx.className = 'search-hit-text';
      tx.innerHTML = buildHitHtml(hitSnippet(h.text, q, mode), q, mode);
      row.appendChild(role);
      row.appendChild(tx);
      row.onclick = () => jumpToMsg(g.s.id, h.idx);
      card.appendChild(row);
    });
    box.appendChild(card);
  });
}

/* 绑定搜索框交互 */
function bindSearch() {
  const input = $('searchInput');
  const clearB = $('searchClear');
  const sbox = $('searchBox');
  if (!input) return;

  const sync = () => {
    const has = input.value.trim().length > 0;
    if (sbox) sbox.classList.toggle('has-text', has);
  };

  input.addEventListener('input', () => {
    searchQ = input.value.trim();
    sync();
    renderSearchResults();
  });
  input.addEventListener('focus', () => {
    msgMode('list');
  });

  if (clearB) clearB.onclick = () => {
    input.value = '';
    searchQ = '';
    sync();
    renderSearchResults();
    input.focus();
  };

  const fz = $('modeFuzzy');
  const ex = $('modeExact');
  const setMode = m => {
    searchMode = m;
    if (fz) fz.classList.toggle('active', m === 'fuzzy');
    if (ex) ex.classList.toggle('active', m === 'exact');
    if (searchQ) renderSearchResults();
  };
  if (fz) fz.onclick = () => setMode('fuzzy');
  if (ex) ex.onclick = () => setMode('exact');

  sync();
}

/* ============================================================
   字体系统：本地导入（IndexedDB）
   - 在线字体（CDN）功能已移除，只保留本地导入
   - 折叠由现有 #pageMe .drawer-block[data-key] 逻辑接管（data-key="font"）
   ============================================================ */

const K_FONT      = 'pixelspider_font';        // 当前字体 {type:'local', id, family, name}
const FONT_DB     = 'pixelspider_fonts';
const FONT_STORE  = 'fonts';

let _curFont = null;

/* ---------- IndexedDB ---------- */
function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FONT_STORE)) {
        db.createObjectStore(FONT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
function dbPut(rec) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readwrite');
    tx.objectStore(FONT_STORE).put(rec);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
  }));
}
function dbAll() {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readonly');
    const rq = tx.objectStore(FONT_STORE).getAll();
    rq.onsuccess = () => { db.close(); resolve(rq.result || []); };
    rq.onerror   = () => { db.close(); reject(rq.error); };
  }));
}
function dbDel(id) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readwrite');
    tx.objectStore(FONT_STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
  }));
}

/* ---------- 应用/清除字体 ---------- */
function applyFontFamily(family) {
  if (family) {
    document.documentElement.style.setProperty('--app-font', '"' + family + '"');
    // 自定义字体优先，清掉系统/黑体/宋体类名，避免它们抢样式
    document.body.classList.remove('font-hei', 'font-song');
    document.body.classList.add('font-custom');
  } else {
    document.documentElement.style.removeProperty('--app-font');
    document.body.classList.remove('font-custom');
  }
}

/* ---------- 注册本地字体 ---------- */
async function registerLocalFont(item) {
  if (typeof FontFace === 'undefined' ||
      !document.fonts || typeof document.fonts.add !== 'function') return null;
  try {
    const blob   = new Blob([item.buffer], { type: 'font/woff2' });
    const url    = URL.createObjectURL(blob);
    const family = item.id;                       // 用 id 当 family 名，避免中文名兼容问题
    const ff     = new FontFace(family, 'url(' + url + ')');
    await ff.load();
    document.fonts.add(ff);
    return family;
  } catch (e) {
    console.warn('本地字体注册失败', e);
    return null;
  }
}
/* ---------- 渲染列表 ---------- */
// 列表首行固定为「恢复系统默认字体」，点了还原为系统字体
const RESET_FONT_ROW =
  '<div class="font-item font-item-reset" data-font-reset="1">' +
  '<span class="fi-name">恢复系统默认字体</span></div>';

async function renderFontLists() {
  const localBox = $('fontLocalList');
  if (!localBox) return;
  let locals = [];
  try {
    locals = await dbAll();
  } catch (e) {
    localBox.innerHTML = '<div class="font-sub" style="margin:0;color:#cc6b6b">' +
                         '本地储存不可用，无法保存导入的字体</div>';
    return;
  }
  if (!locals.length) {
    localBox.innerHTML = RESET_FONT_ROW + '<div class="font-sub" style="margin:0">还没有导入过字体</div>';
    return;
  }
  localBox.innerHTML = RESET_FONT_ROW + locals.map(l => {
    const on = _curFont && _curFont.type === 'local' && _curFont.id === l.id;
    return '<div class="font-item' + (on ? ' active' : '') +
           '" data-font-type="local" data-font-id="' + l.id + '">' +
           '<span class="fi-name">' + l.name + '</span>' +
           '<span class="font-item-del" data-font-del="' + l.id + '">×</span></div>';
  }).join('');
}

/* ---------- 当前字体提示 ---------- */
function refreshFontHint() {
  const el = $('fontCurName');
  if (!el) return;
  if (!_curFont) {
    // 没有自定义字体 → 显示系统/黑体/宋体
    const t = (typeof getFontType === 'function') ? getFontType() : 'system';
    el.textContent = T(t === 'hei' ? '黑体' : (t === 'song' ? '宋体' : '系统字体'));
    return;
  }
  if (_curFont && _curFont.type === 'local') {
    el.textContent = T(_curFont.name || '本地字体');
  }
}

/* ---------- 选择：本地 ---------- */
async function pickLocal(id) {
  let locals = [];
  try { locals = await dbAll(); } catch (e) { return; }
  const item = locals.find(l => l.id === id);
  if (!item) return;
  const family = await registerLocalFont(item);
  if (!family) { showAlert(T('这台设备不支持本地字体注册')); return; }
  _curFont = { type:'local', id:item.id, name:item.name, family };
  try { LS.set(K_FONT, JSON.stringify(_curFont)); } catch (e) {}
  applyFontFamily(family);
  refreshFontHint();
  renderFontLists();
}

/* ---------- 还原 ---------- */
function resetFont() {
  _curFont = null;
  try { LS.del(K_FONT); } catch (e) {}
  applyFontFamily(null);
  refreshFontHint();
  renderFontLists();
}

/* ---------- 导入本地字体 ---------- */
function importLocalFont(file) {
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, '');
  const id   = 'lf_' + Date.now();
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await dbPut({ id, name, buffer: reader.result, ts: Date.now() });
      await renderFontLists();
      showAlert(T('已导入：') + name + T('，点它即应用'));
    } catch (e) {
      showAlert(T('保存失败：本地储存不可用'));
    }
  };
  reader.onerror = () => showAlert(T('读取文件失败'));
  reader.readAsArrayBuffer(file);
}

/* ---------- 启动恢复 ---------- */
async function initFonts() {
  try {
    const raw = LS.get(K_FONT);
    if (raw) _curFont = JSON.parse(raw);
  } catch (e) { _curFont = null; }

  // 旧版本可能存过 online 记录，直接丢弃
  if (_curFont && _curFont.type !== 'local') _curFont = null;

  if (_curFont && _curFont.type === 'local') {
    let locals = [];
    try { locals = await dbAll(); } catch (e) { locals = []; }
    const item = locals.find(l => l.id === _curFont.id);
    if (item) {
      const family = await registerLocalFont(item);
      if (family) applyFontFamily(family);
    }
  }

  refreshFontHint();
  renderFontLists();
}
/* ---------- 事件绑定 ---------- */
function bindFontEvents() {
  // 1) 可收纳入口：点整行展开/收起
  const head = $('fontFoldHead');
  if (head && !head._foldBound) {
    head._foldBound = true;
    head.addEventListener('click', () => {
      const fold = $('fontFold');
      if (fold) fold.classList.toggle('open');
    });
  }


  // 2) 列表点击（事件委托，挂在「个性装扮」页上）
  const page = $('skinPage') || $('pageMe');
  if (page && !page._fontBound) {
    page._fontBound = true;
    page.addEventListener('click', e => {
      const del = e.target.closest('[data-font-del]');
      if (del) {
        e.stopPropagation();
        const id = del.getAttribute('data-font-del');
        askConfirm(T('删除这个本地字体？'), T('字体'), async () => {
          try { await dbDel(id); } catch (err) {}
          if (_curFont && _curFont.type === 'local' && _curFont.id === id) resetFont();
          else renderFontLists();
        });
        return;
      }
      const item = e.target.closest('.font-item');
      if (item) {
        // 「恢复系统默认字体」行
        if (item.getAttribute('data-font-reset')) {
          resetFont();
          return;
        }
        const type = item.getAttribute('data-font-type');
        const id   = item.getAttribute('data-font-id');
        if (type === 'local') pickLocal(id);
        // 选完自动收起，回到那一行显示新字体名
        const fold = $('fontFold');
        if (fold) fold.classList.remove('open');
      }
    });
  }

  const btn   = $('fontImportBtn');
  const input = $('fontFileInput');
  if (btn && input && !btn._fontBound) {
    btn._fontBound = true;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) {
        importLocalFont(input.files[0]);
        input.value = '';
      }
    });
  }
}

/* ================================================================
   账号系统（Supabase）
   - 登录/注册页：未登录全屏覆盖；成功或「本地试用」后 .hide
   - 会话保持：supabase-js 自动把会话写 localStorage，刷新免登录
   - 云同步：聊天记录 / 人设卡（下一阶段接入）
   ================================================================ */

/* Supabase 连接信息（publishable key 可公开，安全） */
const SUPA_URL  = 'https://mdkvbklgkmwtfscderrc.supabase.co';
const SUPA_KEY  = 'sb_publishable_wEkcbhub490eMfIdC2Q43A_Mu46ucQr';
const K_SKIP_AUTH = 'pixelspider_skipauth';   // 用户选了「本地试用」时置 1
const K_KNOWN_EMAILS = 'pixelspider_known_emails';  // 登录过的邮箱列表(JSON数组)
const K_SAVED_PWD    = 'pixelspider_saved_pwd';     // {邮箱:密码} 仅记住密码开启时写
const K_REMEMBER_PWD = 'pixelspider_remember_pwd';  // '1' = 记住密码开关
const PWD_MIN = 6, PWD_MAX = 15;                    // 密码长度区间

let sb = null;                 // supabase client
let curUser = null;            // 当前登录用户（null = 未登录）

/* 初始化 supabase 客户端（lib/supabase.js 挂在 window.supabase） */
function initSupabase() {
  try {
    if (!window.supabase || !window.supabase.createClient) {
      console.warn('[auth] supabase 库未加载');
      return null;
    }
    sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    return sb;
  } catch (e) {
    console.warn('[auth] 初始化失败', e);
    return null;
  }
}

/* ---------- 页面元素快捷获取 ---------- */
function authEls() {
  return {
    wrap:    $('authWrap'),
    tabLogin:$('tabLogin'),
    tabReg:  $('tabReg'),
    email:   $('authEmail'),
    emailDrop: $('authEmailDrop'),
    pwd:     $('authPwd'),
    pwdEye:  $('authPwdEye'),
    pwd2:    $('authPwd2'),
    pwd2Eye: $('authPwd2Eye'),
    pwd2F:   $('authPwd2Field'),
    remember:$('authRemember'),
    forgot:  $('authForgot'),
    msg:     $('authMsg'),
    submit:  $('authSubmit'),
    title:   $('authTitle'),
    sub:     $('authSub'),
    footText:$('authFootText'),
    switchA: $('authSwitch'),
    skip:    $('authSkip')
  };
}

/* ---------- 本地邮箱 / 密码存储 ---------- */
function getKnownEmails() {
  try {
    const a = JSON.parse(LS.get(K_KNOWN_EMAILS) || '[]');
    return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x) : [];
  } catch (e) { return []; }
}
function addKnownEmail(email) {
  if (!email) return;
  try {
    let a = getKnownEmails().filter(x => x !== email);
    a.unshift(email);
    LS.set(K_KNOWN_EMAILS, JSON.stringify(a.slice(0, 8)));
  } catch (e) {}
}
function getSavedPwdMap() {
  try {
    const o = JSON.parse(LS.get(K_SAVED_PWD) || '{}');
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}
function setSavedPwd(email, pwd) {
  if (!email) return;
  try {
    const m = getSavedPwdMap();
    if (pwd) m[email] = pwd; else delete m[email];
    LS.set(K_SAVED_PWD, JSON.stringify(m));
  } catch (e) {}
}
function rememberOn() {
  try { return LS.get(K_REMEMBER_PWD) === '1'; } catch (e) { return false; }
}
function setRememberOn(on) {
  try {
    LS.set(K_REMEMBER_PWD, on ? '1' : '0');
    if (!on) LS.set(K_SAVED_PWD, '{}');
  } catch (e) {}
}

/* 密码眼睛：绑定一对 input + 按钮 */
function bindEye(btn, input) {
  if (!btn || !input || btn._bound) return;
  btn._bound = true;
  const S_CLOSED = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3.5 12.5c2.4 2.6 5.3 3.9 8.5 3.9s6.1-1.3 8.5-3.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4.6 5.4l14.8 13.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const S_OPEN   = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M1.8 12S5.6 5.5 12 5.5 22.2 12 22.2 12 18.4 18.5 12 18.5 1.8 12 1.8 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.1" fill="currentColor"/></svg>';
  const paint = (show) => {
    btn.classList.toggle('on', show);
    btn.innerHTML = show ? S_OPEN : S_CLOSED;
    btn.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  };
  paint(input.type !== 'password');
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    paint(show);
    try { input.focus(); } catch (e) {}
  });
}

/* 邮箱历史下拉 */
function renderEmailDrop(filter) {
  const e = authEls();
  if (!e.emailDrop) return;
  const kw = (filter || '').trim().toLowerCase();
  let list = getKnownEmails();
  if (kw) list = list.filter(x => x.toLowerCase().indexOf(kw) >= 0);
  if (!list.length) { e.emailDrop.classList.add('hide'); e.emailDrop.innerHTML = ''; return; }
  e.emailDrop.innerHTML = list.map(x => {
    const mail = String(x).replace(/"/g, '&quot;');
    const safeTxt = String(x).replace(/</g, '&lt;');
    return '<div class="auth-email-item" data-mail="' + mail + '">'
      + '<span class="mail-ic">✉</span>'
      + '<span class="auth-email-txt">' + safeTxt + '</span>'
      + '<span class="auth-email-del" data-del="' + mail + '" aria-label="删除此邮箱">✕</span>'
      + '</div>';
  }).join('');
  e.emailDrop.classList.remove('hide');
  Array.prototype.forEach.call(e.emailDrop.querySelectorAll('.auth-email-item'), it => {
    it.addEventListener('mousedown', ev => {
      ev.preventDefault();
      const t = ev.target;
      if (t && t.classList && t.classList.contains('auth-email-del')) {
        delKnownEmail(t.getAttribute('data-del'));
        return;
      }
      pickEmail(it.getAttribute('data-mail'));
    });
  });
}
/* 从历史邮箱中删除一个：同时清掉它的记住密码 */
function delKnownEmail(email) {
  if (!email) return;
  try {
    const a = getKnownEmails().filter(x => x !== email);
    LS.set(K_KNOWN_EMAILS, JSON.stringify(a.slice(0, 8)));
    const m = getSavedPwdMap();
    if (m[email]) { delete m[email]; LS.set(K_SAVED_PWD, JSON.stringify(m)); }
  } catch (e) {}
  const e2 = authEls();
  if (e2.email) renderEmailDrop(e2.email.value);
}
function hideEmailDrop() {
  const e = authEls();
  if (e.emailDrop) { e.emailDrop.classList.add('hide'); e.emailDrop.innerHTML = ''; }
}
/* 选中一个历史邮箱：填邮箱 +（若记住密码）填对应密码 */
function pickEmail(email) {
  const e = authEls();
  if (!e.email || !email) return;
  e.email.value = email;
  const m = getSavedPwdMap();
  if (rememberOn() && m[email] && e.pwd) {
    e.pwd.value = m[email];
  }
  hideEmailDrop();
  setAuthMsg('');
}

/* 切换 登录/注册 界面 */
function setAuthMode(mode) {
  authMode = mode;
  const e = authEls();
  if (!e.wrap) return;
  if (mode === 'login') {
    e.tabLogin.classList.add('active');
    e.tabReg.classList.remove('active');
    e.pwd2F.style.display = 'none';
    e.submit.textContent = '登录';
    e.title.textContent = '登录蛛丝';
    e.footText.textContent = '还没有账号？';
    e.switchA.textContent = '去注册';
  } else {
    e.tabReg.classList.add('active');
    e.tabLogin.classList.remove('active');
    e.pwd2F.style.display = '';
    e.submit.textContent = '注册';
    e.title.textContent = '注册蛛丝';
    e.footText.textContent = '已有账号？';
    e.switchA.textContent = '去登录';
  }
  setAuthMsg('');
}

/* 显示提示信息（ok=true 时绿色） */
function setAuthMsg(text, ok) {
  const e = authEls();
  if (!e.msg) return;
  e.msg.textContent = text || '';
  e.msg.className = 'auth-msg' + (ok ? ' ok' : '');
}

/* 显示 / 隐藏登录页 */
function showAuth() {
  const e = authEls();
  if (e.wrap) e.wrap.classList.remove('hide');
}
function hideAuth() {
  const e = authEls();
  if (e.wrap) e.wrap.classList.add('hide');
}
/* 启动遮罩收口：initAuth 判定完成后调用，淡出并移除，露出真正该显示的界面。
   注意：必须在 showAuth/hideAuth 之后调用，确保登录页状态已切换好。 */
function bootMaskDone() {
  var m = document.getElementById('bootMask');
  if (!m) return;
  m.style.opacity = '0';
  setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, 220);
}

/* 提交（登录或注册） */
async function authSubmit() {
  const e = authEls();
  if (!sb) { setAuthMsg('网络组件未就绪，请重开 App'); return; }

  const email = (e.email.value || '').trim();
  const pwd   = e.pwd.value || '';

  if (!email || email.indexOf('@') < 0) { setAuthMsg('请输入正确的邮箱'); return; }
  if (pwd.length < PWD_MIN) { setAuthMsg('密码至少 ' + PWD_MIN + ' 位'); return; }
  if (pwd.length > PWD_MAX) { setAuthMsg('密码最多 ' + PWD_MAX + ' 位'); return; }

  if (authMode === 'register') {
    if (pwd !== (e.pwd2.value || '')) { setAuthMsg('两次输入的密码不一致'); return; }
  }

  e.submit.disabled = true;
  setAuthMsg(authMode === 'login' ? '登录中…' : '注册中…', true);

  try {
    if (authMode === 'login') {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });
      if (error) throw error;
      curUser = data.user;
      addKnownEmail(email);
      if (rememberOn()) setSavedPwd(email, pwd);
      onAuthSuccess();
    } else {
      const { data, error } = await sb.auth.signUp({ email, password: pwd });
      if (error) throw error;
      addKnownEmail(email);
      if (data.session) {
        curUser = data.user;
        if (rememberOn()) setSavedPwd(email, pwd);
        setAuthMsg('注册成功，正在进入…', true);
        onAuthSuccess();
      } else {
        setAuthMsg('注册成功！请到邮箱点确认链接后再登录', true);
        setAuthMode('login');
      }
    }
  } catch (err) {
    setAuthMsg(translateAuthErr(err && err.message ? err.message : String(err)));
  } finally {
    e.submit.disabled = false;
  }
}

/* 把 Supabase 英文报错翻成人话 */
function translateAuthErr(m) {
  const s = String(m);
  if (/Invalid login credentials/i.test(s))   return '邮箱或密码不对';
  if (/User already registered/i.test(s))     return '这个邮箱已经注册过了，直接登录吧';
  if (/Password should be at least/i.test(s)) return '密码至少 ' + PWD_MIN + ' 位';
  if (/Unable to validate email/i.test(s))    return '邮箱格式不对';
  if (/Email not confirmed/i.test(s))         return '邮箱还没确认，请先到邮箱点确认链接';
  if (/rate limit|too many|For security purposes/i.test(s)) return '操作太频繁，稍等一会儿再试';
  if (/fetch|network|Failed to fetch/i.test(s)) return '网络连不上服务器，检查网络后重试';
  if (/same as the old password|should be different/i.test(s)) return '新密码不能和旧密码一样';
  return s;
}

/* 登录成功后：隐藏登录页、记录用户、进入 App（并触发云同步） */
function onAuthSuccess() {
  try { LS.del(K_SKIP_AUTH); } catch (e) {}
  try { if (curUser) console.log('[auth] 已登录', curUser.email); } catch (e) {}
  // ✅ 多账号隔离：先把当前作用域切到该账号（首次登录会把 :local 数据复制过去），
  // 切换后 reload，让内存变量（sessions/personas/profile）从新作用域重新加载。
  var uid = curUser && curUser.id;
  if (uid && getAccScopeUid() !== uid) {
    try { migrateLocalToAccount(uid); } catch (e) {}
    setAccScope(uid);
    if (authScopeReloadOK()) { try { location.reload(); } catch (e) {} return; }
    /* 5 秒内已因切作用域刷过 → 不再刷，直接继续进入 App（防止死循环） */
  }
  hideAuth();
  if (typeof onCloudLogin === 'function') { try { onCloudLogin(); } catch (e) {} }
}

/* ================= 修改密码（甲：登录后改） ================= */
let pwdScene = 'change';   // 'change'=登录后改密码 | 'forgot'=忘记密码（先发邮件）

function pwdEls() {
  return {
    wrap:  $('pwdWrap'),
    sub:   $('pwdSub'),
    emailF:$('pwdEmailField'),
    email: $('pwdEmail'),
    old:   $('pwdOld'),
    oldEye:$('pwdOldEye'),
    nw:    $('pwdNew'),
    nwEye: $('pwdNewEye'),
    nw2:   $('pwdNew2'),
    nw2Eye:$('pwdNew2Eye'),
    msg:   $('pwdMsg'),
    submit:$('pwdSubmit'),
    back:  $('pwdBack')
  };
}
function setPwdMsg(t, ok) {
  const p = pwdEls();
  if (!p.msg) return;
  p.msg.textContent = t || '';
  p.msg.className = 'auth-msg' + (ok ? ' ok' : '');
}
function pwdFieldOf(el) { return el ? el.parentNode : null; }

function openPwd(scene) {
  pwdScene = scene || 'change';
  const p = pwdEls();
  if (!p.wrap) return;
  setPwdMsg('');
  if (p.old) p.old.value = '';
  if (p.nw) p.nw.value = '';
  if (p.nw2) p.nw2.value = '';
  if (p.email) p.email.value = '';
  const fOld = pwdFieldOf(p.old), fNw = pwdFieldOf(p.nw), fNw2 = pwdFieldOf(p.nw2);
  if (pwdScene === 'forgot') {
    if (p.sub) p.sub.textContent = '输入注册时用的邮箱，点确认后我们会给你发一封重置邮件';
    if (p.emailF) p.emailF.style.display = '';
    if (p.submit) p.submit.textContent = '发送重置邮件';
    if (fOld) fOld.style.display = 'none';
    if (fNw) fNw.style.display = 'none';
    if (fNw2) fNw2.style.display = 'none';
  } else {
    if (p.sub) p.sub.textContent = '输入旧密码，设置新密码（' + PWD_MIN + '-' + PWD_MAX + ' 位）';
    if (p.emailF) p.emailF.style.display = 'none';
    if (p.submit) p.submit.textContent = '确认修改';
    if (fOld) fOld.style.display = '';
    if (fNw) fNw.style.display = '';
    if (fNw2) fNw2.style.display = '';
  }
  p.wrap.classList.remove('hide');
}
function closePwd() {
  const p = pwdEls();
  if (p.wrap) p.wrap.classList.add('hide');
  setPwdMsg('');
}

/* 提交修改密码页 */
async function pwdSubmitHandler() {
  const p = pwdEls();
  if (!sb) { setPwdMsg('网络组件未就绪，请重开 App'); return; }

  /* ---- 场景一：忘记密码 → 发重置邮件 ---- */
  if (pwdScene === 'forgot') {
    const email = (p.email.value || '').trim();
    if (!email || email.indexOf('@') < 0) { setPwdMsg('请输入正确的邮箱'); return; }
    p.submit.disabled = true;
    setPwdMsg('发送中…', true);
    try {
      const redirectTo = location.origin + location.pathname;
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setPwdMsg('重置邮件已发送到 ' + email + '，请去邮箱点里面的链接', true);
    } catch (err) {
      setPwdMsg(translateAuthErr(err && err.message ? err.message : String(err)));
    } finally {
      p.submit.disabled = false;
    }
    return;
  }

  /* ---- 场景二：登录后改密码（旧密码换新密码） ---- */
  const oldPwd = p.old.value || '';
  const newPwd = p.nw.value || '';
  const newPwd2= p.nw2.value || '';

  if (!curUser || !curUser.email) { setPwdMsg('请先登录'); return; }
  if (!oldPwd) { setPwdMsg('请输入旧密码'); return; }
  if (newPwd.length < PWD_MIN) { setPwdMsg('新密码至少 ' + PWD_MIN + ' 位'); return; }
  if (newPwd.length > PWD_MAX) { setPwdMsg('新密码最多 ' + PWD_MAX + ' 位'); return; }
  if (newPwd !== newPwd2) { setPwdMsg('两次输入的新密码不一致'); return; }
  if (newPwd === oldPwd)  { setPwdMsg('新密码不能和旧密码一样'); return; }

  p.submit.disabled = true;
  setPwdMsg('验证中…', true);
  try {
    const { error: e1 } = await sb.auth.signInWithPassword({ email: curUser.email, password: oldPwd });
    if (e1) throw e1;
    const { error: e2 } = await sb.auth.updateUser({ password: newPwd });
    if (e2) throw e2;
    if (rememberOn()) setSavedPwd(curUser.email, newPwd);
    setPwdMsg('密码修改成功！', true);
    if (typeof showAlert === 'function') showAlert('密码已修改成功，下次请用新密码登录', '修改密码');
    setTimeout(() => { closePwd(); }, 900);
  } catch (err) {
    setPwdMsg(translateAuthErr(err && err.message ? err.message : String(err)));
  } finally {
    p.submit.disabled = false;
  }
}

/* ================= 邮件找回链接跳回后：设置新密码 ================= */
function hasRecoveryToken() {
  try {
    const h = location.hash || '';
    const q = location.search || '';
    if (/access_token=|error_description=/.test(h)) {
      return /type=recovery/.test(h) || /type=recovery/.test(q);
    }
  } catch (e) {}
  return false;
}

/* 绑定修改密码页交互 */
function bindPwdPage() {
  const p = pwdEls();
  if (!p.wrap || p.wrap._bound) return;
  p.wrap._bound = true;
  bindEye(p.oldEye, p.old);
  bindEye(p.nwEye,  p.nw);
  bindEye(p.nw2Eye, p.nw2);
  if (p.submit) p.submit.addEventListener('click', pwdSubmitHandler);
  if (p.back)   p.back.addEventListener('click', closePwd);
  if (p.email) {
    p.email.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); pwdSubmitHandler(); } });
  }
  [p.old, p.nw, p.nw2].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); pwdSubmitHandler(); } });
  });
}

/* 绑定登录页交互 */
function bindAuth() {
  const e = authEls();
  if (!e.wrap || e.wrap._bound) return;
  e.wrap._bound = true;

  e.tabLogin.addEventListener('click', () => setAuthMode('login'));
  e.tabReg.addEventListener('click',   () => setAuthMode('register'));
  e.switchA.addEventListener('click',  () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
  e.submit.addEventListener('click', authSubmit);

  // 回车即提交
  [e.email, e.pwd, e.pwd2].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); authSubmit(); }
    });
  });

  // 密码眼睛
  bindEye(e.pwdEye, e.pwd);
  bindEye(e.pwd2Eye, e.pwd2);

  // 记住密码开关
  if (e.remember) {
    e.remember.checked = rememberOn();
    e.remember.addEventListener('change', () => {
      setRememberOn(!!e.remember.checked);
      if (e.remember.checked) setAuthMsg('已开启：本机会记住邮箱和密码', true);
      else setAuthMsg('已关闭：本机不再保存密码', true);
    });
  }

  // 邮箱历史下拉
  if (e.email) {
    e.email.addEventListener('focus', () => renderEmailDrop(e.email.value));
    e.email.addEventListener('click', () => renderEmailDrop(e.email.value));
    e.email.addEventListener('input', () => renderEmailDrop(e.email.value));
  }
  document.addEventListener('click', ev => {
    if (!e.emailDrop) return;
    if (e.email && e.email.contains(ev.target)) return;
    if (e.emailDrop.contains(ev.target)) return;
    hideEmailDrop();
  });

  // 忘记密码
  if (e.forgot) e.forgot.addEventListener('click', ev => { ev.preventDefault(); openPwd('forgot'); });

  // 「本地试用」：不登录直接用（数据只在本地）
  e.skip.addEventListener('click', () => {
    try { LS.set(K_SKIP_AUTH, '1'); } catch (err) {}
    hideAuth();
  });

  bindPwdPage();
}

/* 启动时的账号检查：
   - 有已保存的 session → 直接进 App
   - 用户上次选了「本地试用」→ 进 App（登录页不拦）
   - 都没有 → 显示登录页 */
async function initAuth() {
  bindAuth();
  bindPwdPage();
  if (!initSupabase()) {
    hideAuth();
    bootMaskDone();
    return;
  }

  /* 从「重置密码邮件」跳回来：URL 带 type=recovery */
  if (hasRecoveryToken()) {
    hideAuth();
    bootMaskDone();
    setTimeout(() => { openPwd('change'); }, 300);
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    return;
  }

  // 先看本地是否已有会话（刷新免登录）
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session && data.session.user) {
      curUser = data.session.user;
      var uid0 = curUser.id;
      if (uid0 && getAccScopeUid() !== uid0) {
        try { migrateLocalToAccount(uid0); } catch (e) {}
        setAccScope(uid0);
        if (authScopeReloadOK()) { try { location.reload(); } catch (e) {} return; }
        /* 5 秒内已因切作用域刷过 → 不再刷，直接进入 App（防止死循环） */
      }
      hideAuth();
      if (typeof onCloudLogin === 'function') { try { onCloudLogin(); } catch (e) {} }
      bootMaskDone();
      return;
    }
  } catch (e) {}

  // 没有会话：看用户是否选过「本地试用」
  if (LS.get(K_SKIP_AUTH) === '1') {
    hideAuth();
    bootMaskDone();
    return;
  }

  setAuthMode('login');
  showAuth();
  bootMaskDone();
}

/* ================================================================
   云同步模块（第二阶）
   - 开关：聊天记录 / 人设卡 各自独立（云端同步抽屉块）
   - 上传白名单：只挑指定字段，API Key 等敏感数据物理不入上传对象
   - 增量：聊天记录按 session_id+role+ts 去重；人设卡按 id upsert
   - 离线兜底：本地永远保留一份，断网不丢
   ================================================================ */

const K_CLOUD_ON   = 'pixelspider_cloud_on';    // '1' = 登录用户已启用云同步
const K_SYNC_CHATS = 'pixelspider_sync_chats';   // '1' = 聊天记录同步
const K_SYNC_PS    = 'pixelspider_sync_personas';// '1' = 人设卡同步
const K_SYNC_PF    = 'pixelspider_sync_profile'; // '1' = 个人资料同步
const K_CLAIMED    = 'pixelspider_cloud_claimed';// '1' = 旧本地数据已认领
/* ===== 多账号隔离（第4批）===== */
/* 当前作用域对应的 uid（null = 未登录 :local） */
function getAccScopeUid() {
  return (ACC_SCOPE && ACC_SCOPE.indexOf(':u-') === 0) ? ACC_SCOPE.slice(3) : null;
}

/* 【安全网】账号作用域切换 reload 守卫。
   scope 已持久化（setAccScope 写入 K_ACC_SCOPE），正常情况下切换后
   下次加载 getAccScopeUid() 就与 uid 相等，不该再 reload。
   但为防任何边界情况（session 与本地 scope 短暂不一致等）造成无限刷新，
   这里用 sessionStorage 记住上次因「切作用域」而 reload 的时间，
   5 秒内只允许刷一次；超过则放行。 */
function authScopeReloadOK() {
  try {
    var now = Date.now();
    var last = parseInt(sessionStorage.getItem('acc_scope_reload_ts') || '0', 10);
    if (now - last < 5000) return false;     // 5 秒冷却，拒绝重复刷新
    sessionStorage.setItem('acc_scope_reload_ts', String(now));
    return true;
  } catch (e) {
    return true;   // sessionStorage 不可用时放行，不阻塞正常流程
  }
}


/* 首次登录：把 :local 现存数据复制到 :u-<uid>（:local 保留不动） */
function migrateLocalToAccount(uid) {
  if (!uid) return;
  var lockKey = 'pixelspider_migrated_' + uid;
  try { if (LS.rawGet(lockKey) === '1') return; } catch (e) {}
  var targets = [];
  ACC_PREFIX_KEYS.forEach(function (p) {
    var isPrefix = p.charAt(p.length - 1) === '_';
    if (!isPrefix) {
      targets.push(p);
      return;
    }
    // 前缀族：遍历所有真实键找匹配者
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(p) === 0) targets.push(k);
    }
  });
  var n = 0;
  targets.forEach(function (k) {
    var from = k + ':local';
    var to   = k + ':u-' + uid;
    try {
      var v = LS.rawGet(from);
      if (v === null) return;              // 本地没有就不复制
      if (LS.rawGet(to) !== null) return;  // 目标已有不覆盖
      LS.rawSet(to, v); n++;
    } catch (e) {}
  });
  try { LS.rawSet(lockKey, '1'); } catch (e) {}
  console.log('[acc] 迁移到 ' + uid + '：复制 ' + n + ' 个键');
}

/* 账号级云认领锁（按 uid 记忆） */
function accClaimKey() {
  var u = getAccScopeUid();
  return u ? ('pixelspider_cloud_claimed:u-' + u) : K_CLAIMED;
}

let cloudBusy = false;       // 防重入
let cloudLastPush = 0;

function cloudOn(k) { return LS.get(k) === '1'; }
function cloudSet(k, v) { try { LS.set(k, v ? '1' : '0'); } catch (e) {} }

/* 抽屉 UI 刷新 */
function refreshCloudUI() {
  const dot  = $('cloudAcctDot'), txt = $('cloudAcctText'), btn = $('cloudSignBtn'), pwdBtn = $('cloudPwdBtn');
  const tc   = $('cloudToggleChats'), tp = $('cloudTogglePersonas');
  const tf   = $('cloudToggleProfile');
  const onChats = cloudOn(K_SYNC_CHATS), onPs = cloudOn(K_SYNC_PS), onPf = cloudOn(K_SYNC_PF);
  if (tc) { tc.dataset.on = onChats ? '1' : '0'; tc.textContent = onChats ? '同步中' : '仅本地'; }
  if (tp) { tp.dataset.on = onPs ? '1' : '0'; tp.textContent = onPs ? '同步中' : '仅本地'; }
  if (tf) { tf.dataset.on = onPf ? '1' : '0'; tf.textContent = onPf ? '同步中' : '仅本地'; }
  if (curUser) {
    if (pwdBtn) pwdBtn.style.display = '';
    if (dot) dot.classList.add('on');
    if (txt) txt.textContent = curUser.email || '已登录';
    if (btn) btn.textContent = '退出';
  } else {
    if (dot) dot.classList.remove('on');
    if (txt) txt.textContent = '未登录';
    if (btn) btn.textContent = '登录';
    if (pwdBtn) pwdBtn.style.display = 'none';
  }
}

/* ---------- 上传：聊天记录 ---------- */
async function cloudPushChats() {
  if (!sb || !curUser) return { ok: false, err: '未登录' };
  const uid = curUser.id;
  // 白名单：只取这 4 个字段，localStorage 里其它任何键都不碰
  const rows = [];
  (sessions || []).forEach(s => {
    (s.msgs || []).forEach(m => {
      rows.push({
        user_id: uid,
        session_id: String(s.id),
        role: String(m.role || 'user'),
        content: String(m.content || ''),
        ts: Number(m.ts) || Date.now(),
        title: String(s.title || ''),
        persona: String(s.persona || ''),
        pid: String(s.pid || '')
      });
    });
  });
  if (!rows.length) return { ok: true, n: 0 };
  // 分批插入，避免单次过大
  const CHUNK = 300;
  let ok = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const { error } = await sb.from('chats').upsert(part, { onConflict: 'user_id,session_id,role,ts' });
    if (error) return { ok: false, err: error.message };
    ok += part.length;
  }
  return { ok: true, n: ok };
}

/* ---------- 上传：人设卡 ---------- */
async function cloudPushPersonas() {
  if (!sb || !curUser) return { ok: false, err: '未登录' };
  const uid = curUser.id;
  const list = (typeof getPersonas === 'function') ? getPersonas() : [];
  const rows = list.filter(p => p && p.id).map((p, i) => ({
    user_id: uid,
    id: String(p.id),
    name: String(p.name || '未命名'),
    prompt: String(p.prompt || ''),
    builtin: !!p.builtin,
    sort: i
  }));
  if (!rows.length) return { ok: true, n: 0 };
  const { error } = await sb.from('personas').upsert(rows, { onConflict: 'user_id,id' });
  if (error) return { ok: false, err: error.message };
  return { ok: true, n: rows.length };
}

/* ---------- 下载：聊天记录（合并进本地） ---------- */
async function cloudPullChats() {
  if (!sb || !curUser) return { ok: false, err: '未登录' };
  const { data, error } = await sb.from('chats').select('*').order('ts', { ascending: true });
  if (error) return { ok: false, err: error.message };
  const byId = new Map((sessions || []).map(s => [String(s.id), s]));
  let added = 0;
  (data || []).forEach(r => {
    const sid = String(r.session_id);
    let s = byId.get(sid);
    if (!s) {
      s = { id: sid, title: String(r.title || '') || '云端会话', msgs: [], ts: Number(r.ts) || Date.now() };
      if (r.persona) s.persona = String(r.persona);
      if (r.pid) s.pid = String(r.pid);
      byId.set(sid, s);
      sessions.push(s);
    } else {
      // 本地已有会话：若本地标题还是占位，尝试用云端真名补上
      if ((!s.title || s.title === '云端会话') && r.title) s.title = String(r.title);
      if (!s.persona && r.persona) s.persona = String(r.persona);
      if (!s.pid && r.pid) s.pid = String(r.pid);
    }
    const have = new Set((s.msgs || []).map(m => (m.role || '') + '|' + (Number(m.ts) || 0)));
    const key = (r.role || '') + '|' + (Number(r.ts) || 0);
    if (!have.has(key)) {
      s.msgs.push({ role: r.role, content: r.content, ts: Number(r.ts) || Date.now() });
      added++;
    }
  });
  sessions.forEach(s => { if (s.msgs) s.msgs.sort((a, b) => (a.ts || 0) - (b.ts || 0)); });
  try { persist(); } catch (e) {}
  return { ok: true, n: added };
}

/* ---------- 上传：个人资料（单行，按 user_id upsert） ---------- */
async function cloudPushProfile() {
  if (!sb || !curUser) return { ok: false, err: '未登录' };
  const uid = curUser.id;
  const p = (typeof getProfile === 'function') ? getProfile() : {};
  // 白名单：取 PROFILE_FIELDS 全部文字字段；头像/头像开关不参与云同步
  const row = { user_id: uid };
  PROFILE_FIELDS.forEach(f => { row[f.key] = String(p[f.key] || ''); });
  row.updated_at = new Date().toISOString();
  const { error } = await sb.from('profiles').upsert(row, { onConflict: 'user_id' });
  if (error) return { ok: false, err: error.message };
  return { ok: true, n: 1 };
}

/* ---------- 下载：个人资料（云端有则覆盖本地，云端无则不动） ---------- */
async function cloudPullProfile() {
  if (!sb || !curUser) return { ok: false, err: '未登录' };
  const { data, error } = await sb.from('profiles').select('*').eq('user_id', curUser.id).maybeSingle();
  if (error) return { ok: false, err: error.message };
  if (!data) return { ok: true, n: 0 };             // 云端还没建过 → 不覆盖本地
  const cur = (typeof getProfile === 'function') ? getProfile() : {};
  const p = {};
  // 只覆盖 PROFILE_FIELDS 全部文字字段；头像与头像开关完全保留本地
  PROFILE_FIELDS.forEach(f => { p[f.key] = String(data[f.key] || ''); });
  p.avatar = String(cur.avatar || '');
  p.showAvatar = (typeof cur.showAvatar === 'boolean') ? cur.showAvatar : true;
  try { LS.set(K_PROFILE, JSON.stringify(p)); } catch (e) {}
  try { if (typeof loadProfileToForm === 'function') loadProfileToForm(); } catch (e) {}
  try { if (typeof refreshAvatarUI === 'function') refreshAvatarUI(); } catch (e) {}
  try { if (typeof refreshProfileSub === 'function') refreshProfileSub(); } catch (e) {}
  try { if (typeof renderAll === 'function') renderAll(); } catch (e) {}
  return { ok: true, n: 1 };
}

/* ---------- 下载：人设卡（合并进本地，按 id 去重） ---------- */
async function cloudPullPersonas() {
  if (!sb || !curUser) return { ok: false, err: '未登录' };
  const { data, error } = await sb.from('personas').select('*').order('sort', { ascending: true });
  if (error) return { ok: false, err: error.message };
  const local = (typeof getPersonas === 'function') ? getPersonas() : [];
  const byId = new Map(local.map(p => [String(p.id), p]));
  let added = 0;
  (data || []).forEach(r => {
    const id = String(r.id);
    if (!byId.has(id)) {
      byId.set(id, { id, name: r.name, prompt: r.prompt, builtin: !!r.builtin });
      added++;
    }
  });
  const merged = Array.from(byId.values());
  if (typeof savePersonas === 'function') savePersonas(merged);
  return { ok: true, n: added };
}

/* ---------- 首次登录：把旧本地数据认领给当前账号 ---------- */
async function cloudClaimLocalOnce() {
  if (!sb || !curUser) return;
  var _ck = accClaimKey();
  if (cloudOn(_ck)) return;
  try {
    const n1 = (await cloudPushChats()).n || 0;
    const n2 = (await cloudPushPersonas()).n || 0;
    const n3 = (await cloudPushProfile()).n || 0;
    cloudSet(_ck, true);
    console.log('[cloud] 旧数据已认领：chats=' + n1 + ' personas=' + n2 + ' profile=' + n3);
  } catch (e) { console.warn('[cloud] 认领失败', e); }
}

/* ---------- 本地一有改动就推（仅当对应开关打开） ---------- */
function cloudOnLocalChange(what) {
  if (!sb || !curUser) return;
  try {
    if (what === 'chats' && cloudOn(K_SYNC_CHATS)) cloudPushChats().catch(() => {});
    if (what === 'personas' && cloudOn(K_SYNC_PS)) cloudPushPersonas().catch(() => {});
    if (what === 'profile'  && cloudOn(K_SYNC_PF)) cloudPushProfile().catch(() => {});
  } catch (e) {}
}

/* ---------- 登录后入口（initAuth 已埋钩子） ---------- */
async function onCloudLogin() {
  refreshCloudUI();
  await cloudClaimLocalOnce();          // 旧数据认领（只做一次）
  if (cloudOn(K_SYNC_CHATS)) { try { await cloudPullChats(); if (typeof renderSessionList === 'function') renderSessionList(); } catch (e) {} }
  if (cloudOn(K_SYNC_PS))    { try { await cloudPullPersonas(); if (typeof renderPersonaList === 'function') renderPersonaList(); } catch (e) {} }
  if (cloudOn(K_SYNC_PF))    { try { await cloudPullProfile(); } catch (e) {} }
  refreshCloudUI();
}

/* ---------- 手动上传/下载 ---------- */
async function cloudPushNow() {
  if (!curUser) { if (typeof showAlert === 'function') showAlert('请先登录账号', '云端同步'); return; }
  if (cloudBusy) return;
  cloudBusy = true;
  const r1 = await cloudPushChats().catch(e => ({ ok: false, err: e.message }));
  const r2 = await cloudPushPersonas().catch(e => ({ ok: false, err: e.message }));
  const r3 = await cloudPushProfile().catch(e => ({ ok: false, err: e.message }));
  cloudBusy = false;
  const ok = r1.ok && r2.ok && r3.ok;
  if (typeof showAlert === 'function') {
    showAlert(ok ? ('上传完成\n聊天 ' + (r1.n || 0) + ' 条、人设卡 ' + (r2.n || 0) + ' 张、个人资料 ' + (r3.ok ? '已同步' : '未同步'))
                  : ('上传失败：' + (r1.err || r2.err || r3.err || '未知')), '云端同步');
  }
}

async function cloudPullNow() {
  if (!curUser) { if (typeof showAlert === 'function') showAlert('请先登录账号', '云端同步'); return; }
  if (cloudBusy) return;
  cloudBusy = true;
  const r1 = await cloudPullChats().catch(e => ({ ok: false, err: e.message }));
  const r2 = await cloudPullPersonas().catch(e => ({ ok: false, err: e.message }));
  const r3 = await cloudPullProfile().catch(e => ({ ok: false, err: e.message }));
  cloudBusy = false;
  if (typeof renderSessionList === 'function') renderSessionList();
  if (typeof renderPersonaList === 'function') renderPersonaList();
  const ok = r1.ok && r2.ok && r3.ok;
  if (typeof showAlert === 'function') {
    showAlert(ok ? ('下载完成\n新增聊天 ' + (r1.n || 0) + ' 条、人设卡 ' + (r2.n || 0) + ' 张、个人资料 ' + (r3.n ? '已更新' : '无云端记录'))
                  : ('下载失败：' + (r1.err || r2.err || r3.err || '未知')), '云端同步');
  }
}

/* ---------- 绑定抽屉交互 ---------- */
function bindCloud() {
  const btn = $('cloudSignBtn');
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', () => {
      if (curUser) {
        if (typeof askConfirm === 'function') {
          askConfirm('退出登录后本机数据仍保留，确定退出？', '退出登录', () => {
            /* 乐观退出：先同步切换本地状态（零等待），
               signOut 网络请求丢到后台，避免"点了没反应"的延迟感 */
            try { cloudSet(accClaimKey(), false); } catch (e) {}
            curUser = null;
            setAccScope(null);            // ✅ 切回未登录作用域（须在 accClaimKey 之后）
            cloudSet(K_CLOUD_ON, false);
            try { LS.del(K_SKIP_AUTH); } catch (e) {}
            refreshCloudUI();
            /* 就地切回未登录视图（不再 reload，避免登录页被渲染两次而闪）
               setAccScope(null) 已把作用域切回 :local，LS.* 自带作用域后缀，
               这里重读重画即可达到 reload 的效果，且无重载打断。 */
            try { loadAll(); } catch (e) {}
            try { renderAll(); } catch (e) {}
            try { renderSessions(); } catch (e) {}
            try { if (typeof renderPersonaList === 'function') renderPersonaList(); } catch (e) {}
            try { switchTab('msg'); } catch (e) {}
            try { setAuthMode('login'); } catch (e) {}
            showAuth();                       // 登录页一次性淡入（不再等网络）
            /* 后台撤销远端会话：不 await，失败也不阻塞本地已登出 */
            try { sb.auth.signOut().catch(() => {}); } catch (e) {}
          });
        }
      } else {
        showAuth();
      }
    });
  }
  const pb = $('cloudPwdBtn');
  if (pb && !pb._bound) { pb._bound = true; pb.addEventListener('click', () => openPwd('change')); }
  const tc = $('cloudToggleChats');
  if (tc && !tc._bound) { tc._bound = true; tc.addEventListener('click', () => { cloudSet(K_SYNC_CHATS, !cloudOn(K_SYNC_CHATS)); refreshCloudUI(); if (cloudOn(K_SYNC_CHATS)) cloudPushChats().catch(() => {}); }); }
  const tp = $('cloudTogglePersonas');
  if (tp && !tp._bound) { tp._bound = true; tp.addEventListener('click', () => { cloudSet(K_SYNC_PS, !cloudOn(K_SYNC_PS)); refreshCloudUI(); if (cloudOn(K_SYNC_PS)) cloudPushPersonas().catch(() => {}); }); }
  const tf2 = $('cloudToggleProfile');
  if (tf2 && !tf2._bound) { tf2._bound = true; tf2.addEventListener('click', () => { cloudSet(K_SYNC_PF, !cloudOn(K_SYNC_PF)); refreshCloudUI(); if (cloudOn(K_SYNC_PF)) cloudPushProfile().catch(() => {}); }); }
  const pn = $('cloudPushNow');
  if (pn && !pn._bound) { pn._bound = true; pn.addEventListener('click', cloudPushNow); }
  const ln = $('cloudPullNow');
  if (ln && !ln._bound) { ln._bound = true; ln.addEventListener('click', cloudPullNow); }
  refreshCloudUI();
}
