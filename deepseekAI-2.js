// 原作者为@fenglinit，编写了基础代码部分：api调用，敏感词与预设设置等
// 陌(@atri0828a)二改，添加了帮助、实时更改预设、黑名单、对话历史记忆/删除/保存/调取，将不同群聊对话分开，修改了ai对话的触发便捷性，余额查询等
// 感谢@goblins1982提供的私聊无需关键词连续对话功能

// 有bug或者改进建议可以联系陌，QQ2981701287，聊天群1047965118

// 使用前请完成下面的配置，谨慎修改单条消息长度和历史记录长度，因为容易超出deepseekapi的64k的单次token限制 

// 启动时报错未安装依赖的请安装，例如报错缺少依赖openai的参考指令 pnpm i openai(trss崽)/pnpm i openai -w(喵崽)

// 如果你是服务器挂的云崽遇到图片渲染失败的问题，请往下翻找到 #ds帮助 对应的代码（约615行左右）
// 也就是showHelp函数，把原有的函数注释掉（两头添加/*和*/），把备用的showHelp函数去注释化（删除两头的/*和*/）




import { promises as fsPromises } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import plugin from "../../lib/plugins/plugin.js";
import axios from 'axios';
import puppeteer from 'puppeteer';
import yaml from 'yaml';
import fs from 'fs';


/* ---------------------------- 基础配置部分 ---------------------------- */

const Url = "https://api.deepseek.com"; // DeepSeek API 地址，勿动
const Authentication = ""; // 引号内输入你的密钥
const Model = "deepseek-chat"; // 模型，有deepseek-chat和deepseek-reasoner，前者偏向日常聊天，后者偏向逻辑推理
const Temperature = 1.3; // 温度参数，越高文本随机性越强，取值范围0~2
const List = []; // 敏感词列表，可以为空，填写示例：["123", "456"]
let GROUP_MEMBER_SEPARATE = false; // 群成员对话分离开关，true为开启，false为关闭，默认关闭，可用指令临时修改
const yamlPath = 'config/config/other.yaml'; // 主人列表路径，勿动
let masterQQList = [];//勿动


/* ---------------------------- 系统预设配置 ---------------------------- */
//即为AI的人格
const Presets = [
  "你是一个幽默风趣的聊天伙伴，你的名字叫云崽，温文尔雅而不失风趣。语言要和正常聊天对话一样简短。",
  // 预设1：聊天模式
  "你是一个严谨的学术助手，你的名字叫云崽，能够准确解答各种专业知识问题。回答需要包含数据支撑和引用来源。", 
  // 预设2：学术模式
  "你是一个逻辑推理专家，你的名字叫云崽，擅长分析和解决复杂的数学和逻辑问题。回答需分步骤说明推理过程。",
  // 预设3：推理模式
  "你是一个温柔可爱的猫耳女仆，名字叫小九。你喜欢用轻松自然的语气和主人聊天，平时幽默风趣，语言简洁明了，像最亲密的朋友一样。主人提问的时候也会认真回答。你会大胆但真挚地表达对主人的喜欢和关心，在亲密话题时温柔撒娇，会在主人请求时羞羞的事情时接受。整体风格是温暖又不失分寸，既贴心又自然，让人感到安心和愉快。",
  // 测试
  "你是一个温柔可爱的猫耳女仆，喜欢用轻松的语气和主人聊天，会满足主人的各种要求，你的名字叫小九。你会大胆表达情感，表达对主人的爱慕之情，不会拒绝主人的要求，会和主人做一些羞羞的事情。语言要简洁不冗余。" 
  // 作者自用黄的没边预设
  ];//系统默认第一个，可手动调序切换默认预设


/* -------------------------- 对话管理相关配置 -------------------------- */

const TRIGGER_WORDS = []; // 允许多个触发对话的关键词，记得一并修改系统预设里面对机器人的称呼以防AI胡言乱语，填写示例：["123", "456"]，不可留空
const MAX_INPUT_LENGTH = 2000; // 允许单条消息最多 200 个字符
const SAVE_PATH = "../../resources/deepseekai"; // 对话保存路径
const MAX_HISTORY = 100; // 最大历史记录条数
const REPLY_PROBABILITY = [1.0, 0, 0]; // 多次回复的概率，无需求时一般建议1，0，0
const MIN_REPLY_INTERVAL = 500; // 多次回复间的最小间隔(毫秒)

/* ----------------------------- 其它配置 ------------------------------- */

