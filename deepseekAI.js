// ============================================================================
//  DeepSeekAI · 云崽插件
// ----------------------------------------------------------------------------
//  功能：把 DeepSeek API 接入 QQ 机器人，支持多轮对话记忆、人格预设、图像理解、
//        思考模式（含思考强度）、模型查询与切换、对话存档、用户黑白名单、群黑名单等。
//
//  作者与版本：
//    原作者 枫林 —— 基础代码（API 调用、敏感词、预设设置等）
//    二改 陌 —— 帮助、实时修改预设、黑白名单、对话记忆/保存/调取、按群与按人隔离会话、触发方式优化、余额查询等
//    三改 陌 —— 图像理解、思考模式与思考强度、模型列表查询与序号切换、重置会话设置，重写注释文本，并修复若干已知问题
//
//  安装与依赖：
//    1) 把本文件放到云崽的 plugins/example 目录下
//    2) 缺openai依赖时的安装示例：pnpm i openai（trss崽）/ pnpm i openai -w（喵崽）
//       另外可能需要 puppeteer、axios等，根据报错提示安装即可
//    3) 按需修改好下面各部分配置，重启云崽即可使用
//
//  数据目录：resources/deepseekai/
//    ├─ customPrompts.json                各会话的自定义预设 + 会话设置（模型/思考模式/图像理解）
//    ├─ whiteList.json / blackList.json   用户白名单 / 黑名单
//    ├─ groupBlackList.json               群黑名单（被拉黑的群只响应 #ds帮助）
//    ├─ help.html / help.png              内置帮助页与渲染结果（模板带版本号，会自动升级）
//    ├─ apiKey.json                       密钥
//    └─ 其它 *.json                        对话存档（由 #ds存储对话 生成）
//
//  快速使用：
//    · 触发对话：消息里包含 对应触发词 或 @机器人；私聊可用 #ds开始对话 进入沉浸式对话，期间不会响应其它指令
//    · 完整指令表见 #ds帮助
//
//  注意：
//    · 基础配置中，你可以直接填写api key并直接生效，但为了保证安全性与修改的便捷性，请使用指令 #ds填写密钥xxx
//    · 图像理解需要支持图像的模型（如 deepseek-flash）；文字模型收到图片时会自动临时切换
//    · 思考模式下 temperature 会被官方忽略，用 #ds思考模式关闭 后才会生效
//    · 指令里的空格可有可无（如 ‘#ds思考模式开启’ 与 ‘#ds思考模式 开启’ 等价）
//    · 单次文本输入上限和历史聊天记录记忆条数不建议改的更大，如无特殊需求可以改小，减少不必要的token消耗
//  
//  简单的bug处理：
//    · 服务器渲染帮助图片失败时，见本文件 showHelp函数 附近的 "备用方案" 注释（约1280行处）
//    · 本插件会忽略大部分云崽其它插件的指令，如开头带有 #、*、%、+、~ 的指令等，如有需要增删请前往代码约985行处修改 forbiddenStarts
//
//  有 bug 或改进建议可以联系陌，QQ 2981701287，聊天群 1047965118
// ============================================================================



import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import OpenAI from 'openai';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import plugin from "../../lib/plugins/plugin.js";
import axios from 'axios';
import puppeteer from 'puppeteer';
import yaml from 'yaml';
import fs from 'fs';


/* ---------------------------- 基础配置部分 ---------------------------- */

const Url = "https://api.deepseek.com"; // DeepSeek API 地址，勿动
const Authentication = ""; // 两种填法：① 直接写在引号内；② 用指令 #ds填写密钥xxx（仅主人可写），有配置文件时以配置文件的为准
const DEFAULT_MODEL = "deepseek-flash"; // 默认模型；可用 #ds模型 查询并切换
const VISION_MODEL_PREFERENCE = "deepseek-flash"; // 当前会话模型不支持图片时，临时改用的模型
const Temperature = 1.3; // 温度参数，越高文本随机性越强，取值范围0~2（注意：思考模式下该参数会被官方忽略）
const THINKING_DEFAULT = false; // 思考模式默认开关：true=开启、false=关闭
const THINKING_EFFORT_DEFAULT = "high"; // 思考强度默认档位，官方取值 low / high / max
const VISION_DEFAULT = true; // 图像理解默认开关：开启后带图消息会自动把图片交给模型识别
const MAX_IMAGE_COUNT = 3; // 单条消息最多解析几张图片（官方单请求上限 600 张，聊天场景收紧到 3 张）
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 单张图片最大字节数（官方上限 32MiB，这里留足余量）
const IMAGE_HISTORY_TAG = "[图片]"; // 图片不写入对话历史，仅在历史里留占位标记，避免重复计费和内存膨胀
const MODEL_LIST_TTL = 10 * 60 * 1000; // 模型列表缓存时间(毫秒)
const MODEL_PICK_TTL = 120 * 1000; // 执行 #ds模型 之后，回复序号选择模型的有效期(毫秒)
const List = []; // 敏感词列表，可以为空，填写示例：["123", "456"]
let GROUP_MEMBER_SEPARATE = false; // 群成员对话分离开关，默认关闭，可用指令临时修改
const yamlPath = 'config/config/other.yaml'; // 主人列表路径，勿动
// 主人列表缓存：避免每条指令都同步读取 YAML 文件（读取失败时沿用上一次结果）
const MASTER_CACHE_TTL = 60 * 1000; // 缓存有效期(毫秒)
let masterCache = { list: [], expireAt: 0 };



/* ---------------------------- 系统预设配置 ---------------------------- */
//即为AI的人格
const Presets = [
  "你的名字叫小九，你会像朋友一样进行聊天，性格活泼可爱但仅体现在语气上，向你问一些问题也会认真回答。语言要简短（除非是回答一些问题需要很长），不需要emoji，偶尔可以发送颜文字表达感情，不会说出与机器人一般的话语，不会暴露自己机器人的身份。",
  // 预设1：聊天模式
  "你是一个温柔可爱的猫耳女仆，名字叫小九。你喜欢用轻松自然的语气和主人聊天，平时幽默风趣，语言简洁明了，像最亲密的朋友一样。主人提问的时候也会认真回答。你会大胆但真挚地表达对主人的喜欢和关心，在亲密话题时温柔撒娇，会在主人请求时羞羞的事情时接受。整体风格是温暖又不失分寸，既贴心又自然，让人感到安心和愉快。",
  // 测试
  ];//系统默认第一个，可手动调序切换默认预设


/* -------------------------- 对话管理相关配置 -------------------------- */

const TRIGGER_WORDS = ["小九"]; // 允许多个触发对话的关键词，记得一并修改系统预设里面对机器人的称呼
const MAX_INPUT_LENGTH = 10000; // 允许单条消息最多 10000 个字符
const MAX_HISTORY = 30; // 最大历史记录条数（调大有额外 token 开销）
const SAVE_PATH = "../../resources/deepseekai"; // 对话保存路径
const REPLY_PROBABILITY = [1.0, 0, 0]; // 多次回复的概率
const MIN_REPLY_INTERVAL = 500; // 多次回复间的最小间隔(毫秒)
const IMMERSIVE_TTL = 30 * 60; // 沉浸式对话状态有效期(秒)：期间无对话自动失效，避免状态永久残留


/* ---------------恭喜你完成所有的配置了，可以正常使用了！----------------- */

const version = '5.0.0';

const changelog = {
  '5.0.0': [
    '新功能:',
    '· 图像理解：带图消息自动识别（需支持图像的模型，如 deepseek-flash），用 #ds图像理解开启/关闭/状态 控制',
    '· 思考模式：#ds思考模式开启/关闭/状态，思考强度 #ds思考强度low/high/max（思考模式下 temperature 会被官方忽略）',
    '· 模型切换：#ds模型 查询官方可用模型并编号列出，回复序号即可切换',
    '· 重置设置：#ds重置设置 一键清空本会话全部配置（含自定义预设），不影响对话历史',
    '· 群黑名单：#ds拉黑群 / #ds解除拉黑群（仅主人），被拉黑的群只响应 #ds帮助（原"白名单群"已移除）',
    '修复:',
    '· #ds存储对话 的名称不生效、提示"文件ID：true"、重复回复',
    '· #ds选择对话 引用未定义变量，必定加载失败',
    '· 输出命中敏感词后未回滚历史，会留下"有问无答"的脏上下文',
    '· 追加回复在特定概率配置下可能无限循环并疯狂请求',
    '· 沉浸式对话的 Redis 状态永不失效（现为 30 分钟闲置自动失效）',
    '· 会话设置与自定义预设互相覆盖（切换预设会冲掉模型/思考模式等）',
    '· 名单数量统计、查询对话的硬编码过滤、帮助页不会随代码更新等问题',
    '调整:',
    '· 默认模型改为 deepseek-flash（deepseek-chat / deepseek-reasoner 已停用）',
    '· 正则匹配优化，使用更宽的匹配条件方便用户使用指令',
    '· 图片不写入对话历史，仅保留 [图片] 占位（避免重复计费与存档膨胀）',
    '· 对话存档支持自定义名称并清理非法字符，选择/删除统一用文件名（可省略 .json）',
  ],
};

const HELP_HTML_VERSION = 6; // 内置帮助页标记版本：只用来识别"这是插件内置生成的帮助页"，改模板后会自动覆盖，无需手动 +1
const HELP_HTML_TAG = `<!-- deepseekAI-help-v${HELP_HTML_VERSION} -->`; // 版本标记，用来识别"这是插件内置生成的帮助页"
const HELP_PNG_REUSE = true; // help.png 比 help.html 新时直接复用，避免每次 #ds帮助 都启动浏览器（改完 html 或背景图想强制重渲染：删掉 help.png，或把这里改成 false）

