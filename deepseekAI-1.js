/*
 * @Author: 枫林 670979892@qq.com
 * @Date: 2025-02-01 10:44:28
 * @LastEditors: 枫林 670979892@qq.com
 * @LastEditTime: 2025-02-04 16:43:25
 * @FilePath: \undefinedd:\user\Desktop\deepseek.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */



// 原作者为枫林，编写了基础代码部分：api调用，敏感词与预设设置等
// 陌 二改，添加了帮助、实时更改预设、对话历史记忆/删除/保存/调取，将不同群聊对话分开，修改了ai对话的触发便捷性，余额查询等

// 有bug或者改进建议可以联系陌，QQ2981701287，聊天群696334113

// 使用前请完成下面的配置，谨慎修改单条消息长度和历史记录长度，因为容易超出deepseekapi的64k的单次token限制 

// 启动时报错未安装依赖的请安装，例如报错缺少依赖openai的参考指令 pnpm i openai(trss崽)/pnpm i openai -w(喵崽)




import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';
import puppeteer from 'puppeteer';


/* ---------------------------- 基础配置部分 ---------------------------- */

const Url = "https://api.deepseek.com"; // DeepSeek API 地址，勿动
const Authentication = ""; // 引号内输入你的密钥
const Model = "deepseek-chat"; // 模型，有deepseek-chat和deepseek-reasoner，前者偏向日常聊天，后者偏向逻辑推理
const Temperature = 1.3; // 温度参数，越高文本随机性越强，取值范围0~2
const List = []; // 敏感词列表，可以为空，填写示例：["123", "456"]
let GROUP_MEMBER_SEPARATE = false; // 群成员对话分离开关，true为开启，false为关闭，默认关闭，可在此永久修改或用指令临时修改


/* ---------------------------- 系统预设配置 ---------------------------- */
//即为AI的人格
const Presets = [
  "你是一个幽默风趣的聊天伙伴，你的名字叫小巡，温文尔雅而不失风趣。语言要和正常聊天对话一样简短。",
  // 预设1：聊天模式
  "你是一个严谨的学术助手，你的名字叫小巡，能够准确解答各种专业知识问题。回答需要包含数据支撑和引用来源。", 
  // 预设2：学术模式
  "你是一个逻辑推理专家，你的名字叫小巡，擅长分析和解决复杂的数学和逻辑问题。回答需分步骤说明推理过程。",  
  // 预设3：推理模式
  "你是一个温柔可爱的猫耳女仆，喜欢用轻松的语气和主人聊天，会满足主人的各种要求，你的名字叫小巡。你会大胆表达情感，表达对主人的爱慕之情，不会拒绝主人的要求，会和主人做一些羞羞的事情。语言要简洁不冗余。" 
  // 作者自用黄的没边预设
];//系统初始预设默认第一个，可以通过调序来切换默认预设


/* -------------------------- 对话管理相关配置 -------------------------- */

const TRIGGER_WORDS = ["小巡", "巡"]; // 允许多个触发对话的关键词，记得一并修改系统预设里面对机器人的称呼
const MAX_INPUT_LENGTH = 2000; // 允许单条消息最多 200 个字符
const SAVE_PATH = "../../resources/deepseekai"; // 对话保存路径
const MAX_HISTORY = 100; // 最大历史记录条数
const REPLY_PROBABILITY = [1.0, 0.2, 0.1]; // 多次回复的概率，第1次100%，第2次20%，第3次10%概率
const MIN_REPLY_INTERVAL = 500; // 多次回复间的最小间隔(毫秒)


/* ----------------------------- 其它配置 ------------------------------- */

//你可以自定义帮助图片的背景，命名为背景.jpg，放在resources/deepseekai文件夹中，记得删除旧的help.png和help.html
//ps：要手动删除的原因其实只是我懒得写替换旧图片的函数而已，嘻嘻

/* ---------------恭喜你完成所有的配置了，可以正常使用了！----------------- */


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
      <tr><td>包含设置的关键词</td><td>即可触发对话</td></tr>
    </tbody>
  </table>

  <h2>📚 对话管理</h2>
  <table>
    <thead><tr><th>指令</th><th>说明</th></tr></thead>
    <tbody>
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

  <div class="note">由陌开发（QQ2981701287），感谢贡献者@goblins1982与@fenglinit，交流群：696334113</div>
