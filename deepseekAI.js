/*
 * @Author: 枫林 670979892@qq.com
 * @Date: 2025-02-01 10:44:28
 * @LastEditors: 枫林 670979892@qq.com
 * @LastEditTime: 2025-02-04 16:43:25
 * @FilePath: \undefinedd:\user\Desktop\deepseek.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */



//原作者为枫林，编写了基础代码部分：api调用，敏感词与预设设置等
//陌 二改，添加了帮助、实时更改预设、对话历史记忆与删除，修改了ai对话的触发便捷性等

//有bug或者改进建议可以联系陌，QQ2981701287，聊天群696334113

//使用前请完成下面的基础配置、触发对话的关键词、最大输入长度，不建议修改历史记录保留长度与保留时间
//未安装依赖的请安装，参考指令 pnpm install openai -w




import OpenAI from "openai";

// DeepSeek API 配置
const Url = "https://api.deepseek.com"; // DeepSeek API 地址
const Authentication = ""; // 这里输入你的密钥
const Model = "deepseek-chat"; // 模型，有deepseek-chat和deepseek-reasoner，前者偏向日常聊天，后者偏向逻辑推理
let System_Prompt = "你是一个幽默风趣的聊天伙伴，你的名字叫，喜欢用轻松的语气和朋友聊天。你会用自然的方式表达情感，偶尔会开玩笑，你的目标是让对话变得有趣和愉快。"; // 系统预设的对话内容，可以为空。如果报错请删除引号内的内容，并使用 #ds设置预设 进行设置
const Temperature = 1.3; // 温度参数，控制生成文本的随机性
const List = []; // 敏感词列表，可以为空

// 存储对话历史记录
let history = [];
let lastActiveTime = Date.now(); // 记录最后一次对话时间
let timeoutTimer = null; // 定时器变量

// 触发关键词
const TRIGGER_WORD = ""; // 触发对话的关键词

// 最大输入长度
const MAX_INPUT_LENGTH = 200; // 允许单条消息最多 200 个字符

export class deepseekAI extends plugin {
  constructor() {
    super({
      name: 'deepseekAI',
      event: 'message',
      priority: 200,
      rule: [
        {
          // 清空历史记录的触发条件
          reg: '^#ds清空对话$',
          fnc: 'clearHistory',
        },
        {
          // 设置系统预设
          reg: '^#ds设置预设([\\s\\S]*)$',
          fnc: 'setSystemPrompt',
        },
        {
          // 清空系统预设
          reg: '^#ds清空预设$',
          fnc: 'clearSystemPrompt',
        },
        {
          // 查看当前预设
          reg: '^#ds查看预设$',
          fnc: 'showSystemPrompt',
        },
        {
          // 显示帮助信息
          reg: '^#ds帮助$',
          fnc: 'showHelp',
        },
        {
          // 当消息中包含触发关键词时触发（排除以 #ds 开头的指令）
          reg: `^(?!.*#ds).*${TRIGGER_WORD}.*$`,
          fnc: 'chat',
        }
      ]
    });

    // 初始化定时器
    this.initTimeoutTimer();
  }

  /**
   * 初始化超时定时器
   */
  initTimeoutTimer() {
    if (timeoutTimer) {
      clearInterval(timeoutTimer); // 清除之前的定时器
    }
    timeoutTimer = setInterval(() => {
      const now = Date.now();
      if (now - lastActiveTime > 30 * 60 * 1000) { // 30 分钟
        if (history.length > 0) { // 只有在历史记录不为空时才清空
          history = []; // 清空历史记录
          logger.info('[deepseekAI] 对话超时，历史记录已清空');
        }
      }
    }, 10 * 60 * 1000); // 每 10 分钟检查一次
  }

  /**
   * 清空历史记录
   * @param {Object} e 事件对象
   */
  async clearHistory(e) {
    history = []; // 清空历史记录
    e.reply('对话历史记录已清空');
    return true;
  }

  /**
   * 设置系统预设
   * @param {Object} e 事件对象
   */
  async setSystemPrompt(e) {
    const prompt = e.msg.replace('#ds设置预设', '').trim();
    System_Prompt = prompt;
    e.reply(`系统预设已更新为：${System_Prompt}`);
    return true;
  }

  /**
   * 清空系统预设
   * @param {Object} e 事件对象
   */
  async clearSystemPrompt(e) {
    System_Prompt = ""; // 清空系统预设
    e.reply('系统预设已清空');
    return true;
  }

  /**
   * 查看当前预设
   * @param {Object} e 事件对象
   */
  async showSystemPrompt(e) {
    if (System_Prompt) {
      e.reply(`当前系统预设为：${System_Prompt}`);
    } else {
      e.reply('当前未设置系统预设');
    }
    return true;
  }

  /**
   * 显示帮助信息
   * @param {Object} e 事件对象
   */
  async showHelp(e) {
    const helpMessage = `
【DeepSeekAI 插件指令帮助】
1. 触发对话：消息中包含「${TRIGGER_WORD}」即可触发对话。
2. 清空对话：#ds清空对话
3. 设置系统预设：#ds设置预设 [预设内容]
4. 清空系统预设：#ds清空预设
5. 查看当前预设：#ds查看预设
6. 显示帮助：#ds帮助

【注意事项】
- 每次对话最多保留 50 条历史记录。
- 如果 30 分钟内无对话，历史记录将自动清空。
- 输入文本长度不能超过 ${MAX_INPUT_LENGTH} 个字符。
    `;
    e.reply(helpMessage);
    return true;
  }

  /**
   * 处理对话
   * @param {Object} e 事件对象
   */
  async chat(e) {
    let msg = e.msg.trim(); // 获取用户输入并去除首尾空格

    // 更新最后一次对话时间
    lastActiveTime = Date.now();

    // 检查输入内容
    if (!msg) {
      e.reply('请输入内容');
      return false;
    }
    if (msg.length > MAX_INPUT_LENGTH) { // 检查输入长度
      e.reply(`输入文本长度过长，最多允许 ${MAX_INPUT_LENGTH} 个字符`);
      return true;
    }
    if (List.some(item => msg.includes(item))) {
      logger.info(`[deepseekAI] 检测到敏感词，已过滤`);
      e.reply("输入包含敏感词，已拦截");
      return true;
    }

    // 将用户输入添加到历史记录
    history.push({ role: "user", content: msg });

    // 限制历史记录长度（最多保留 50 条），不建议手动修改，因为可能会导致超出deepseek的64k限制，若要修改请将下面两个数字全部改掉
    if (history.length > 50) {
      history = history.slice(-50);
    }

    // 调用 DeepSeek API
    const openai = new OpenAI({
      baseURL: Url,
      apiKey: Authentication,
    });

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: System_Prompt }, // 系统预设
          ...history, // 将历史记录作为上下文
        ],
        temperature: Temperature,
        stream: false,
        model: Model,
      });

      const content = completion.choices[0].message.content;

      // 检查输出是否包含敏感词
      if (List.some(item => content.includes(item))) {
        logger.info(`[deepseekAI] 检测到输出包含敏感词，已过滤：${content}`);
        e.reply("输出包含敏感词，已拦截");
        return true;
      }

      // 将 AI 回复添加到历史记录
      history.push({ role: "assistant", content: content });

      // 回复用户
      logger.info(content);
      e.reply(content);
      return true;
    } catch (error) {
      logger.error(`[deepseekAI] API 调用失败：${error}`);
      e.reply("对话失败，请稍后重试");
      return false;
    }
  }
}