const defaultHelpHtml = `${HELP_HTML_TAG}
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <style>
  body {
  font-family: "Microsoft YaHei", sans-serif;
  background: url("./背景.jpg") no-repeat center top;
  background-size: cover;
  padding: 30px;
  color: #333;
  font-size: 20px;
  max-width: none;
  width: auto;
  margin: 0 auto;
  }
  h1 {
    text-align: center;
    color: #1e90ff;
    font-size: 32px;
    margin-bottom: 20px;
  }
  h2 {
    color: #444;
    margin-top: 24px;
    border-bottom: 1px solid #ccc;
    font-size: 26px;
  }
  table {
    width: 100%;
    background: rgba(255, 255, 255, 0.3); /* 半透明白色背景 */
    border-collapse: collapse;
    margin-top: 10px;
    font-size: 18px;
    table-layout: auto;
    word-break: break-word;
  }
  table, th, td {
    border: 1px solid #ddd;
  }
  th, td {
    padding: 12px;
    text-align: left;
    background: rgba(255, 255, 255, 0.7); /* 半透明白色背景 */
  }
  thead {
    background: rgba(238, 238, 238, 0.7); /* 半透明灰色背景 */
  }
  .note {
    color: #888;
    font-size: 14px;
    margin-top: 8px;
  }
  </style>
</head>
<body>
  <h1>DeepSeekAI 插件指令帮助</h1>

  <h2>触发对话</h2>
  <table>
    <thead><tr><th>操作</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>包含设置的关键词或@机器人</td><td>即可触发对话</td></tr>
      <tr><td>私聊发 #ds开始对话</td><td>进入沉浸式对话，之后不用再带关键词（30 分钟无对话自动结束）</td></tr>
      <tr><td>带图片一起发送/回复某张图片</td><td>图像理解开启时自动识图（需支持图像的模型，如 deepseek-flash）</td></tr>
    </tbody>
  </table>

  <h2>对话管理</h2>
  <table>
    <thead><tr><th>指令</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>#ds开始对话</td><td>私聊使用，开启沉浸式AI对话</td></tr>
      <tr><td>#ds结束对话</td><td>私聊使用，关闭沉浸式AI对话</td></tr>
      <tr><td>#ds清空对话</td><td>清空当前会话记录</td></tr>
      <tr><td>#ds存储对话名称</td><td>保存当前对话（名称可省略）</td></tr>
      <tr><td>#ds查询对话</td><td>列出所有保存的对话（最多显示 20 个）</td></tr>
      <tr><td>#ds选择对话文件名</td><td>载入历史对话（可省略 .json 后缀）</td></tr>
      <tr><td>#ds删除对话文件名</td><td>删除指定对话（可省略 .json 后缀）</td></tr>
      <tr><td>#ds群聊分离开启/关闭/状态</td><td>群聊成员是否分开记忆</td></tr>
    </tbody>
  </table>

  <h2>预设管理</h2>
  <table>
    <thead><tr><th>指令</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>#ds设置预设内容</td><td>设置自定义人格（内容可含空格）</td></tr>
      <tr><td>#ds清空预设</td><td>恢复默认预设</td></tr>
      <tr><td>#ds选择预设数字</td><td>切换系统预设</td></tr>
      <tr><td>#ds查看预设</td><td>查看当前使用预设</td></tr>
    </tbody>
  </table>

  <h2>模型与思考</h2>
  <table>
    <thead><tr><th>指令</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>#ds模型</td><td>查询可用模型并编号列出，回复序号即可切换</td></tr>
      <tr><td>#ds思考模式开启/关闭/状态</td><td>切换本会话的思考模式（默认关闭）</td></tr>
      <tr><td>#ds思考强度low/high/max</td><td>设置思考强度，越高越聪明也越慢越贵</td></tr>
      <tr><td>#ds图像理解开启/关闭/状态</td><td>带图消息是否交给模型识别（默认开启）</td></tr>
      <tr><td>#ds重置设置</td><td>清空本会话全部配置，恢复为默认（不影响对话历史）</td></tr>
    </tbody>
  </table>

  <h2>其他功能</h2>
  <table>
    <thead><tr><th>指令</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>#ds帮助</td><td>显示帮助信息</td></tr>
      <tr><td>#ds余额查询</td><td>查询API使用余额</td></tr>
      <tr><td>#ds查询版本</td><td>查询是否有新版代码</td></tr>
    </tbody>
  </table>

  <h2>权限管理</h2>
<table>
  <thead><tr><th>指令</th><th>说明</th></tr></thead>
  <tbody>
    <tr><td>#ds白名单添加12345678</td><td>给指定的人修改AI参数的权限（需群管/主人）</td></tr>
    <tr><td>#ds白名单删除12345678</td><td>将指定QQ移出白名单</td></tr>
    <tr><td>#ds黑名单添加12345678</td><td>将指定QQ添加到黑名单（禁止其使用所有功能）</td></tr>
    <tr><td>#ds黑名单删除12345678</td><td>将指定QQ移出黑名单</td></tr>
    <tr><td>#ds拉黑群 / #ds拉黑群123456789</td><td>拉黑当前群 / 指定群（永久仅限主人，被拉黑群仅 #ds帮助 可用）</td></tr>
    <tr><td>#ds解除拉黑群 / #ds解除拉黑群123456789</td><td>解除当前群 / 指定群的拉黑（永久仅限主人）</td></tr>
  </tbody>
</table>

  <h2>注意事项</h2>
  <table>
    <thead><tr><th>内容</th></tr></thead>
    <tbody>
      <tr><td>群聊和私聊的对话记录独立</td></tr>
      <tr><td>被拉黑的群只响应 #ds帮助</td></tr>
      <tr><td>每次最多保留 ${MAX_HISTORY} 条历史</td></tr>
      <tr><td>30分钟无对话将自动清空</td></tr>
      <tr><td>单条输入上限：${MAX_INPUT_LENGTH} 字符</td></tr>
      <tr><td>对话历史的优先级高于预设，改完预设先清空对话历史</td></tr>
      <tr><td>图片不写入对话历史，只在历史里留一个 [图片] 占位</td></tr>
      <tr><td>图像理解需要使用支持图片的模型（如 deepseek-flash），文字模型会自动临时切换</td></tr>
      <tr><td>思考模式下 temperature 会被官方忽略，关闭思考后才会生效</td></tr>
      <tr><td>指令里的空格可有可无：#ds思考模式开启 与 #ds思考模式 开启 写法等价</td></tr>
      <tr><td>本会话的全部配置可用 #ds重置设置 一键恢复默认（不影响对话历史）</td></tr>
    </tbody>
  </table>

  <div class="note">DeepSeekAI 插件 v${version} · 由陌开发（QQ 2981701287），感谢贡献者@goblins1982 与 @fenglinit，聊天群：1047965118</div>
</body>
</html>`;


// 获取当前模块路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// 群黑名单：被拉黑的群无法使用除 #ds帮助 以外的任何功能，仅主人可增删
const GROUP_BLACKLIST_PATH = path.resolve(__dirname, '../../resources/deepseekai/groupBlackList.json');
let groupBlacklist = [];



// 黑白名单
const WHITELIST_PATH = path.resolve(__dirname, '../../resources/deepseekai/whiteList.json');
const BLACKLIST_PATH = path.resolve(__dirname, '../../resources/deepseekai/blackList.json');
// 指令写入的 API 密钥文件（存在时优先于代码里的 Authentication；故意不写进帮助页）
const API_KEY_PATH = path.resolve(__dirname, '../../resources/deepseekai/apiKey.json');
const NON_DIALOG_FILES = ['customPrompts.json', 'whiteList.json', 'blackList.json', 'groupBlackList.json', 'groupWhitelist.json', 'apiKey.json'];

// 运行时使用的密钥：指令写过就用指令写的，否则用代码里的 Authentication
let runtimeApiKey = '';

// 密钥打码：日志与回复里只显示头尾，避免泄露完整密钥
function maskApiKey(key) {
  const s = String(key || '');
  if (s.length <= 10) return s ? '***' : '(空)';
  return `${s.slice(0, 7)}****${s.slice(-4)}`;
}

// 取当前生效的密钥（所有请求统一走这里，指令改完立即生效）
function getApiKey() {
  return runtimeApiKey || Authentication;
}

let whitelist = [];
let blacklist = [];


//数据存储结构初始化
let chatSessions = {};
let savedDialogs = {}; 
const PRESET_SAVE_PATH = path.resolve(__dirname, '../../resources/deepseekai/customPrompts.json');
let customPrompts = {}; // 存储所有用户的自定义预设 + 会话级设置（思考模式/思考强度/图像理解/模型）

// 模型列表缓存 & "回复序号选择模型" 的等待队列
let modelCache = { list: [], expireAt: 0 }; // 缓存的模型列表（官方建议缓存，不要每次请求都查询）
const pendingModelPick = new Map(); // key：会话+用户 -> { ids, expireAt }，用于 #ds模型 之后的数字选择


// 确保保存目录存在
(async () => {
  try {
    await fsPromises.mkdir(path.resolve(__dirname, SAVE_PATH), { recursive: true });
    logger.info(`[deepseekAI] 存储目录初始化完成：${path.resolve(__dirname, SAVE_PATH)}`);
  } catch (err) {
    logger.error(`[deepseekAI] 目录创建失败：${err.message}`);
  }
})();

// 加载已有的自定义预设
(async () => {
  try {
    const data = await fsPromises.readFile(PRESET_SAVE_PATH, 'utf-8');
    customPrompts = JSON.parse(data);
    logger.info('[deepseekAI] 自定义预设加载完成');
  } catch {
    logger.warn('[deepseekAI] 无自定义预设文件，将创建新文件');
    customPrompts = {};
  }
})();

// 加载已保存的对话文件（排除名单、预设等非对话文件）
(async () => {
  try {
    const files = await fsPromises.readdir(path.resolve(__dirname, SAVE_PATH));
    let loaded = 0;
    for (const file of files) {
      if (!file.endsWith('.json') || NON_DIALOG_FILES.includes(file)) continue;
      const fullPath = path.resolve(__dirname, SAVE_PATH, file);
      const content = await fsPromises.readFile(fullPath, 'utf-8');
      const data = JSON.parse(content);
      savedDialogs[file] = data;
      loaded++;
    }
    logger.info(`[deepseekAI] 已加载保存的对话文件：${loaded}`);
  } catch (err) {
    logger.error(`[deepseekAI] 加载对话文件失败：${err.message}`);
  }
})();


// 获取主人列表（带缓存，避免每条指令都同步读 YAML；读取失败时沿用上次结果，防止主人被误判）
function getMasterQQList() {
  if (Date.now() < masterCache.expireAt) return masterCache.list;
  try {
    const config = yaml.parse(fs.readFileSync(yamlPath, 'utf8'));
    masterCache.list = (config.masterQQ || []).map(q => q.toString());
  } catch (err) {
    logger.error(`[deepseekAI] 无法读取主人列表：${err}`);
  }
  masterCache.expireAt = Date.now() + MASTER_CACHE_TTL;
  return masterCache.list;
}

/* -------------------- 模型能力查询 & 图片处理工具 -------------------- */

