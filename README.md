# deepseekAI for Yunzai

### 介绍
调用deepseek api进行AI对话  
原作者[**@枫林**](https://gitee.com/fenglinit)  ，本人获得允许的情况下进行二改

### 安装方式

下载deepseekAI.js文件放入example  
打开文件根据注释进行修改与配置。  
有问题请根据注释解决。

### 功能/指令

| 指令 | 用途 |
|:-------:|:-------:|
| #ds帮助 | 显示帮助 | 
| 消息中包含预设的关键词 | 触发对话 | 
| #ds清空对话 | 清除本次对话记录 |
| #ds设置预设 [内容] | 临时修改自己想要的AI人格 |
| #ds清空预设 | 清除临时修改的预设<br>并自动使用系统原预设 |
| #ds查看预设 | 查看当前的预设是什么 |
| #ds选择预设 | 选择不同的系统预设 |
| #ds存储对话 [名称] | 保存本次对话到系统中 |
| #ds查询对话 | 查看保存的历史对话 |
| #ds选择对话 [名称] | 选择某个历史对话 |
| #ds删除对话 [名称] | 删除某个历史对话 |

ps.预设就是AI的人格  
未保存的对话会在30分钟后自动结束并清空  
当然你可以在代码中手动修改这个时长  
！对话历史的优先级高于预设，所以改完预设记得先清空一下对话历史 ！

### 密钥申请

DeepSeek api申请渠道 : [**点击这里**](https://platform.deepseek.com/)

### 其它问题

有问题/bug反馈/意见请联系QQ: **2981701287**