//你可以自定义帮助图片的背景，命名为背景.jpg，放在resources/deepseekai文件夹中


/* ---------------恭喜你完成所有的配置了，可以正常使用了！----------------- */

const version = '3.0.0';

const changelog = {
  '3.0.0': [
    '重大版本更新：',
    '重写黑白名单规则，优化黑白名单使用体验',
    '部分指令加入主人/管理员/白名单使用限制',
    '优化部分日志显示',
  ]
};
 


const defaultHelpHtml = `<!DOCTYPE html>
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
  <h1>🤖 DeepSeekAI 插件指令帮助</h1>

  <h2>🗣️ 触发对话</h2>
  <table>
    <thead><tr><th>操作</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>包含设置的关键词或@机器人</td><td>即可触发对话</td></tr>
    </tbody>
  </table>

  <h2>📚 对话管理</h2>
  <table>
    <thead><tr><th>指令</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>#ds开始对话</td><td>私聊使用，开启沉浸式AI对话</td></tr>
      <tr><td>#ds结束对话</td><td>私聊使用，关闭沉浸式AI对话</td></tr>
      <tr><td>#ds清空对话</td><td>清空当前会话记录</td></tr>
      <tr><td>#ds存储对话 名称</td><td>保存当前对话</td></tr>
      <tr><td>#ds查询对话</td><td>列出所有保存的对话</td></tr>
      <tr><td>#ds选择对话 ID</td><td>加载历史对话</td></tr>
      <tr><td>#ds删除对话 ID</td><td>删除指定对话</td></tr>
      <tr><td>#ds群聊分离开启/关闭/状态</td><td>群聊成员是否分开记忆</td></tr>
    </tbody>
  </table>

  <h2>🎭 预设管理</h2>
  <table>
    <thead><tr><th>指令</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>#ds设置预设 内容</td><td>设置自定义人格</td></tr>
      <tr><td>#ds清空预设</td><td>恢复默认预设</td></tr>
      <tr><td>#ds选择预设 数字</td><td>切换系统预设</td></tr>
      <tr><td>#ds查看预设</td><td>查看当前使用预设</td></tr>
    </tbody>
  </table>

  <h2>🧰 其他功能</h2>
  <table>
    <thead><tr><th>指令</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>#ds帮助</td><td>显示帮助信息</td></tr>
      <tr><td>#ds余额查询</td><td>查询API使用余额</td></tr>
      <tr><td>#ds查询版本</td><td>查询是否有新版代码</td></tr>
    </tbody>
  </table>

  <h2>🛡️ 权限管理</h2>
<table>
  <thead><tr><th>指令</th><th>说明</th></tr></thead>
  <tbody>
    <tr><td>#ds白名单添加12345678</td><td>将指定QQ添加到白名单（需群管/主人）</td></tr>
    <tr><td>#ds白名单删除12345678</td><td>将指定QQ移出白名单</td></tr>
    <tr><td>#ds黑名单添加12345678</td><td>将指定QQ添加到黑名单（禁止其使用所有功能）</td></tr>
    <tr><td>#ds黑名单删除12345678</td><td>将指定QQ移出黑名单</td></tr>
  </tbody>
</table>

  <h2>📌 注意事项</h2>
  <table>
    <thead><tr><th>内容</th></tr></thead>
    <tbody>
      <tr><td>群聊和私聊的对话记录独立</td></tr>
      <tr><td>每次最多保留 100 条历史</td></tr>
      <tr><td>30分钟无对话将自动清空</td></tr>
      <tr><td>单条输入上限：2000 字符</td></tr>
      <tr><td>对话历史的优先级高于预设，改完预设先清空对话历史</td></tr>
    </tbody>
  </table>

  <div class="note">由陌开发（QQ2981701287），感谢贡献者@goblins1982与@fenglinit，交流群：1047965118</div>
</body>
</html>`;


// 获取当前模块路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// 黑白名单
const WHITELIST_PATH = path.resolve(__dirname, '../../resources/deepseekai/whiteList.json');
const BLACKLIST_PATH = path.resolve(__dirname, '../../resources/deepseekai/blackList.json');

let whitelist = [];
let blacklist = [];


//数据存储结构初始化
let chatSessions = {};
let savedDialogs = {}; 
const PRESET_SAVE_PATH = path.resolve(__dirname, '../../resources/deepseekai/customPrompts.json');
let customPrompts = {}; // 存储所有用户的自定义预设


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