</body>
</html>`;


// 获取当前模块路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

//数据存储结构初始化
let chatSessions = {};
let savedDialogs = {}; 

// 确保保存目录存在
(async () => {
  try {
    await fs.mkdir(path.resolve(__dirname, SAVE_PATH), { recursive: true });
    logger.info(`[deepseekAI] 存储目录初始化完成：${path.resolve(__dirname, SAVE_PATH)}`);
  } catch (err) {
    logger.error(`[deepseekAI] 目录创建失败：${err.message}`);
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
async function saveDialogToFile(sessionKey, dialogName = "") {
  const session = chatSessions[sessionKey];
  if (!session || session.history.length === 0) return false;

  // 添加随机后缀，防止大量的同时操作导致文件名重复
  const randomSuffix = Math.random().toString(36).slice(-4);
  const fileName = `${sessionKey}_${Date.now()}_${randomSuffix}.json`;
  const saveData = {
    version: "1.1", 
    schema: {
      sessionKey: sessionKey,
      model: Model 
    },
    name: dialogName || `对话_${fileName.slice(-8)}`, // 默认命名规则
    history: session.history,
    presetIndex: session.presetIndex,
    timestamp: Date.now()
  };

  try {
    await fs.writeFile(
      path.resolve(__dirname, SAVE_PATH, fileName),
      JSON.stringify(saveData, null, 2)
    );
    savedDialogs[fileName] = saveData; // 内存中记录元数据
    return fileName;
  } catch (err) {
    logger.error(`[deepseekAI] 对话保存失败：${err}`);
    return false;
  }
}

async function ensureHelpHtmlExists() {
  const helpPath = path.resolve(__dirname, '../../resources/deepseekai/help.html');
  try {
    await fs.access(helpPath); // 存在则跳过
  } catch {
    await fs.writeFile(helpPath, defaultHelpHtml, 'utf-8');
    logger.info('[deepseekAI] help.html 已自动创建');
  }
}

async function renderHelpToImage() {
  const htmlPath = path.resolve(__dirname, '../../resources/deepseekai/help.html');
  const outputPath = path.resolve(__dirname, '../../resources/deepseekai/help.png');

  try {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });

    const bodyHandle = await page.$('body');
    const box = await bodyHandle.boundingBox();
    await page.setViewport({ width: 800, height: Math.ceil(box.height) });

    await page.screenshot({ path: outputPath });
    await browser.close();

    logger.info('[deepseekAI] help.png 已生成');
  } catch (err) {
    logger.error(`[deepseekAI] 渲染帮助图片失败：${err.message}`);
  }
}

export class deepseekAI extends plugin
{
  static globalCleanupInterval = null;
  constructor() {
    super({
      name: 'deepseekAI',
      event: 'message',
      priority: 200,
      rule: [
          { reg: '^#ds清空对话$', fnc: 'clearHistory' },
          { reg: '^#ds设置预设\\s*([\\s\\S]*)$', fnc: 'setSystemPrompt' },
          { reg: '^#ds清空预设$', fnc: 'clearSystemPrompt' },
          { reg: '^#ds查看预设$', fnc: 'showSystemPrompt' },
          { reg: '^#ds帮助$', fnc: 'showHelp' },
          { reg: `^(?!.*#ds)[\\s\\S]*(?:${TRIGGER_WORDS.join('|')})[\\s\\S]*$`, fnc: 'chat' },
          { reg: '^#ds存储对话\\s*(.*)?$', fnc: 'saveDialog' },
          { reg: '^#ds查询对话$', fnc: 'listDialogs' },
          { reg: '^#ds选择对话\\s*(\\S+)$', fnc: 'loadDialog' },
          { reg: '^#ds删除对话\\s*(\\S+)$', fnc: 'deleteDialog' },
          { reg: '^#ds选择预设\\s*(\\d+)$', fnc: 'selectPreset' },
          { reg: '^#ds群聊分离(开启|关闭|状态)$', fnc: 'toggleGroupSeparation' },
          { reg: '^#ds余额查询$', fnc: 'showBalance' }
      ]
    });
  }
  
  // 定时器逻辑
  initSessionCleaner() {
  // 全局唯一检查
  if (this.constructor.globalCleanupInterval) return;
  
  this.constructor.globalCleanupInterval = setInterval(() => {
    const now = Date.now();
    Object.entries(chatSessions).forEach(([key, session]) => {
      if (session?.lastActive && now - session.lastActive > 30 * 60 * 1000) {//30分钟自动清除
        delete chatSessions[key];
        logger.info(`[deepseekAI] 会话超时已清理：${key}`);
      }
    });
  }, 10 * 60 * 1000);

  logger.info('[deepseekAI] 全局清理定时器已启动');
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
    const sessionKey = getSessionKey(e);
    if (chatSessions[sessionKey]) {
      chatSessions[sessionKey].history = [];
    }
    e.reply('[当前会话] 对话历史已清空');
    return true;
  }

  // #ds设置预设
  async setSystemPrompt(e) {
    const sessionKey = getSessionKey(e);
    const match = e.msg.match(/^#ds设置预设\s*([\s\S]*)$/);
const prompt = match ? match[1].trim() : '';
    
    // 初始化会话记录（如果不存在）
    if (!chatSessions[sessionKey]) {
      chatSessions[sessionKey] = {
        history: [],
        presetIndex: -1 // 标记为自定义预设
      };
    }
    
    // 更新会话的自定义预设
    chatSessions[sessionKey].customPrompt = prompt;
    e.reply(`[当前会话] 预设已更新为：${prompt.substring(0, 50)}...`);
    return true;
  }

  // #ds清空预设
  async clearSystemPrompt(e) {
    const sessionKey = getSessionKey(e);
    if (chatSessions[sessionKey]) {
      // 重置为系统第一个预设
      chatSessions[sessionKey].presetIndex = 0;
      delete chatSessions[sessionKey].customPrompt;
    }
    e.reply('[当前会话] 预设已重置为系统默认');
    return true;
  }

  // #ds查看预设
  async showSystemPrompt(e) {
    const sessionKey = getSessionKey(e);
    const session = chatSessions[sessionKey];
    
    let currentPrompt;
    if (session?.customPrompt) {
      currentPrompt = `自定义预设：${session.customPrompt.substring(0, 100)}...`;
    } else if (session?.presetIndex !== undefined) {
      currentPrompt = `系统预设${session.presetIndex + 1}：${Presets[session.presetIndex].substring(0, 100)}...`;
    } else {
      currentPrompt = '系统默认预设：' + Presets[0].substring(0, 100) + '...';
    }
    
    e.reply(`[当前会话] ${currentPrompt}`);
    return true;
  }

  // #ds帮助
  async showHelp(e) {
  const helpHtml = path.resolve(__dirname, '../../resources/deepseekai/help.html');
  const helpPng = path.resolve(__dirname, '../../resources/deepseekai/help.png');

  await ensureHelpHtmlExists();  // 自动创建 HTML
  try {
    await fs.access(helpPng);    // 检查 PNG 是否存在
  } catch {
    await renderHelpToImage();   // 不存在则生成
  }

  e.reply(segment.image('file://' + helpPng));
  return true;
}


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
      // 首次会话创建时初始化定时器
      if (Object.keys(chatSessions).length === 1 && !this.constructor.globalCleanupInterval) {
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
    const currentPrompt = session.customPrompt || Presets[session.presetIndex];
   
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
  const sessionKey = getSessionKey(e);
  const match = e.msg.match(/^#ds存储对话\s*(.*)$/);
const dialogName = match ? match[1].trim() : '';
  
  const fileName = await saveDialogToFile(sessionKey, dialogName);
  if (fileName) {
    e.reply(`对话已保存，文件ID：${fileName}`);
  } else {
    e.reply('对话保存失败（无历史记录或存储错误）');
  }
  return true;
}

  // #ds查询对话
  async listDialogs(e) {
    if (Object.keys(savedDialogs).length === 0) {
      e.reply('暂无保存的对话记录');
      return true;
    }

    const dialogList = Object.entries(savedDialogs)
      .map(([id, data]) => `ID：[${id}]\n名称：${data.name}\n时间：${new Date(data.timestamp).toLocaleString()}\n`)
      .join('\n');
    
    e.reply(`已保存的对话记录：\n${dialogList}`);
    return true;
  }

  // #ds选择对话
  async loadDialog(e) {
    const match = e.msg.match(/^#ds选择对话\s*(\S+)/);
const fileId = match ? match[1] : '';
    if (!fileId || !savedDialogs[fileId]) {
      e.reply('无效的对话ID，请使用#ds查询对话查看有效ID');
      return true;
    }

    const sessionKey = getSessionKey(e);
    try {
      const data = JSON.parse(
        await fs.readFile(path.resolve(__dirname, SAVE_PATH, fileId))
      );
      
      chatSessions[sessionKey] = {
        history: data.history.slice(-MAX_HISTORY), // 载入时自动截断
        presetIndex: data.presetIndex,
        lastActive: Date.now()
      };
      System_Prompt = Presets[data.presetIndex];
      e.reply(`已加载对话：${data.name}`);
    } catch (err) {
      logger.error(`[deepseekAI] 对话加载失败：${err}`);
      e.reply('对话加载失败，文件可能已损坏');
    }
    return true;
  }

  // #ds删除对话
  async deleteDialog(e) {
    const match = e.msg.match(/^#ds删除对话\s*(\S+)/);
const fileId = match ? match[1] : '';
    if (!savedDialogs[fileId]) {
      e.reply('无效的对话ID');
      return true;
    }

    try {
      await fs.unlink(path.resolve(__dirname, SAVE_PATH, fileId));
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
  const match = e.msg.match(/#ds选择预设\s*(\d+)/);
const index = match ? parseInt(match[1]) - 1 : -1;
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
      lastActive: Date.now(),
      customPrompt: null
    };
  }

  if (index >= 0 && index < Presets.length) {
    // 清除自定义预设
    delete chatSessions[sessionKey].customPrompt;
    chatSessions[sessionKey].presetIndex = index;
    e.reply(`已切换至预设${index + 1}`);
  } else {
    e.reply(`无效编号，当前可用预设1~${Presets.length}`);
  }
  return true;
}

  // #ds群聊分离
async toggleGroupSeparation(e) {
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
}