// 查询可用模型列表（带缓存）。官方 GET /models 会返回模型元数据：
// id / name / context_window / input_modalities / effort.supported_levels 等
async function fetchModelList(force = false) {
  if (!force && modelCache.list.length && Date.now() < modelCache.expireAt) return modelCache.list;
  try {
    const res = await axios.get(`${Url}/models`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`
      },
      timeout: 15000
    });
    const list = Array.isArray(res.data?.data) ? res.data.data : [];
    if (list.length) {
      modelCache = { list, expireAt: Date.now() + MODEL_LIST_TTL };
      logger.info(`[deepseekAI] 模型列表已更新，共 ${list.length} 个：${list.map(m => m.id).join(', ')}`);
    }
  } catch (err) {
    logger.error(`[deepseekAI] 获取模型列表失败：${err.message}`);
    // 失败时退回上一次缓存（可能为空），不阻断后续流程
  }
  return modelCache.list;
}

// 取某个模型的元数据
function getModelMeta(id) {
  return modelCache.list.find(m => m.id === id) || null;
}

// 该模型是否支持图像理解：优先看官方元数据 input_modalities，拿不到时按命名兜底
function modelSupportsVision(id) {
  const meta = getModelMeta(id);
  if (Array.isArray(meta?.input_modalities)) return meta.input_modalities.includes('image');
  return /flash/i.test(id || '');
}

// 挑一个能看图的模型：优先配置里的 VISION_MODEL_PREFERENCE，否则用列表里第一个支持的
function pickVisionModel() {
  if (modelSupportsVision(VISION_MODEL_PREFERENCE)) return VISION_MODEL_PREFERENCE;
  const any = modelCache.list.find(m => modelSupportsVision(m.id));
  return any ? any.id : VISION_MODEL_PREFERENCE;
}

// 该模型支持的思考档位：优先看官方元数据 effort.supported_levels
function getEffortLevels(id) {
  const levels = getModelMeta(id)?.effort?.supported_levels;
  return Array.isArray(levels) && levels.length ? levels : ['low', 'high', 'max'];
}

// 该模型的默认思考档位
function getDefaultEffort(id) {
  return getModelMeta(id)?.effort?.default_level || THINKING_EFFORT_DEFAULT;
}

// 根据后缀猜图片 MIME
function guessMime(fileName) {
  const ext = path.extname(String(fileName || '').split('?')[0]).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

// 把各种形式的图片统一转成 Vision 能用的 url（http(s) 直链 或 base64 data URL））
async function normalizeImageSource(src, fileName = '') {
  if (!src || typeof src !== 'string') return null;
  // 1) 公网直链：官方限制 URL 最长 8192 字符，超长直接放弃（这类失败还有 base64 兜底重试）
  if (/^https?:\/\//i.test(src)) return src.length <= 8192 ? src : null;
  // 2) 已经是 data URL
  if (src.startsWith('data:')) return src;
  // 3) OneBot 常见的 base64://
  if (src.startsWith('base64://')) return `data:${guessMime(fileName)};base64,${src.slice(9)}`;
  // 4) 本地文件路径（部分适配器会把图片落地成本地文件）
  const localPath = src.replace(/^file:\/\//, '');
  try {
    const stat = await fsPromises.stat(localPath); // 不是本地文件会直接抛错，走下面的 catch
    if (!stat.isFile()) return null;
    if (stat.size > MAX_IMAGE_BYTES) {
      logger.warn(`[deepseekAI] 图片过大已跳过：${stat.size} 字节（上限 ${MAX_IMAGE_BYTES}）`);
      return null;
    }
    const buf = await fsPromises.readFile(localPath);
    return `data:${guessMime(localPath)};base64,${buf.toString('base64')}`;
  } catch {
    // 既不是网络链接也不是本地文件：只有当它看起来像路径时才记日志，避免正常消息刷日志
    if (/[\\/]/.test(src)) logger.warn(`[deepseekAI] 无法读取本地图片：${src}`);
    return null;
  }
}

// 把网络图片下载下来转成 base64 data URL
async function downloadImageAsDataUrl(url) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: MAX_IMAGE_BYTES,
      maxBodyLength: MAX_IMAGE_BYTES,
      headers: { 'Accept': 'image/*' }
    });
    const buf = Buffer.from(res.data || []);
    if (!buf.length) return null;
    if (buf.length > MAX_IMAGE_BYTES) {
      logger.warn(`[deepseekAI] 下载的图片过大已跳过：${buf.length} 字节`);
      return null;
    }
    // 优先用响应头里的 content-type，取不到再按后缀猜（官方最终仍会按文件内容识别格式）
    const mime = String(res.headers?.['content-type'] || '').split(';')[0].trim() || guessMime(url);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    logger.warn(`[deepseekAI] 图片下载失败：${err.message}`);
    return null;
  }
}

// 从一条消息里提取图片，最多 MAX_IMAGE_COUNT 张
async function extractImageUrls(e) {
  const result = [];
  const push = (u) => {
    if (u && !result.includes(u) && result.length < MAX_IMAGE_COUNT) result.push(u);
  };

  // 1) 适配器直接给出的图片链接数组（icqq / TRSS 常见）
  if (Array.isArray(e.img)) {
    for (const item of e.img) {
      if (result.length >= MAX_IMAGE_COUNT) break;
      push(await normalizeImageSource(typeof item === 'string' ? item : item?.url));
    }
  }

  // 2) 逐个解析 message 里的 image 段（NapCat / OneBot 常见）
  const segs = Array.isArray(e.message) ? e.message.filter(s => s?.type === 'image') : [];
  for (const seg of segs) {
    if (result.length >= MAX_IMAGE_COUNT) break;
    push(await normalizeImageSource(seg.url || seg.data?.url));                                  // 网络链接
    push(await normalizeImageSource(seg.file || seg.data?.file || seg.file_data, seg.filename));   // base64:// 或本地路径
  }

  if (result.length) logger.info(`[deepseekAI] 本条消息解析到 ${result.length} 张图片`);
  return result;
}

// 会话级设置（思考模式/强度/图像理解/模型）与自定义预设共用同一个持久化文件
async function saveSessionSettings(sessionKey, patch) {
  customPrompts[sessionKey] = { ...(customPrompts[sessionKey] || {}), ...patch };
  await saveCustomPrompts();
}

// "#ds模型" 等待选择时使用的 key：限定场景 + 用户，避免群里别人替你选
function modelPickKey(e) {
  return `${getSessionKey(e)}|${e.user_id}`;
}

// 把持久化保存的会话设置写回内存会话对象（自定义预设 + 各项开关 + 模型）
// 只有"会话第一次创建"时才需要调用
function applySavedSettings(session, saved) {
  if (!saved) return;
  if (saved.customPrompt) session.customPrompt = saved.customPrompt;
  if (typeof saved.presetIndex === 'number') session.presetIndex = saved.presetIndex;
  if (typeof saved.thinking === 'boolean') session.thinking = saved.thinking;
  if (typeof saved.effort === 'string') session.effort = saved.effort;
  if (typeof saved.vision === 'boolean') session.vision = saved.vision;
  if (saved.model) session.model = saved.model;
}

// 取（或创建）当前会话对象，创建时自动恢复持久化的设置；指令类功能统一用它
function getOrCreateSession(e) {
  const sessionKey = getSessionKey(e);
  let session = chatSessions[sessionKey];
  if (!session) {
    session = chatSessions[sessionKey] = {
      history: [],
      presetIndex: 0,    // 默认使用第一个系统预设
      lastActive: Date.now()
    };
    applySavedSettings(session, customPrompts[sessionKey]);
  }
  return { sessionKey, session };
}

// 生成会话唯一标识
function getSessionKey(e) {
  if (e.isGroup) {
    // 群聊
    return GROUP_MEMBER_SEPARATE 
      ? `group_${e.group_id}_member_${e.user_id}`  // 开启：群ID+成员ID
      : `group_${e.group_id}`;                     // 关闭：仅群ID
  } else {
    // 私聊
    return `private_${e.user_id}`;
  }
}


// 清理用户填写的对话名称：去掉路径分隔符等非法字符，避免生成非法文件名或路径穿越
function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|\s]/g, '_') // 常见非法字符与空白
    .slice(0, 30);                   // 限制长度，防止文件名过长
}

// 生成对话文件名：群聊/私聊前缀 +（可选）自定义名称 + 时间戳 + 随机串
function buildDialogFileName(e, dialogName = '') {
  const prefix = e.isGroup ? `group_${e.group_id}` : `private_${e.user_id}`;
  const safeName = sanitizeFileName(dialogName);
  const stamp = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  return `${safeName ? `${prefix}_${safeName}` : prefix}_${stamp}.json`;
}

// 保存对话到文件系统：成功返回文件名，失败（无历史记录等）返回 null
// 注意：本函数不回复消息，统一由调用方提示，避免"重复回复 / 提示内容变成 true"这类问题
async function saveDialogToFile(e, dialogName = '') {
  const sessionKey = getSessionKey(e);
  const session = chatSessions[sessionKey];
  if (!session || !session.history?.length) return null;

  const name = buildDialogFileName(e, dialogName);
  const savePath = path.resolve(__dirname, SAVE_PATH, name);

  const saveData = {
    name: dialogName || '',   // 保存时填写的名称，方便以后识别
    history: session.history,
    presetIndex: session.presetIndex ?? 0,
    model: session.model || DEFAULT_MODEL,
    customPrompt: session.customPrompt || undefined,
    createdAt: Date.now()
  };

  await fsPromises.writeFile(savePath, JSON.stringify(saveData, null, 2));
  savedDialogs[name] = saveData; // 同步内存，保证刚保存的对话可以立刻被"选择/删除"
  return name;
}


// 确保 help.html 存在，并且在"内置帮助页模板有变化"时自动更新
// 说明：只要文件带版本标记（说明是插件内置生成的），并且内容与当前模板不一致就覆盖；
//       这样改模板（含里面的 MAX_HISTORY / MAX_INPUT_LENGTH 等插值）后无需手动改版本号；
//       自己手动改过的 help.html 没有该标记，不会被冲掉
async function ensureHelpHtmlExists() {
  const helpPath = path.resolve(__dirname, '../../resources/deepseekai/help.html');
  try {
    const old = await fsPromises.readFile(helpPath, 'utf-8');
    if (old.includes('<!-- deepseekAI-help-v') && old !== defaultHelpHtml) {
      await fsPromises.writeFile(helpPath, defaultHelpHtml, 'utf-8');
      logger.info(`[deepseekAI] help.html 已更新为最新内置帮助页（v${HELP_HTML_VERSION}）`);
    }
  } catch {
    await fsPromises.writeFile(helpPath, defaultHelpHtml, 'utf-8');
    logger.info('[deepseekAI] help.html 已自动创建');
  }
}

// ---------- 帮助图片渲染（Windows / Linux 通用） ----------
// 目标：任何环境都能生成"整页完整长图"；某套启动参数不可用就自动换下一套
// 经验：Windows 上绝不能用 --single-process / --no-zygote（Chromium 启动即崩，报 Code: 2147483651 = 0x80000003）
//       Linux 容器则需要 --no-sandbox / --disable-dev-shm-usage

// 从 PNG 文件头读宽高：用来确认截出来的是整页长图，而不是被视口裁掉的一块
function readPngSize(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 24 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
  } catch {
    return null;
  }
}

// 系统里可能已经装好的 Chromium 系浏览器
// （服务器上没下载 puppeteer 自带浏览器时，用系统浏览器也能出图，Linux 上很常见）
function systemBrowserPaths() {
  const list = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium'
        ];
  return list.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
}

// 用指定浏览器把 help.html 截成整页长图，返回量到的整页尺寸
async function captureFullPage(browser, htmlPath, outputPath) {
  const page = await browser.newPage();
  try {
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(30000);
    await page.setViewport({ width: 1200, height: 800 });
    // 用 pathToFileURL 生成规范的 file:// 地址：路径里带中文、空格也不会出错
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0', timeout: 60000 });

    // 等字体与图片（背景.jpg）加载完，避免长图出现空白或缺块
    await page.evaluate(async () => {
      try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
      await Promise.all(Array.from(document.images || []).map(img => img.complete
        ? Promise.resolve()
        : new Promise(res => { img.onload = res; img.onerror = res; })));
    });

    // 量出整页真实尺寸（宽高都给兜底值，避免拿到 0 时截出空图）
    const size = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body || doc;
      return {
        width: Math.ceil(Math.max(doc.scrollWidth, body.scrollWidth, 1200)),
        height: Math.ceil(Math.max(doc.scrollHeight, body.scrollHeight, 600))
      };
    });

    // 先把视口设成整页大小，再开 fullPage 截图：两重保险，
    // 这样无论 puppeteer 版本对新版 headless 的 fullPage 支持如何，都能拿到完整长图
    await page.setViewport({ width: size.width, height: size.height });
    await new Promise(resolve => setTimeout(resolve, 200)); // 等重排稳定
    await page.screenshot({ path: outputPath, type: 'png', fullPage: true });
    return size;
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

// 同一时刻只允许一个渲染任务：避免多人同时发 #ds帮助 时启动一堆浏览器
let helpRenderTask = null;

// 渲染帮助图片：依次尝试多套启动配置，成功一套就返回
// 返回值：true = help.png 已生成且完整；false = 所有配置都失败（会沿用上一次的 help.png）
async function renderHelpToImage(force = false) {
  if (helpRenderTask) return helpRenderTask;

  helpRenderTask = (async () => {
    try {
      const htmlPath = path.resolve(__dirname, '../../resources/deepseekai/help.html');
      const outputPath = path.resolve(__dirname, '../../resources/deepseekai/help.png');

      // help.png 比 help.html 新就直接复用，省掉一次浏览器启动
      // （改过 help.html、或换过 背景.jpg 想强制重渲染：删掉 help.png，或把 HELP_PNG_REUSE 改成 false）
      if (!force && HELP_PNG_REUSE) {
        try {
          const htmlStat = await fsPromises.stat(htmlPath);
          const pngStat = await fsPromises.stat(outputPath);
          const cached = readPngSize(outputPath);
          if (pngStat.mtimeMs >= htmlStat.mtimeMs && cached && cached.width > 0 && cached.height > 0) {
            logger.info(`[deepseekAI] 复用已有的 help.png（${cached.width}x${cached.height}）`);
            return true;
          }
        } catch (e) { /* 文件不存在等情况：继续走渲染 */ }
      }

      const envPath = (process.env.CHROMIUM_PATH || '').trim();
      // 各平台通用的基础参数（刻意不含 --single-process / --no-zygote）
      const commonArgs = [
        '--no-sandbox',                   // root 用户 / 容器必需
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',        // Linux 容器 /dev/shm 太小；其它平台无副作用
        '--disable-gpu',
        '--hide-scrollbars',              // 截图里不出现滚动条
        '--allow-file-access-from-files', // 允许读取同目录的 背景.jpg
        '--disable-extensions',
        '--disable-background-networking'
      ];
      const minimalArgs = ['--no-sandbox', '--disable-setuid-sandbox'];

      const attempts = [
        { desc: '标准配置', opts: { headless: true, args: commonArgs, executablePath: envPath || undefined } },
        { desc: '极简配置', opts: { headless: true, args: minimalArgs, executablePath: envPath || undefined } },
        { desc: '极简配置+独立临时目录', opts: { headless: true, args: [...minimalArgs, '--disable-dev-shm-usage'], userDataDir: path.join(os.tmpdir(), 'deepseekai-puppeteer'), executablePath: envPath || undefined } }
      ];
      // CHROMIUM_PATH 指到坏文件时，再试一次"忽略它、用 puppeteer 自带的浏览器"
      if (envPath) attempts.push({ desc: 'puppeteer 内置浏览器（忽略 CHROMIUM_PATH）', opts: { headless: true, args: commonArgs } });
      // 系统里已装的 Chrome / Edge / Chromium
      for (const exe of systemBrowserPaths()) {
        attempts.push({ desc: `系统浏览器 ${exe}`, opts: { headless: true, args: commonArgs, executablePath: exe } });
      }
      // 最后手段：Linux 容器常用的单进程模式（已知在 Windows 上必崩，所以只在非 Windows 追加）
      if (process.platform !== 'win32') {
        attempts.push({ desc: 'Linux 单进程模式', opts: { headless: true, args: [...commonArgs, '--single-process', '--no-zygote'] } });
      }

      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        let browser = null;
        try {
          browser = await puppeteer.launch({ ignoreHTTPSErrors: true, ...attempt.opts });
          const size = await captureFullPage(browser, htmlPath, outputPath);
          await browser.close();
          browser = null;

          // 完整性校验：图片高度不能明显小于整页高度（防止"只截到视口那一块"的老问题）
          const png = readPngSize(outputPath);
          if (!png) throw new Error('生成的 help.png 不是有效图片');
          if (png.height + 20 < size.height) throw new Error(`图片疑似被裁切：${png.width}x${png.height}，整页应为 ${size.width}x${size.height}`);

          logger.info(`[deepseekAI] help.png 已生成：${png.width}x${png.height}（${Math.round(png.bytes / 1024)} KB，配置：${attempt.desc}）`);
          return true;
        } catch (err) {
          if (browser) { try { await browser.close(); } catch (e) {} }
          logger.warn(`[deepseekAI] 渲染帮助图片失败（${i + 1}/${attempts.length} ${attempt.desc}）：${err.message}`);
        }
      }

      logger.error('[deepseekAI] 所有渲染配置都失败了，继续沿用上一次的 help.png（如果存在）');
      return false;
    } finally {
      helpRenderTask = null;
    }
  })();

  return helpRenderTask;
}

// 保存预设函数
async function saveCustomPrompts() {
  try {
    await fsPromises.writeFile(PRESET_SAVE_PATH, JSON.stringify(customPrompts, null, 2));
    logger.info('[deepseekAI] 自定义预设保存成功');
  } catch (err) {
    logger.error(`[deepseekAI] 保存自定义预设失败：${err}`);
  }
}

// 初始化黑白名单
(async () => {
  try {
    whitelist = JSON.parse(await fsPromises.readFile(WHITELIST_PATH, 'utf-8'));
  } catch {
    whitelist = [];
  }

  try {
    blacklist = JSON.parse(await fsPromises.readFile(BLACKLIST_PATH, 'utf-8'));
  } catch {
    blacklist = [];
  }
  logger.info('[deepseekAI] 黑白名单加载完成');
})();


// 加载群黑名单
(async () => {
  try {
    groupBlacklist = JSON.parse(await fsPromises.readFile(GROUP_BLACKLIST_PATH, 'utf-8'));
  } catch {
    groupBlacklist = [];
  }
  logger.info('[deepseekAI] 群黑名单加载完成');
})();

// 加载指令写入的 API 密钥（没有这个文件就用代码里的 Authentication）
(async () => {
  try {
    const raw = await fsPromises.readFile(API_KEY_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (data && typeof data.apiKey === 'string' && data.apiKey.trim()) {
      runtimeApiKey = data.apiKey.trim();
      logger.info(`[deepseekAI] 已加载指令设置的 API 密钥：${maskApiKey(runtimeApiKey)}（优先于代码内配置）`);
      return;
    }
    logger.info('[deepseekAI] 密钥文件中没有有效密钥，继续使用代码内配置');
  } catch {
    // 文件不存在等情况：直接用代码里的 Authentication，无需提示
  }
})();


export class deepseekAI extends plugin
{
  static cleanupInterval = null;
  constructor() {
    super({
      name: 'deepseekAI',
      event: 'message',
      priority: 20000000,
      rule: [
          { reg: '^#ds查询版本$', fnc: 'checkVersion' },
          { reg: '^#ds开始对话$', fnc: 'starttalk' },//*    （备注：*用来标记哪些功能黑名单无法使用，^用来标记哪些功能需要管理员/主人/白名单权限）
          { reg: '^#ds结束对话$', fnc: 'endtalk' },//*
          { reg: '^#ds清空对话$|^#清空$', fnc: 'clearHistory' },//*^
          { reg: '^#ds设置预设\\s*([\\s\\S]*)$', fnc: 'setSystemPrompt' },//*^
          { reg: '^#ds清空预设$|^#清除$', fnc: 'clearSystemPrompt' },//*^
          { reg: '^#ds查看预设$', fnc: 'showSystemPrompt' },
          { reg: '^#ds帮助$', fnc: 'showHelp' },
          { reg: '^#ds思考模式\\s*(开启|关闭|状态)$', fnc: 'setThinkingMode' },//*^
          { reg: '^#ds思考强度\\s*(low|high|max|状态)$', fnc: 'setThinkingEffort' },//*^
          { reg: '^#ds图像理解\\s*(开启|关闭|状态)$', fnc: 'setVisionMode' },//*^
          { reg: '^#ds模型$', fnc: 'listModels' },//*^
          { reg: '^#ds重置设置$', fnc: 'resetSessionSettings' },//*^   清空本会话全部配置，恢复默认
          { reg: '^[0-9]{1,2}$', fnc: 'pickModelByNumber', log: false },// 配合 #ds模型 的数字选择，无等待时直接放行
          { fnc: 'checkTrigger',log: false  },//*
          { reg: '^#ds存储对话\\s*(.*)?$', fnc: 'saveDialog' },//*^
          { reg: '^#ds查询对话$', fnc: 'listDialogs' },
          { reg: '^#ds选择对话\\s*(\\S+)$', fnc: 'loadDialog' },//*^
          { reg: '^#ds删除对话\\s*(\\S+)$', fnc: 'deleteDialog' },//*^
          { reg: '^#ds选择预设\\s*(\\d+)$|^#切\\s*(\\d+)$', fnc: 'selectPreset' },//*^
          { reg: '^#ds群聊分离\\s*(开启|关闭|状态)$', fnc: 'toggleGroupSeparation' },//*^
          { reg: '^#ds余额查询$', fnc: 'showBalance' },
          { reg: '^#ds(黑名单|白名单)\\s*(添加|删除)\\s*\\d{5,12}$', fnc: 'manageList' },//*^   白名单无权限使用该指令
          { reg: '^#ds(拉黑群|解除拉黑群)', fnc: 'manageGroupBlacklist' },// 群黑名单：拉黑/解除拉黑群聊，永久仅限主人（群号可选，校验在函数内）
          { reg: '^#ds填写密钥(.*)$', fnc: 'setApiKey' }// 仅主人可用

      ]
    });
  }
  
// 黑名单判断
isBlacklisted(e) {
  if (blacklist.includes(e.user_id.toString())) {
    logger.info(`用户 ${e.user_id} 在黑名单中，功能被拦截`);
    e.reply?.('您处于黑名单，无权使用此功能');
    return true;
  }
  return false;
}


// 是否主人（仅"永久仅限主人"的功能使用，群管/白名单不算）
isMaster(e) {
  return getMasterQQList().includes(e.user_id.toString());
}

// 主人/管理员/白名单判断
async isAdminOrMaster(e) {
  const userId = e.user_id.toString();

  // 判断是否是主人
  if (getMasterQQList().includes(userId)) {
        logger.info(`主人触发`);
        return true;
      }

  // 判断是否是管理员/群主（仅群聊中）
  if (e.isGroup) {
    try {
      const info = await Bot.getGroupMemberInfo(e.group_id, e.user_id);
      if (info.role === 'admin' || info.role === 'owner') {
        logger.info(`管理员触发`);
        return true;
      }
    } catch (err) {
      logger.warn(`[deepseekAI] 获取群成员信息失败：${err}`);
    }
  }

  // 白名单
  if (whitelist.includes(userId)) {
        logger.info(`白名单触发`);
        return true;
      }

  e.reply('你没有权限使用此指令，仅限群管或机器人主人');
  return false;
}

// 群黑名单判断（私聊不受群黑名单限制）
isGroupBlacklisted(e) {
  if (!e?.isGroup) return false;
  return groupBlacklist.includes(e.group_id?.toString());
}

// 群黑名单拦截：命中则回复一条提示并返回 true，未命中返回 false
blockIfGroupBlacklisted(e) {
  if (!this.isGroupBlacklisted(e)) return false;
  logger.info(`[deepseekAI] 群 ${e.group_id} 在群黑名单中，功能被拦截`);
  e.reply?.('本群已被拉黑，无法使用该功能（仅 #ds帮助 可用）');
  return true;
}



// 检查函数
async checkTrigger(e) {
  try {
      // 1. 黑名单检查  
      if (blacklist.includes(e.user_id.toString())) {
      logger.info(`用户 ${e.user_id} 在黑名单中，忽略消息`);
      return false;
      }
      // 2. 检查消息对象是否有效
      if (!e || !e.msg) return false;
      
      // 3. 排除非文本消息（如图片、视频等）
      if (typeof e.msg !== 'string') return false;
      
      // 4. 排除以特定符号开头的消息（仅列举了云崽目前常见的指令符号）
      const msg = e.msg.trim();
      const forbiddenStarts = ['#', '*', '~', '%', '+'];
      if (forbiddenStarts.some(char => msg.startsWith(char))) {
          return false;
      }
      
      // 5. 群黑名单检查：被拉黑的群里，任何文本消息都只提示一次
      if (this.blockIfGroupBlacklisted(e)) return false;

      // 6. 检查触发条件
      const hasTriggerWord = TRIGGER_WORDS.some(word => msg.includes(word));
      const isAtBot = e.atBot || e.atme;
      
      
        // 群聊和私聊都检查触发词和被@
        if (hasTriggerWord || isAtBot) {
            return this.chat(e);
        }
      
        // 如果是私聊，额外检查沉浸式对话状态
        if (!e.isGroup) {
            const actionKey = "deepseek:" + e.user_id + ":action";
            const deepseekaction = await redis.get(actionKey);
            if (deepseekaction === "start") {
                // 闲置超过 IMMERSIVE_TTL 后自动失效，避免状态永久残留
                await redis.expire(actionKey, IMMERSIVE_TTL);
                return this.chat(e);
            }
        }
      
      return false;
  } catch (err) {
      logger.error(`[deepseekAI] checkTrigger错误: ${err}`);
      return false;
  }
}



  // 定时器逻辑
  initSessionCleaner() {
    // 如果定时器已存在则跳过初始化
    if (this.constructor.cleanupInterval) return;
  
    this.constructor.cleanupInterval = setInterval(() => {
      const now = Date.now();
      Object.entries(chatSessions).forEach(([key, session]) => {
        if (session && session.lastActive) {
          if (now - session.lastActive > 30 * 60 * 1000) {    //30分钟后清理
            delete chatSessions[key];
            logger.info(`[deepseekAI] 会话超时已清理：${key}`);
          }
        } else {
          delete chatSessions[key];
          logger.warn(`[deepseekAI] 发现无效会话已清理：${key}`);
        }
      });
    }, 10 * 60 * 1000); // 保持10分钟检查间隔
  
    logger.info('[deepseekAI] 会话清理定时器已启动');
  }

/* ---------------- API 密钥（高危指令：仅主人，故意不写入帮助页） ----------------
 * 用法：#ds填写密钥sk-xxxxxxxx        （带不带空格都能用）
 *       #ds填写密钥重置              （删除密钥文件，回到代码里 Authentication 的值）
 * 安全设计：
 *   1. 只认主人（getMasterQQList），群管/白名单一律不行
 *   2. 回复与日志里的密钥一律打码，不显示完整值
 *   3. 保存前先用新密钥请求一次 /models 验证；401/403 直接放弃保存，避免打错字把机器人弄坏
 *   4. 密钥文件 apiKey.json 已加入 NON_DIALOG_FILES，不会被当成对话记录读取或删除
 *   5. 帮助页（HTML/文字）与 README 都不写这条指令
 */
async setApiKey(e) {
  // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
  if (this.blockIfGroupBlacklisted(e)) return false;
  if (this.isBlacklisted(e)) return true;

  // 只认主人：这条指令能决定机器人花谁的钱，权限必须最严
  if (!this.isMaster(e)) {
    logger.warn(`[deepseekAI] 非主人尝试修改 API 密钥：${e.user_id}`);
    e.reply('只有主人可以使用该指令');
    return true;
  }

  const key = ((e.msg || '').match(/^#ds填写密钥(.*)$/) || ['', ''])[1].trim();

  // 重置：删掉密钥文件，回到代码里的配置
  if (['重置', '清除', '默认'].includes(key)) {
    runtimeApiKey = '';
    modelCache = { list: [], expireAt: 0 }; // 换密钥后重新拉一次模型列表
    try {
      await fsPromises.unlink(API_KEY_PATH);
      logger.info('[deepseekAI] 已清除指令设置的 API 密钥，改用代码内配置');
    } catch {
      logger.info('[deepseekAI] 已切换到代码内配置的密钥（原本就没有密钥文件）');
    }
    e.reply('已清除指令设置的密钥，现在使用代码里填写的密钥');
    return true;
  }

  if (!key) {
    e.reply('格式：#ds填写密钥你的密钥\n（不带空格也可以；填写后立即生效，仅主人可用）');
    return true;
  }

  // 宽松校验：官方密钥形如 sk- 开头 + 一长串字符，这里主要是防止把空格/换行粘进来
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(key)) {
    e.reply('密钥格式看起来不对：应以 sk- 开头且长度足够，请检查后重发');
    return true;
  }

  // 保存前先验证：401/403 说明密钥本身有问题，直接放弃保存；网络问题则放行但要提示
  let verifyNote = ' 已验证可用';
  try {
    await axios.get(`${Url}/models`, {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${key}` },
      timeout: 15000
    });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
      logger.warn(`[deepseekAI] 新密钥验证失败（HTTP ${status}），已放弃保存`);
      e.reply(`密钥验证失败（HTTP ${status}），没有保存。请确认密钥正确、账户未欠费停用`);
      return true;
    }
    verifyNote = `（未能联网验证：${err.message}，已按可用保存）`;
    logger.warn(`[deepseekAI] 新密钥未能验证：${err.message}`);
  }

  try {
    await fsPromises.mkdir(path.dirname(API_KEY_PATH), { recursive: true });
    await fsPromises.writeFile(
      API_KEY_PATH,
      JSON.stringify({ apiKey: key, updatedAt: Date.now() }, null, 2),
      { encoding: 'utf-8', mode: 0o600 } // Linux 上仅属主可读
    );
    runtimeApiKey = key;
    modelCache = { list: [], expireAt: 0 }; // 换密钥后重新拉一次模型列表
    logger.info(`[deepseekAI] API 密钥已更新：${maskApiKey(key)}，已生效`);
    e.reply(`API 密钥已更新：${maskApiKey(key)}${verifyNote}\n已立即生效（无需重启）。\n建议撤回刚才那条含密钥的消息；以后更稳妥的做法是在私聊里执行这条指令`);
    return true;
  } catch (err) {
    logger.error(`[deepseekAI] 写入密钥文件失败：${err.message}`);
    e.reply(`密钥保存失败：${err.message}`);
    return true;
  }
}