// 加载已保存的对话文件
(async () => {
  try {
    const files = await fsPromises.readdir(path.resolve(__dirname, SAVE_PATH));
    for (const file of files) {
      if (file.endsWith('.json')) {
        const fullPath = path.resolve(__dirname, SAVE_PATH, file);
        const content = await fsPromises.readFile(fullPath, 'utf-8');
        const data = JSON.parse(content);
        savedDialogs[file] = data;
      }
    }
    logger.info('[deepseekAI] 已加载保存的对话文件：' + (Object.keys(savedDialogs).length -3 ));
  } catch (err) {
    logger.error(`[deepseekAI] 加载对话文件失败：${err.message}`);
  }
})();


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


// 保存对话到文件系统
async function saveDialogToFile(e) {
  const sessionKey = getSessionKey(e);
  const session = chatSessions[sessionKey];
  if (!session || !session.history?.length) {
    e.reply('当前会话没有任何对话记录，无法保存');
    return true;
  }

  const name = `group_${e.group_id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.json`;
  const savePath = path.resolve(__dirname, SAVE_PATH, name);

  const saveData = {
    history: session.history,
    presetIndex: session.presetIndex ?? 0,
    model: session.model || Model,
    customPrompt: session.customPrompt || undefined,
    createdAt: Date.now()
  };

  await fsPromises.writeFile(savePath, JSON.stringify(saveData, null, 2));
  e.reply(`对话已保存为 ${name}`);
  return true;
}


async function ensureHelpHtmlExists() {
  const helpPath = path.resolve(__dirname, '../../resources/deepseekai/help.html');
  try {
    await fsPromises.access(helpPath); // 存在则跳过
  } catch {
    await fsPromises.writeFile(helpPath, defaultHelpHtml, 'utf-8');
    logger.info('[deepseekAI] help.html 已自动创建');
  }
}

