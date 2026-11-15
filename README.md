# dsh-tavern-fate-dice（命运之骰插件）

面向 DSH Tavern（插件 API v8+，含 `decisionJudge` 能力）的原创动态检定与真随机掷骰插件：

- **AI 毫秒快判 + 本地真骰**：复用宿主 `decisionJudge` 接口（叙事阻尼器决策模型，无需开启叙事阻尼器拦截开关）在发送前评估是否需要检定、难度档位（5 档）、情景修正与暗骰倾向；本地使用 `node:crypto` `randomInt` 投掷真骰，零额外主模型回合。
- **R18 送审语义分级脱敏**：默认开启 `desensitize: true`，当成人向文本触发远端决策模型安全过滤时自动降级为脱敏骨架与纯结构节拍摘要重试。
- **多规则与变量修正**：支持 `2d6`（叙事渐进）、`1d20`（经典阶梯）、`1d100`（百分阈值），支持从 MVU / 角色变量中提取整数加值（如 `敏捷, 感知`），并支持自由骰子表达式（如 `3d6+2`）。
- **移动端优先与非阻塞动效**：发送栏顶部零占位实时掷骰揭示条（与主模型生成首字并行）、一键「🎲 骰盘」底栏抽屉（发前预览微调锁定 / 自由投掷）、每轮折叠检定徽章（暗骰支持点击揭晓）与酒馆状态页统计。

## 安装

### 方式一：一键导入安装包（推荐）

在 GitHub 仓库下载源码包或 Release ZIP，并在 DSH Tavern 的「设置 → 酒馆插件 → 导入插件」中选择导入即可。

### 方式二：手动克隆到用户插件目录

```sh
git clone https://github.com/bigmalove/dsh-tavern-fate-dice.git <dataRoot>/plugins/dsh-tavern-fate-dice
```

重启或重载插件即可生效。

## 开发与测试

```sh
# 校验并生成浏览器端 client.js
node build.mjs
node build.mjs --check

# 运行全套单元测试与打包检查
npm test
```