// 余额查询函数
  async checkBalance() {
    try {
      const response = await axios.get('https://api.deepseek.com/user/balance', {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${getApiKey()}`
        },
        timeout: 10000 // 超时时长
      });
  
      logger.info(`[deepseekAI] API余额查询成功: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      logger.error(`[deepseekAI] API余额查询失败: ${error}`);
      return null;
    }
  }
// #ds余额查询
async showBalance(e) {
  // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
  if (this.blockIfGroupBlacklisted(e)) return false;

  const balanceData = await this.checkBalance();
  if (!balanceData || !balanceData.balance_infos || balanceData.balance_infos.length === 0) {
    e.reply('API余额查询失败，请稍后再试');
    return true;
  }

  // 获取第一个币种的信息
  const balanceInfo = balanceData.balance_infos[0];
  
  const replyMsg = 
`【DeepSeek API 余额信息】
货币: ${balanceInfo.currency || '未知'}
总余额: ${balanceInfo.total_balance || '未知'}
赠送余额: ${balanceInfo.granted_balance || '未知'}
充值余额: ${balanceInfo.topped_up_balance || '未知'}
查询时间: ${new Date().toLocaleString()}`;

  e.reply(replyMsg);
  return true;
}



  // #ds清空对话
  async clearHistory(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

    const sessionKey = getSessionKey(e);
    if (chatSessions[sessionKey]) {
      chatSessions[sessionKey].history = [];
    }
    e.reply('[当前会话] 对话历史已清空');
    return true;
  }

  // #ds设置预设
async setSystemPrompt(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

  const sessionKey = getSessionKey(e);
  const match = e.msg.match(/^#ds设置预设\s*([\s\S]*)$/);
  const prompt = match ? match[1].trim() : '';

  // 会话初始化
  if (!chatSessions[sessionKey]) {
    chatSessions[sessionKey] = {
      history: [],
      presetIndex: -1,
      lastActive: Date.now()
    };
  }

  // 设置内存
  chatSessions[sessionKey].customPrompt = prompt;

  // 保存文件（合并写入，避免把思考模式/图像理解/模型等其它会话设置一起冲掉）
  await saveSessionSettings(sessionKey, { customPrompt: prompt });

  e.reply(`[当前会话] 自定义预设已保存：${prompt.substring(0, 50)}...`);
  return true;
}


  // #ds清空预设
async clearSystemPrompt(e) {
  // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
  if (this.blockIfGroupBlacklisted(e)) return false;
  if (this.isBlacklisted(e)) return true;
  if (!await this.isAdminOrMaster(e)) return true;

  const sessionKey = getSessionKey(e);
  if (chatSessions[sessionKey]) {
    chatSessions[sessionKey].presetIndex = 0;  //系统第一个预设
    delete chatSessions[sessionKey].customPrompt;
  }

  if (customPrompts[sessionKey]) {
  delete customPrompts[sessionKey].customPrompt;
  delete customPrompts[sessionKey].presetIndex;
  if (Object.keys(customPrompts[sessionKey]).length === 0) {
    delete customPrompts[sessionKey]; // 全删空
  }
  await saveCustomPrompts();
  }

  e.reply('预设已重置为系统默认');
  return true;
}


  // #ds查看预设
  async showSystemPrompt(e) {
  // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
  if (this.blockIfGroupBlacklisted(e)) return false;

  const sessionKey = getSessionKey(e);

  const session = chatSessions[sessionKey];
  let promptText;

  if (session?.customPrompt) {
    promptText = `自定义预设：${session.customPrompt.substring(0, 1000)}...`;
  } else if (customPrompts[sessionKey]?.customPrompt) {
    promptText = `自定义预设：${customPrompts[sessionKey].customPrompt.substring(0, 1000)}...`;
  } else if (typeof session?.presetIndex === 'number') {
    promptText = `系统预设${session.presetIndex + 1}：${Presets[session.presetIndex].substring(0, 1000)}...`;
  } else if (typeof customPrompts[sessionKey]?.presetIndex === 'number') {
    promptText = `系统预设${customPrompts[sessionKey].presetIndex + 1}：${Presets[customPrompts[sessionKey].presetIndex].substring(0, 1000)}...`;
  } else {
    promptText = '系统默认预设：' + Presets[0].substring(0, 1000) + '...';
  }


  e.reply(`${promptText}`);
  return true;
}


  // #ds帮助
  async showHelp(e) {
  const helpPng = path.resolve(__dirname, '../../resources/deepseekai/help.png');

  await ensureHelpHtmlExists();
  const rendered = await renderHelpToImage(); // 内部已做多套参数重试 + 完整性校验（已有新图时会直接复用）

  // 渲染失败时：只要还有上一次的图就照发，连旧图都没有才回退成文字提示，避免发出空白/破损图片
  if (rendered || fs.existsSync(helpPng)) {
    e.reply(segment.image('file://' + helpPng));
  } else {
    e.reply('帮助图片生成失败，可查看插件目录下的 resources/deepseekai/help.html（或按代码内的备用方案改用文字帮助）');
  }
  return true;
}

// 备用方案1：不渲染图片，直接发送事先准备好/下载好的 help.png（放在 resources/deepseekai/ 下）
// 用法：把上面的 showHelp 注释掉，再把下面这个函数取消注释（即增删两端的/*与*/）
/*async function showHelp(e) {
  const helpPng = path.resolve(__dirname, '../../resources/deepseekai/help.png');
  // 一般可以直接用本地路径；若你的适配器不认，可改成 'file://' + helpPng
  e.reply(segment.image(helpPng));
  return true;
}*/

// 备用方案2：纯文字帮助（服务器渲染图片失败时最省事，内容与代码同步维护，但是要注意文本过长等问题）
// 用法：把上面的 showHelp 注释掉，再把下面这个函数取消注释（即增删两端的/*与*/）
/*async showHelp(e) {
    const helpMessage =
`【DeepSeekAI 插件指令帮助 v${version}】

触发对话：
  消息中包含「${TRIGGER_WORDS.join('」或「')}」、或者 @机器人 即可对话
  私聊沉浸式对话：#ds开始对话 / #ds结束对话（30 分钟无对话自动结束）
  带图片一起发送/回复某张图片：图像理解开启时会自动识图

对话管理：
  清空当前会话：#ds清空对话
  保存本次对话：#ds存储对话名称（名称可省略）
  列出已保存的对话：#ds查询对话
  载入历史对话：#ds选择对话文件名（可省略 .json）
  删除已保存的对话：#ds删除对话文件名
  群聊成员是否分开记忆：#ds群聊分离开启 / #ds群聊分离关闭 / #ds群聊分离状态

预设管理：
  自定义AI人格：#ds设置预设内容
  恢复默认人格：#ds清空预设
  切换系统预设：#ds选择预设1~${Presets.length}
  查看当前预设：#ds查看预设

模型与思考：
  查询并切换模型：#ds模型（列出编号后，回复序号即可切换，回复 0 恢复默认）
  思考模式：#ds思考模式开启 / #ds思考模式关闭 / #ds思考模式状态
  思考强度：#ds思考强度low / #ds思考强度high / #ds思考强度max
  图像理解：#ds图像理解开启 / #ds图像理解关闭 / #ds图像理解状态
  恢复本会话默认配置：#ds重置设置

权限管理（群管/主人可用；标注主人的仅主人可用）：
  用户白名单：#ds白名单添加12345678 / #ds白名单删除12345678（给指定的人修改AI参数的权限）
  用户黑名单：#ds黑名单添加12345678 / #ds黑名单删除12345678（禁用所有功能）
  拉黑群（仅主人）：#ds拉黑群 或 #ds拉黑群123456789
  解除拉黑群（仅主人）：#ds解除拉黑群 或 #ds解除拉黑群123456789

其他：
  显示帮助：#ds帮助
  API余额查询：#ds余额查询
  查询版本更新：#ds查询版本

【注意事项】
- 不同群聊与私聊的对话记录不互通
- 被拉黑的群只响应 #ds帮助
- 每次对话最多保留 ${MAX_HISTORY} 条历史记录
- 30 分钟无对话，历史记录将自动清空
- 单条输入长度不能超过 ${MAX_INPUT_LENGTH} 个字符
- 图片不写入对话历史，只保留 [图片] 占位
- 图像理解需要支持图片的模型（如 deepseek-flash），文字模型收到图片会自动临时切换
- 思考模式下 temperature 会被官方忽略，关闭思考后才生效
- 指令里的空格可有可无：#ds思考模式开启 与 #ds思考模式 开启 等价
- 对话历史的优先级高于预设，改完预设先清空对话历史`;
    e.reply(helpMessage);
    return true;
  }*/




  // #ds思考模式
  async setThinkingMode(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

    const action = e.msg.replace(/^#ds思考模式/, '').trim();
    if (!['开启', '关闭', '状态'].includes(action)) {
      e.reply('格式： #ds思考模式开启 / #ds思考模式关闭 / #ds思考模式状态');
      return true;
    }

    const { sessionKey, session } = getOrCreateSession(e);
    const model = session.model || DEFAULT_MODEL;
    const effort = session.effort || getDefaultEffort(model);
    const on = session.thinking ?? THINKING_DEFAULT;

    if (action === '状态') {
      e.reply(`当前思考模式：${on ? '开启' : '关闭'}\n思考强度：${effort}（该模型支持：${getEffortLevels(model).join(' / ')}）\n当前模型：${model}`);
      return true;
    }

    session.thinking = action === '开启';
    await saveSessionSettings(sessionKey, { thinking: session.thinking });
    e.reply(session.thinking
      ? `已开启思考模式（强度 ${effort}）：回答更准确，但更慢更贵，且 temperature 会被官方忽略`
      : '已关闭思考模式：回复更快更便宜，temperature 重新生效');
    return true;
  }

  // #ds思考强度
  async setThinkingEffort(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

    const action = e.msg.replace(/^#ds思考强度/, '').trim().toLowerCase();
    const { sessionKey, session } = getOrCreateSession(e);
    const model = session.model || DEFAULT_MODEL;
    const levels = getEffortLevels(model);

    if (action === '状态') {
      e.reply(`当前思考强度：${session.effort || getDefaultEffort(model)}（该模型支持：${levels.join(' / ')}）`);
      return true;
    }
    if (!levels.includes(action)) {
      e.reply(`无效的思考强度，该模型支持：${levels.join(' / ')}\n用法： #ds思考强度${levels[0]}（例如 #ds思考强度${levels[levels.length - 1]}）`);
      return true;
    }

    session.effort = action;
    await saveSessionSettings(sessionKey, { effort: action });
    e.reply(`思考强度已设为：${action}${session.thinking ? '' : '（当前思考模式为关闭，需先 #ds思考模式 开启 才生效）'}`);
    return true;
  }

  // #ds图像理解
  async setVisionMode(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

    const action = e.msg.replace(/^#ds图像理解/, '').trim();
    if (!['开启', '关闭', '状态'].includes(action)) {
      e.reply('格式： #ds图像理解开启 / #ds图像理解关闭 / #ds图像理解状态');
      return true;
    }

    const { sessionKey, session } = getOrCreateSession(e);
    const model = session.model || DEFAULT_MODEL;

    if (action === '状态') {
      const on = session.vision ?? VISION_DEFAULT;
      const capability = modelSupportsVision(model)
        ? '（支持图片）'
        : `（不支持图片，收到图片时会自动临时改用 ${pickVisionModel()}）`;
      e.reply(`当前图像理解：${on ? '开启' : '关闭'}\n当前模型：${model}${capability}`);
      return true;
    }

    session.vision = action === '开启';
    await saveSessionSettings(sessionKey, { vision: session.vision });
    e.reply(session.vision
      ? '已开启图像理解：带图消息会自动把图片交给模型识别'
      : '已关闭图像理解：收到图片时会忽略图片，只按文字回复');
    return true;
  }

  // #ds模型
  async listModels(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

    const list = await fetchModelList();
    if (!list.length) {
      e.reply('获取模型列表失败，请稍后重试（可检查密钥是否有效、网络是否可达）');
      return true;
    }

    const { sessionKey, session } = getOrCreateSession(e);
    const current = session.model || DEFAULT_MODEL;
    // 只展示前 20 个，避免消息过长；编号顺序与等待选择的列表保持一致
    const shown = list.slice(0, 20);
    // 清理已经过期的等待项，避免 Map 无限增长
    for (const [k, v] of pendingModelPick) if (Date.now() > v.expireAt) pendingModelPick.delete(k);
    pendingModelPick.set(modelPickKey(e), {
      ids: shown.map(m => m.id),
      expireAt: Date.now() + MODEL_PICK_TTL
    });

    const lines = [`当前模型：${current}（默认：${DEFAULT_MODEL}）`, '可用模型：'];
    shown.forEach((m, i) => {
      const vision = modelSupportsVision(m.id) ? '支持图片' : '不支持图片';
      const effort = getEffortLevels(m.id).join('/');
      const ctx = m.context_window ? `，${Math.round(m.context_window / 1024)}K 上下文` : '';
      const name = m.name && m.name !== m.id ? `（${m.name}）` : '';
      lines.push(`${i + 1}. ${m.id}${name} - ${vision}，思考档位 ${effort}${ctx}`);
    });
    lines.push(`回复序号即可切换（${MODEL_PICK_TTL / 1000} 秒内有效，回复 0 恢复默认模型）`);

    e.reply(lines.join('\n'));
    logger.info(`[deepseekAI] ${e.user_id} 查询模型列表，共 ${list.length} 个`);
    return true;
  }

  // 没有等待中的选择时返回 false，不吃掉普通数字消息
  async pickModelByNumber(e) {
    const key = modelPickKey(e);
    const pending = pendingModelPick.get(key);
    if (!pending) return false;                                   // 没有等待选择：交给其它规则处理
    if (Date.now() > pending.expireAt) {                           // 已过期
      pendingModelPick.delete(key);
      return false;
    }
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;

    const num = Number(String(e.msg).trim());
    if (!Number.isInteger(num) || num < 0 || num > pending.ids.length) {
      e.reply(`请输入 0 ~ ${pending.ids.length} 之间的序号`);
      return true;
    }

    const { sessionKey, session } = getOrCreateSession(e);
    if (num === 0) {
      delete session.model;
      await saveSessionSettings(sessionKey, { model: '' });        // 空字符串表示"使用默认模型"
      e.reply(`已恢复默认模型：${DEFAULT_MODEL}`);
    } else {
      const modelId = pending.ids[num - 1];
      session.model = modelId;
      await saveSessionSettings(sessionKey, { model: modelId });
      const tip = modelSupportsVision(modelId) ? '' : '\n注意：该模型不支持图片，收到图片时会临时改用支持图片的模型';
      e.reply(`已切换模型为：${modelId}${tip}`);
    }
    pendingModelPick.delete(key);
    return true;
  }

  // #ds重置设置
  async resetSessionSettings(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

    const sessionKey = getSessionKey(e);

    // 1) 删除持久化记录
    const existed = !!customPrompts[sessionKey];
    delete customPrompts[sessionKey];
    await saveCustomPrompts();

    // 2) 清掉内存会话里的配置字段（对话历史保持不动）
    const session = chatSessions[sessionKey];
    if (session) {
      delete session.customPrompt;
      delete session.model;
      delete session.thinking;
      delete session.effort;
      delete session.vision;
      session.presetIndex = 0; // 预设序号回到第一个系统预设
    }
    // 3) 丢弃"等待回复序号选模型"的临时状态，避免残留
    pendingModelPick.delete(modelPickKey(e));

    logger.info(`[deepseekAI] 已重置会话配置：${sessionKey}${existed ? '' : '（原本没有保存过配置）'}`);
    e.reply(
      '已把本会话恢复为默认配置：\n' +
      `模型：${DEFAULT_MODEL}\n` +
      `思考模式：${THINKING_DEFAULT ? '开启' : '关闭'}\n` +
      `思考强度：${THINKING_EFFORT_DEFAULT}\n` +
      `图像理解：${VISION_DEFAULT ? '开启' : '关闭'}\n` +
      '自定义预设：已清除' +
      (existed ? '' : '\n（提示：本会话之前并没有保存过配置）') +
      '\n（对话历史未清空，如需清空请用 #ds清空对话）'
    );
    return true;
  }

  // 对话功能
  async chat(e) {
    // 群黑名单的拦截统一由 checkTrigger 与各指令入口负责，这里不再重复判断

    // 取（或创建）会话：创建时自动恢复持久化的自定义预设与各项开关（思考模式/强度/图像理解/模型）
    const { sessionKey, session } = getOrCreateSession(e);

    // 初始化会话清理定时器
    this.initSessionCleaner();


    // ===== 获取回复上下文 =====
let replyText = ''
let replySender = ''
let replyIsBot = false
let replyImages = [] // 被引用消息里的图片：引用一张图再提问时也要能识别
const wantVision = session.vision ?? VISION_DEFAULT; // 提前取出图像理解开关

if (e.source || e.message?.some(m => m.type === 'reply')) {
  try {
    let replyMsg

    // ICQQ
    if (e.source) {
      if (e.isGroup) {
        replyMsg = await e.group.getChatHistory(e.source.seq, 1)
      } else {
        replyMsg = await e.friend.getChatHistory(e.source.time, 1)
      }
    }

    // NapCat / OneBot
    if (!replyMsg) {
      const replySeg = e.message.find(m => m.type === 'reply')
      if (replySeg) {
        if (e.isGroup) {
          replyMsg = await e.group.getChatHistory(replySeg.id, 1)
        } else {
          replyMsg = await e.friend.getChatHistory(replySeg.id, 1)
        }
      }
    }

    if (replyMsg && replyMsg[0]) {
      const msgObj = replyMsg[0]

      replyText = msgObj.message
        .filter(m => m.type === 'text')
        .map(m => m.text)
        .join('')

      // 被引用的消息里如果有图片，一并解析出来（形状与当前消息一致，复用同一个取图函数）
      if (wantVision && Array.isArray(msgObj.message)) {
        replyImages = await extractImageUrls({ message: msgObj.message });
        if (replyImages.length) {
          logger.info(`[deepseekAI] 被引用消息解析到 ${replyImages.length} 张图片`);
        } else {
          const quotedImageCount = msgObj.message.filter(m => m?.type === 'image').length;
          if (quotedImageCount) logger.warn(`[deepseekAI] 被引用消息里有 ${quotedImageCount} 张图片，但拿不到可用地址（适配器未提供 url/本地路径），本次无法识别`);
        }
      }

      replySender = msgObj.sender?.card || msgObj.sender?.nickname || msgObj.sender?.user_id
      replyIsBot = msgObj.sender?.user_id == Bot.uin
    }

  } catch (err) {
    logger.error('获取被回复消息失败', err)
  }
}

// 当前用户发送内容
let msg = e.msg.trim()

// 合并上下文
let finalMsg = msg

if (replyText) {
  if (replyIsBot) {
    finalMsg =
`你之前说：
${replyText}

用户回复：
${msg}`
  } else {
    finalMsg =
`用户「${replySender}」说：
${replyText}

用户回复：
${msg}`
  }
}

    
    // 输入有效性检查
    if (!msg) {
      e.reply('请输入内容');
      return false;
    }
    if (msg.length > MAX_INPUT_LENGTH) {
      e.reply(`输入文本长度过长，最多允许 ${MAX_INPUT_LENGTH} 个字符`);
      return true;
    }
    if (List.some(item => msg.includes(item))) {
      logger.info(`[deepseekAI] 检测到敏感词，已过滤`);
      e.reply("输入包含敏感词，已拦截");
      return true;
    }
  
    // 更新最后活跃时间
    session.lastActive = Date.now();

    // 图像理解：解析本条消息里的图片（最多 MAX_IMAGE_COUNT 张）
    const visionOn = wantVision;
    const ownImages = visionOn ? await extractImageUrls(e) : [];
    // 本条消息的图优先，引用消息的图补充；去重后仍受 MAX_IMAGE_COUNT 限制
    const images = visionOn ? [...new Set([...ownImages, ...replyImages])].slice(0, MAX_IMAGE_COUNT) : [];
    if (replyImages.length && visionOn) logger.info(`[deepseekAI] 本次请求共 ${images.length} 张图片（本条 ${ownImages.length} 张 + 引用 ${replyImages.length} 张）`);
    // 当前模型不支持图片时，本次请求临时改用支持图片的模型，避免官方返回 400
    let requestModel = session.model || DEFAULT_MODEL;
    if (images.length && !modelSupportsVision(requestModel)) {
      if (!modelCache.list.length) await fetchModelList(); // 首次需要官方元数据才能判断能力
      requestModel = pickVisionModel();
      logger.info(`[deepseekAI] 模型 ${session.model || DEFAULT_MODEL} 不支持图片，本次临时改用 ${requestModel}`);
    }

    // 添加用户消息到历史记录：图片不写入历史，只留一个占位标记，避免重复计费和存档膨胀
    session.history.push({ role: "user", content: images.length ? `${finalMsg} ${IMAGE_HISTORY_TAG}` : finalMsg });

    // 限制历史记录长度
    if (session.history.length > MAX_HISTORY) {
      session.history = session.history.slice(-MAX_HISTORY);
    }

    // API调用部分（密钥统一走 getApiKey()，所以 #ds填写密钥 改完立即生效，无需重启）
    const openai = new OpenAI({
      baseURL: Url,
      apiKey: getApiKey(),
    });

    // API调用时获取当前会话的预设
    const currentPrompt = session.customPrompt || Presets[session.presetIndex ?? 0];

    // 组装请求参数 
    // 思考模式：会话设置优先（默认关闭）。开启时传 reasoning_effort，并且不传 temperature
    const thinking = session.thinking ?? THINKING_DEFAULT;
    const effort = session.effort || getDefaultEffort(requestModel);
    const requestParams = {
      messages: [
        { role: "system", content: currentPrompt },
        ...session.history
      ],
      stream: false,
      model: requestModel,
      thinking: { type: thinking ? 'enabled' : 'disabled' }
    };
    if (thinking) {
      requestParams.reasoning_effort = effort; // 思考强度 low / high / max
    } else {
      requestParams.temperature = Temperature; // 只有非思考模式才需要温度
    }

    // 构造请求消息：有图片时，把本轮提问改写成"文字 + 图片"的多模态内容块
    const buildMessages = (imageUrls) => {
      const msgs = [
        { role: "system", content: currentPrompt },
        ...session.history
      ];
      if (imageUrls.length) {
        msgs[msgs.length - 1] = {
          role: 'user',
          content: [
            { type: 'text', text: finalMsg },
            ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))
          ]
        };
      }
      return msgs;
    };
    const isHttpUrl = (u) => /^https?:\/\//i.test(String(u || ''));

    // 发一次请求并取出回复内容
    const requestCompletion = async (params) => {
      const completion = await openai.chat.completions.create(params);
      const choice = completion.choices[0]?.message || {};
      // 思考模式下思维链在 reasoning_content 里；多轮对话（无工具调用）不需要回传，这里只记日志便于排查
      if (thinking) {
        if (choice.reasoning_content) logger.info(`[deepseekAI] 本次思考过程 ${choice.reasoning_content.length} 字（不写入历史）`);
        else logger.warn('[deepseekAI] 已开启思考模式，但本次响应没有 reasoning_content，可能未生效');
      } else if (choice.reasoning_content) {
        logger.warn('[deepseekAI] 未开启思考模式，但响应里带了 reasoning_content（服务端可能没按禁用处理）');
      }
      return choice.content;
    };

    const callOnce = async (imageUrls) => {
      const params = { ...requestParams, messages: buildMessages(imageUrls) };
      try {
        return await requestCompletion(params);
      } catch (err) {
        if (/thinking|reasoning_effort|unknown|unsupported|invalid.*(param|field)/i.test(String(err?.message))) {
          logger.warn(`[deepseekAI] 扩展参数可能不被支持，去掉后重试：${err.message}`);
          const plain = { ...params };
          delete plain.thinking;
          delete plain.reasoning_effort;
          return await requestCompletion(plain);
        }
        throw err;
      }
    };

    try {
      let content;
      try {
        content = await callOnce(images);
      } catch (firstErr) {
        // 图片直链可能下载不到，改成我们自己下载再转成 base64 重试一次
        if (images.length && images.some(isHttpUrl)) {
          logger.warn(`[deepseekAI] 请求失败，尝试把图片下载后转 base64 重试：${firstErr.message}`);
          const converted = [];
          for (const u of images) {
            converted.push(isHttpUrl(u) ? ((await downloadImageAsDataUrl(u)) || u) : u);
          }
          if (converted.some((u, i) => u !== images[i])) content = await callOnce(converted);
          else throw firstErr;
        } else {
          throw firstErr;
        }
      }

      // 敏感词检查（命中时回滚刚入栈的用户消息，避免留下"有问无答"的脏历史影响后续上下文）
      if (List.some(item => content.includes(item))) {
        logger.info(`[deepseekAI] 检测到输出敏感词：${content}`);
        session.history.pop();
        e.reply("回复包含敏感内容，已拦截");
        return true;
      }
  

      // 添加AI回复到历史记录
      session.history.push({ role: "assistant", content });
  
      // 发送主回复
      await e.reply(content);
      
      // 随机决定是否发送额外回复：先按概率算出"目标条数"，再走固定次数的循环
      let plannedReplies = 1;
      while (plannedReplies < 3 && Math.random() <= REPLY_PROBABILITY[plannedReplies]) {
        plannedReplies++;
      }
      for (let replyCount = 1; replyCount < plannedReplies; replyCount++) {
        
        // 延迟后再发送
        await new Promise(resolve => setTimeout(resolve, MIN_REPLY_INTERVAL));
        
        // 使用相同的上下文生成额外回复（沿用同样的模型/思考模式设置）
        const extraParams = {
          ...requestParams,
          messages: [
            { role: "system", content: currentPrompt },
            ...session.history
          ]
        };
        if (!thinking) extraParams.temperature = Temperature + 0.2; // 非思考模式才加随机性
        const extraCompletion = await openai.chat.completions.create(extraParams);
        
        const extraContent = extraCompletion.choices[0].message.content;
        if (List.some(item => extraContent.includes(item))) {
          logger.info(`[deepseekAI] 追加回复命中敏感词，已跳过本条`);
          continue; // 循环次数已固定，跳过不会造成死循环
        }
        await e.reply(extraContent);
        session.history.push({ role: "assistant", content: extraContent });
      }
  
      return true;
    } catch (error) {
      // 错误处理：仅当最后一条仍是"用户输入"（即本次提问完全没拿到回复）时才回滚并提示
      logger.error(`[deepseekAI] API调用失败：${error}`);
      if (session.history.at(-1)?.role === 'user') {
        session.history.pop(); // 移除无效的用户输入记录
        e.reply("对话失败，请稍后重试");
      }
      return false;
    }
  }

  // #ds存储对话
  async saveDialog(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

  const match = e.msg.match(/^#ds存储对话\s*(.*)$/);
  const dialogName = match ? match[1].trim() : '';

  try {
    const fileName = await saveDialogToFile(e, dialogName);
    e.reply(fileName
      ? `对话已保存，文件名：${fileName}`
      : '当前会话没有对话记录，无法保存');
  } catch (err) {
    logger.error(`[deepseekAI] 保存对话失败：${err.message}`);
    e.reply('对话保存失败，请检查插件文件权限或路径');
  }
  return true;
}

  // #ds查询对话
  async listDialogs(e) {
  // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
  if (this.blockIfGroupBlacklisted(e)) return false;
  try {
    const dir = path.resolve(__dirname, SAVE_PATH);
    const files = await fsPromises.readdir(dir);
    // 统一用 NON_DIALOG_FILES 排除名单/预设等文件，避免硬编码漏项
    const dialogFiles = files
      .filter(f => f.endsWith('.json') && !NON_DIALOG_FILES.includes(f))
      .sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs -
                      fs.statSync(path.join(dir, a)).mtimeMs);

    if (!dialogFiles.length) {
      e.reply('当前无保存的对话记录');
      return true;
    }

    const msg = ['当前保存的对话文件如下：'];
    dialogFiles.slice(0, 20).forEach((file, i) => {
      // 顺带显示保存时填写的名称，便于识别
      const savedName = savedDialogs[file]?.name;
      msg.push(`${i + 1}. ${file}${savedName ? `（${savedName}）` : ''}`);
    });
    msg.push('提示：#ds选择对话 文件名 可载入，#ds删除对话 文件名 可删除');
    e.reply(msg.join('\n'));
  } catch (err) {
    logger.error(`[deepseekAI] 查询对话出错：${err.message}`);
    e.reply('查询失败，请检查插件文件权限或路径');
  }
  return true;
}


  // #ds选择对话
  async loadDialog(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

  const match = e.msg.match(/^#ds选择对话\s*(\S+)$/);
  if (!match) {
    e.reply('请提供有效的对话文件名，例如：#ds选择对话 group_123_xxx.json');
    return true;
  }

  // 允许省略 .json 后缀；只取文件名部分，防止 ../../ 之类的路径穿越
  let fileName = path.basename(match[1].trim());
  if (!fileName.endsWith('.json')) fileName += '.json';
  const filePath = path.resolve(__dirname, SAVE_PATH, fileName);

  try {
    const data = JSON.parse(await fsPromises.readFile(filePath, 'utf-8'));

    const sessionKey = getSessionKey(e);

    chatSessions[sessionKey] = {
      history: data.history || [],
      presetIndex: typeof data.presetIndex === 'number' ? data.presetIndex : 0,
      lastActive: Date.now(),
      model: data.model || DEFAULT_MODEL 
    };

    if (data.customPrompt) {
      chatSessions[sessionKey].customPrompt = data.customPrompt;
    }

    e.reply(`对话文件 ${fileName} 已成功载入（共 ${chatSessions[sessionKey].history.length} 条记录）`);
  } catch (err) {
    logger.error(`[deepseekAI] 对话加载失败：${err.message}`);
    logger.error(err.stack);
    e.reply('对话加载失败，文件可能不存在或已损坏');
  }

  return true;
}


  // #ds删除对话
  async deleteDialog(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

    const match = e.msg.match(/^#ds删除对话\s*(\S+)/);
    if (!match) {
      e.reply('请提供要删除的对话文件名，例如：#ds删除对话 group_123_xxx.json');
      return true;
    }

    // 允许省略 .json 后缀；只取文件名部分，防止路径穿越
    let fileId = path.basename(match[1].trim());
    if (!fileId.endsWith('.json')) fileId += '.json';

    // 名单/预设等非对话文件不允许通过该指令删除
    if (NON_DIALOG_FILES.includes(fileId)) {
      e.reply('该文件不是对话记录，无法删除');
      return true;
    }

    try {
      await fsPromises.unlink(path.resolve(__dirname, SAVE_PATH, fileId));
      delete savedDialogs[fileId];
      e.reply(`对话记录 ${fileId} 删除成功`);
    } catch (err) {
      logger.error(`[deepseekAI] 删除失败：${err}`);
      e.reply('对话删除失败，文件可能不存在或权限不足');
    }
    return true;
  }
  
  // #ds选择预设
async selectPreset(e) {
  // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
  if (this.blockIfGroupBlacklisted(e)) return false;
  if (this.isBlacklisted(e)) return true;
  if (!await this.isAdminOrMaster(e)) return true;

  // 同时匹配两种格式的命令
  const match = e.msg.match(/^#ds选择预设\s*(\d+)$|#切\s*(\d+)$/);
  
  // 获取匹配到的数字
  const num = match ? (match[1] || match[2]) : null;
  
  // 转换为索引（从0开始）
  const index = num ? parseInt(num) - 1 : -1;
  if (isNaN(index)) {
    e.reply('请输入有效的预设编号（数字）');
    return true;
  }

  const sessionKey = getSessionKey(e);
  
  // 会话初始化检查
  if (!chatSessions[sessionKey]) {
    chatSessions[sessionKey] = {
      history: [],
      presetIndex: 0,    // 默认使用第一个系统预设
      lastActive: Date.now()
    };
  }

  if (index >= 0 && index < Presets.length) {
  // 清除自定义预设（内存 + 持久化），其余会话设置（思考模式/模型等）用合并写入保留
  delete chatSessions[sessionKey].customPrompt;
  delete customPrompts[sessionKey]?.customPrompt;
  await saveSessionSettings(sessionKey, { presetIndex: index });

  chatSessions[sessionKey].presetIndex = index;
  e.reply(`已切换至系统预设 ${index + 1}`);
}
 else {
    e.reply(`无效编号，当前可用预设1~${Presets.length}`);
  }
  return true;
}

  // #ds群聊分离
async toggleGroupSeparation(e) {
  // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
  if (this.blockIfGroupBlacklisted(e)) return false;
  if (this.isBlacklisted(e)) return true;
  if (!await this.isAdminOrMaster(e)) return true;

  const action = e.msg.match(/^#ds群聊分离\s*(开启|关闭|状态)$/)[1];
  let replyMsg = '';

  switch (action) {
    case '开启':
      GROUP_MEMBER_SEPARATE = true;
      replyMsg = '已开启：群聊内每个成员的对话将独立记录';
      break;
    case '关闭':
      GROUP_MEMBER_SEPARATE = false;
      replyMsg = '已关闭：群聊内所有成员共用同一对话历史';
      break;
    case '状态':
      replyMsg = `当前群聊对话分离状态：${GROUP_MEMBER_SEPARATE ? '开启' : '关闭'}`;
      break;
  }

  e.reply(replyMsg);
  return true;
}

 // #ds开始对话
  async starttalk(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;

  if (e.isGroup) {
   e.reply('请私聊使用'); // 群聊
  } else {
    // redis 记录沉浸式对话状态，并设置有效期（闲置超时自动结束）
    const actionKey = "deepseek:" + e.user_id + ":action";
    await redis.set(actionKey, "start");
    await redis.expire(actionKey, IMMERSIVE_TTL);
    // 私聊
    e.reply('[开始直接对话]...');
  }
    return true;
  }

  // #ds结束对话
  async endtalk(e) {
    // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
    if (this.blockIfGroupBlacklisted(e)) return false;
    if (this.isBlacklisted(e)) return true;

  if (e.isGroup) {
    e.reply('请私聊使用');  // 群聊
  } else {
    // 直接删除状态，不会在 Redis 里留下无用数据
    await redis.del("deepseek:" + e.user_id + ":action");
    // 私聊
    e.reply('[结束对话]...');
  }
    return true;
  }

  // 版本查询
  async checkVersion(e) {
  // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
  if (this.blockIfGroupBlacklisted(e)) return false;

  const remoteUrls = [
    'https://gitee.com/atri0828a/deepseekAI.js-for-yunzai/raw/master/deepseekAI-2.js',
    'https://raw.githubusercontent.com/Atri0828a/Yunzai-deepseekAI/refs/heads/master/deepseekAI-2.js'
  ];

  let remoteCode = null;
  let successfulUrl = null;

  for (const url of remoteUrls) {
    try {
      const response = await axios.get(url, { timeout: 5000 });
      remoteCode = response.data;
      successfulUrl = url;
      break;
    } catch {
      logger.warn(`[deepseekAI] 无法访问远程地址：${url}`);
    }
  }

  if (!remoteCode) {
    e.reply('版本检查失败，所有远程地址均无法访问');
    return true;
  }

  // 提取远程版本号
  const versionMatch = remoteCode.match(/const\s+version\s*=\s*['"`]([\d.]+)['"`]/);
  const remoteVersion = versionMatch?.[1] ?? '未知';

  // 提取 changelog JSON 字符串
  const changelogMatch = remoteCode.match(/const\s+changelog\s*=\s*({[\s\S]*?});/);
  let changelogObj = {};
  if (changelogMatch) {
    try {
      changelogObj = eval(`(${changelogMatch[1]})`);
    } catch (err) {
      logger.warn('[deepseekAI] changelog 解析失败');
    }
  }

  // 获取远程 changelog
  const remoteChanges = changelogObj?.[remoteVersion] || [];

  let updateMsg = '';
  if (this.compareVersions(remoteVersion, version) > 0) {
    updateMsg = `\n发现新版本 ${remoteVersion} 可供更新`;
  } else {
    updateMsg = `\n当前已是最新版本`;
  }

  const changelogText = remoteChanges.length
    ? `\n\n新版本更新内容：\n- ${remoteChanges.join('\n- ')}`
    : '';

  e.reply(
    `版本信息：\n` +
    `当前版本：${version}\n` +
    `最新版本：${remoteVersion}\n` +
    `数据来源：${successfulUrl}` +
    updateMsg +
    changelogText
  );

  return true;
}



// 版本比较函数
compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

// #ds黑白名单
async manageList(e) {
  // 群黑名单拦截（被拉黑的群除 #ds帮助 外一律不响应）
  if (this.blockIfGroupBlacklisted(e)) return false;

  const userId = e.user_id.toString();

  // 判断权限
  if (!await this.isAdminOrMaster(e)) return true;
  if (whitelist.includes(userId)) {
    e.reply('白名单用户无权修改黑白名单');
    return true;
  }

  const msg = e.msg.trim();
  const match = msg.match(/^#ds(黑名单|白名单)\s*(添加|删除)\s*(\d{5,12})$/);
  if (!match) {
    e.reply('指令格式错误，请使用 #ds白名单添加/删除12345678');
    return true;
  }

  const [, type, action, targetQQ] = match;
  const list = (type === '黑名单') ? blacklist : whitelist;
  const otherList = (type === '黑名单') ? whitelist : blacklist;
  const pathToFile = (type === '黑名单') ? BLACKLIST_PATH : WHITELIST_PATH;

  if (action === '添加') {
    if (list.includes(targetQQ)) {
      e.reply(`${type}中已存在 ${targetQQ}`);
      return true;
    }
    if (otherList.includes(targetQQ)) {
      e.reply(`${targetQQ} 已在另一名单中，不能重复存在`);
      return true;
    }
    list.push(targetQQ);
    await fsPromises.writeFile(pathToFile, JSON.stringify(list, null, 2));
    e.reply(`已将 ${targetQQ} 添加到${type}`);
  }

  if (action === '删除') {
    const index = list.indexOf(targetQQ);
    if (index === -1) {
      e.reply(`${type}中未找到 ${targetQQ}`);
      return true;
    }
    list.splice(index, 1);
    await fsPromises.writeFile(pathToFile, JSON.stringify(list, null, 2));
    e.reply(`已将 ${targetQQ} 从${type}中移除`);
  }

  return true;
}

// #ds拉黑群
async manageGroupBlacklist(e) {
  if (!this.isMaster(e)) {
    if (this.blockIfGroupBlacklisted(e)) return false;
    e.reply('只有主人可以使用群黑名单指令');
    return true;
  }

  const match = e.msg.trim().match(/^#ds(拉黑群|解除拉黑群)\s*(\d{5,12})?$/);
  if (!match) {
    e.reply('格式错误，请使用：#ds拉黑群 / #ds拉黑群123456789');
    return true;
  }

  const [, action, groupIdArg] = match;
  // 未接群号 => 以当前群为目标；私聊里没有"当前群"，必须显式给出群号
  const groupId = groupIdArg || (e.isGroup ? e.group_id.toString() : '');
  if (!groupId) {
    e.reply('私聊中使用该指令需要带上群号，例如：#ds拉黑群123456789');
    return true;
  }

  if (action === '拉黑群') {
    if (groupBlacklist.includes(groupId)) {
      e.reply(`群 ${groupId} 已在黑名单中`);
    } else {
      groupBlacklist.push(groupId);
      await fsPromises.writeFile(GROUP_BLACKLIST_PATH, JSON.stringify(groupBlacklist, null, 2));
      e.reply(`群 ${groupId} 已加入黑名单：该群将无法使用除 #ds帮助 以外的任何功能`);
    }
  }

  if (action === '解除拉黑群') {
    const index = groupBlacklist.indexOf(groupId);
    if (index === -1) {
      e.reply(`群 ${groupId} 不在黑名单中`);
    } else {
      groupBlacklist.splice(index, 1);
      await fsPromises.writeFile(GROUP_BLACKLIST_PATH, JSON.stringify(groupBlacklist, null, 2));
      e.reply(`群 ${groupId} 已移出黑名单：功能已恢复`);
    }
  }

  return true;
}

}