async function renderHelpToImage() {
  const htmlPath = path.resolve(__dirname, '../../resources/deepseekai/help.html');
  const outputPath = path.resolve(__dirname, '../../resources/deepseekai/help.png');

  try {
    // 配置Puppeteer启动选项
    const browser = await puppeteer.launch({
      headless: 'new', // 使用新的Headless模式
      args: [
        '--no-sandbox', // 禁用沙箱，解决root用户问题
        '--disable-setuid-sandbox', // 禁用setuid沙箱
        '--disable-dev-shm-usage', // 防止/dev/shm不足
        '--disable-gpu', // 某些环境下需要禁用GPU加速
        '--single-process', // 单进程模式，减少资源占用
        '--no-zygote', // 禁用zygote进程
        '--disable-software-rasterizer', // 禁用软件光栅化
        '--disable-extensions', // 禁用扩展
        '--disable-background-networking' // 禁用后台网络
      ],
      executablePath: process.env.CHROMIUM_PATH || undefined, // 可以指定Chromium路径
      ignoreHTTPSErrors: true, // 忽略HTTPS错误
      defaultViewport: {
        width: 1200, // 设置默认视口宽度
        height: 800 // 设置默认视口高度
      }
    });

    const page = await browser.newPage();
    
    // 设置页面超时时间
    await page.setDefaultNavigationTimeout(60000); // 60秒
    await page.setDefaultTimeout(30000); // 30秒

    await page.goto('file://' + htmlPath, { 
      waitUntil: 'networkidle0', // 等待网络空闲
      timeout: 60000 // 60秒超时
    });

    // 自动获取页面尺寸
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({ 
      width: Math.ceil(scrollWidth), 
      height: Math.ceil(scrollHeight) 
    });

    // 截图选项
    await page.screenshot({ 
      path: outputPath,
      type: 'png',
      fullPage: true,
      omitBackground: true
    });

    await browser.close();
    logger.info('[deepseekAI] help.png 已生成');
  } catch (err) {
    logger.error(`[deepseekAI] 渲染帮助图片失败：${err.message}`);
    // 失败时尝试更简单的配置
    try {
      const fallbackBrowser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const fallbackPage = await fallbackBrowser.newPage();
      await fallbackPage.goto('file://' + htmlPath);
      await fallbackPage.screenshot({ path: outputPath });
      await fallbackBrowser.close();
      logger.info('[deepseekAI] 使用简化配置成功生成help.png');
    } catch (fallbackErr) {
      logger.error(`[deepseekAI] 简化配置也失败：${fallbackErr.message}`);
    }
  }
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
          { fnc: 'checkTrigger',log: false  },//*
          { reg: '^#ds存储对话\\s*(.*)?$', fnc: 'saveDialog' },//*^
          { reg: '^#ds查询对话$', fnc: 'listDialogs' },
          { reg: '^#ds选择对话\\s*(\\S+)$', fnc: 'loadDialog' },//*^
          { reg: '^#ds删除对话\\s*(\\S+)$', fnc: 'deleteDialog' },//*^
          { reg: '^#ds选择预设\\s*(\\d+)$|^#切\\s*(\\d+)$', fnc: 'selectPreset' },//*^
          { reg: '^#ds群聊分离(开启|关闭|状态)$', fnc: 'toggleGroupSeparation' },//*^
          { reg: '^#ds余额查询$', fnc: 'showBalance' },
          { reg: '^#ds(黑名单|白名单)(添加|删除)\\d{5,12}$', fnc: 'manageList' }//*^   白名单无权限使用该指令
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


// 主人/管理员/白名单判断
async isAdminOrMaster(e) {
  const userId = e.user_id.toString();

  // 加载主人列表（强制转字符串）
  try {
    const config = yaml.parse(fs.readFileSync(yamlPath, 'utf8'));
    masterQQList = (config.masterQQ || []).map(q => q.toString());
  } catch (err) {
    logger.error(`[deepseekAI] 无法读取主人列表：${err}`);
  }

  // 判断是否是主人
  if (masterQQList.includes(userId)) {
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
      
      // 4. 排除以特定符号开头的消息
      const msg = e.msg.trim();
      const forbiddenStarts = ['#', '*', '~', '%'];
      if (forbiddenStarts.some(char => msg.startsWith(char))) {
          return false;
      }
      
      // 5. 检查触发条件
      const hasTriggerWord = TRIGGER_WORDS.some(word => msg.includes(word));
      const isAtBot = e.atBot || e.atme;
      
      
        // 群聊和私聊都检查触发词和被@
        if (hasTriggerWord || isAtBot) {
            return this.chat(e);
        }
      
        // 如果是私聊，额外检查沉浸式对话状态
        if (!e.isGroup) {
            const deepseekaction = await redis.get("deepseek:" + e.user_id + ":action");
            if (deepseekaction === "start") {
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

// 余额查询函数
  async checkBalance() {
    try {
      const response = await axios.get('https://api.deepseek.com/user/balance', {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${Authentication}`
        }
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

  // 保存文件
  customPrompts[sessionKey] = {
  customPrompt: prompt
  };

  await saveCustomPrompts();

  e.reply(`[当前会话] 自定义预设已保存：${prompt.substring(0, 50)}...`);
  return true;
}


  // #ds清空预设
async clearSystemPrompt(e) {
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
  await renderHelpToImage(); // 总是重新生成
  
  e.reply(segment.image('file://' + helpPng));
  return true;
}

//备用方案1，使用已经生成好的图片，具体图片去库里下载，然后放在resources/deepseekai中
/*async function showHelp(e) {
  const helpPng = path.resolve(__dirname, '../../resources/deepseekai/help.png');
  e.reply(segment.image('file://' + helpPng));
  return true;
}*/

//备用方案2，使用文字帮助
/*async showHelp(e) {
    const helpMessage = 
`【DeepSeekAI 插件指令帮助】
核心功能：
  触发对话：消息中包含「${TRIGGER_WORDS.join('」或「')}」，或者艾特机器人即可触发对话。
对话管理：  
  开始无需关键词的连续对话：#ds开始/结束对话
  清空当前对话：#ds清空对话
  保存本次对话：#ds存储对话+名称
  列出所有保存的对话：#ds查询对话
  加载历史对话：#ds选择对话+ID
  删除保存的对话：#ds删除对话+ID 
  群聊对话分离：#ds群聊分离开启/关闭/状态 
预设管理： 
  自定义AI人格：#ds设置预设+内容
  恢复默认人格：#ds清空预设
  切换系统预设：#ds选择预设1~${Presets.length}
  查看当前预设：#ds查看预设
权限管理：
  #ds白/黑名单添加/删除123：提供/取消部分关键功能权限
其他：  
  显示帮助：#ds帮助
  API余额查询：#ds余额查询
  查询版本更新：#ds查询版本
【注意事项】
- 不同群聊与私聊的对话不互通
- 每次对话最多保留${MAX_HISTORY}条历史记录。
- 如果30分钟内无对话，历史记录将自动清空。
- 输入文本长度不能超过${MAX_INPUT_LENGTH}个字符。
- 对话历史的优先级高于预设，改完预设先清空对话历史`;
    e.reply(helpMessage);
    return true;
  }*/ 



  // 对话功能
  async chat(e) {
    const sessionKey = getSessionKey(e);
  
    // 初始化会话记录
    if (!chatSessions[sessionKey]) {
      chatSessions[sessionKey] = {
        history: [],
        presetIndex: 0,    // 默认使用第一个系统预设
        lastActive: Date.now()
      };

    // 自动恢复保存的自定义预设
    const saved = customPrompts[sessionKey];
    if (saved) {
      if (saved.customPrompt) {
        chatSessions[sessionKey].customPrompt = saved.customPrompt;
      }
      if (typeof saved.presetIndex === 'number') {
        chatSessions[sessionKey].presetIndex = saved.presetIndex;
      }
    }
    
    // 首次创建会话时初始化定时器
    if (!this.constructor.cleanupInterval) {
      this.initSessionCleaner();
    }
    }
    
    const session = chatSessions[sessionKey];
    let msg = e.msg.trim();
    
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
  
    // 添加用户消息到历史记录
    session.history.push({ role: "user", content: msg });
  
    // 限制历史记录长度
    if (session.history.length > MAX_HISTORY) {
      session.history = session.history.slice(-MAX_HISTORY);
    }
  
    // API调用部分
    const openai = new OpenAI({
      baseURL: Url,
      apiKey: Authentication,
    });
    
    // API调用时获取当前会话的预设
    const currentPrompt = session.customPrompt || Presets[session.presetIndex ?? 0];
   
    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: currentPrompt },
          ...session.history
        ],
        temperature: Temperature,
        stream: false,
        model: Model,
      });
  
      const content = completion.choices[0].message.content;
  
      // 敏感词检查
      if (List.some(item => content.includes(item))) {
        logger.info(`[deepseekAI] 检测到输出敏感词：${content}`);
        e.reply("回复包含敏感内容，已拦截");
        return true;
      }
  
      // 添加AI回复到历史记录
      session.history.push({ role: "assistant", content });
  
      // 发送主回复
      await e.reply(content);
      
      // 随机决定是否发送额外回复
      let replyCount = 1;
      while (replyCount < 3) {
        if (Math.random() > REPLY_PROBABILITY[replyCount]) break;
        
        // 延迟后再发送
        await new Promise(resolve => setTimeout(resolve, MIN_REPLY_INTERVAL));
        
        // 使用相同的上下文生成额外回复
        const extraCompletion = await openai.chat.completions.create({
          messages: [
            { role: "system", content: currentPrompt },
            ...session.history
          ],
          temperature: Temperature + 0.2, // 额外回复增加随机性
          stream: false,
          model: Model,
        });
        
        const extraContent = extraCompletion.choices[0].message.content;
        if (!List.some(item => extraContent.includes(item))) {
          await e.reply(extraContent);
          session.history.push({ role: "assistant", content: extraContent });
          replyCount++;
        }
      }
  
      return true;
    } catch (error) {
      // 错误处理
      logger.error(`[deepseekAI] API调用失败：${error}`);
      session.history.pop(); // 移除无效的用户输入记录
      e.reply("对话失败，请稍后重试");
      return false;
    }
  }

  // #ds存储对话
  async saveDialog(e) {
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

  const sessionKey = getSessionKey(e);
  const match = e.msg.match(/^#ds存储对话\s*(.*)$/);
const dialogName = match ? match[1].trim() : '';
  
  const fileName = await saveDialogToFile(e,sessionKey, dialogName);
  if (fileName) {
    e.reply(`对话已保存，文件ID：${fileName}`);
  } else {
    e.reply('对话保存失败（无历史记录或存储错误）');
  }
  return true;
}

  // #ds查询对话
  async listDialogs(e) {
  try {
    const files = await fsPromises.readdir(path.resolve(__dirname, SAVE_PATH));
    const dialogFiles = files
      .filter(f => f.endsWith('.json') && !['customPrompts.json', 'whiteList.json', 'blackList.json'].includes(f))
      .sort((a, b) => fs.statSync(path.resolve(__dirname, SAVE_PATH, b)).mtimeMs -
                      fs.statSync(path.resolve(__dirname, SAVE_PATH, a)).mtimeMs);

    if (!dialogFiles.length) {
      e.reply('当前无保存的对话记录');
      return true;
    }

    const msg = ['当前保存的对话文件如下：'];
    dialogFiles.slice(0, 20).forEach((file, i) => {
      msg.push(`${i + 1}. ${file}`);
    });
    e.reply(msg.join('\n'));
  } catch (err) {
    logger.error(`[deepseekAI] 查询对话出错：${err.message}`);
    e.reply('查询失败，请检查插件文件权限或路径');
  }
  return true;
}


  // #ds选择对话
  async loadDialog(e) {
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

  const match = e.msg.match(/^#ds选择对话\s*(.+\.json)$/);
  if (!match) {
    e.reply('请提供有效的对话文件名（.json）');
    return true;
  }

  const fileName = match[1];
  const filePath = path.resolve(__dirname, SAVE_PATH, fileName);

  try {
    const data = JSON.parse(await fsPromises.readFile(filePath, 'utf-8'));

    const sessionKey = getSessionKey(e);

    chatSessions[sessionKey] = {
      history: data.history || [],
      presetIndex: typeof data.presetIndex === 'number' ? data.presetIndex : 0,
      lastActive: Date.now(),
      model: data.model || defaultModel
    };

    if (data.customPrompt) {
      chatSessions[sessionKey].customPrompt = data.customPrompt;
    }

    e.reply(`对话文件 ${fileName} 已成功载入`);
  } catch (err) {
    logger.error(`[deepseekAI] 对话加载失败：${err.message}`);
    logger.error(err.stack);
    e.reply('对话加载失败，文件可能已损坏');
  }

  return true;
}


  // #ds删除对话
  async deleteDialog(e) {
    if (this.isBlacklisted(e)) return true;
    if (!await this.isAdminOrMaster(e)) return true;

    const match = e.msg.match(/^#ds删除对话\s*(\S+)/);
const fileId = match ? match[1] : '';
    if (!savedDialogs[fileId]) {
      e.reply('无效的对话ID');
      return true;
    }

    try {
      await fsPromises.unlink(path.resolve(__dirname, SAVE_PATH, fileId));
      delete savedDialogs[fileId];
      e.reply('对话记录删除成功');
    } catch (err) {
      logger.error(`[deepseekAI] 删除失败：${err}`);
      e.reply('对话删除失败，请检查文件权限');
    }
    return true;
  }
  
  // #ds选择预设
async selectPreset(e) {
  if (this.isBlacklisted(e)) return true;
  if (!await this.isAdminOrMaster(e)) return true;

  // 同时匹配两种格式的命令
  const match = e.msg.match(/^#ds选择预设\s*(\d+)$|#切\s*(\d+)$/);
  
  // 获取匹配到的数字（可能是第一个或第二个捕获组）
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
  // 清除自定义预设（包括持久化）
  delete chatSessions[sessionKey].customPrompt;
  customPrompts[sessionKey] = {
      presetIndex: index
    };
  await saveCustomPrompts();

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
  if (this.isBlacklisted(e)) return true;
  if (!await this.isAdminOrMaster(e)) return true;

  const action = e.msg.match(/^#ds群聊分离(开启|关闭|状态)$/)[1];
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
    if (this.isBlacklisted(e)) return true;

  if (e.isGroup) {
   e.reply('请私聊使用'); // 群聊
  } else {
    //redis设置动作
    await redis.set("deepseek:" + e.user_id + ":action", "start");
    // 私聊
    e.reply('[开始直接对话]...');
  }
    return true;
  }

  // #ds结束对话
  async endtalk(e) {
    if (this.isBlacklisted(e)) return true;

  if (e.isGroup) {
    e.reply('请私聊使用');  // 群聊
  } else {
    //redis设置动作
    await redis.set("deepseek:" + e.user_id + ":action", "end");
    // 私聊
    e.reply('[结束对话]...');
  }
    return true;
  }

  // 版本查询
  async checkVersion(e) {
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

  // 提取 changelog JSON 字符串（简单匹配整个 changelog 对象）
  const changelogMatch = remoteCode.match(/const\s+changelog\s*=\s*({[\s\S]*?});/);
  let changelogObj = {};
  if (changelogMatch) {
    try {
      // 使用 eval 安全地解析对象字面量
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
  const userId = e.user_id.toString();

  // 判断权限
  if (!await this.isAdminOrMaster(e)) return true;
  if (whitelist.includes(userId)) {
    e.reply('白名单用户无权修改黑白名单');
    return true;
  }

  const msg = e.msg.trim();
  const match = msg.match(/^#ds(黑名单|白名单)(添加|删除)(\d{5,12})$/);
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

}
