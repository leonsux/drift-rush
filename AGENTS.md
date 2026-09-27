# Drift Rush

本项目是电脑浏览器中的 3D 街机计时竞速游戏。首版仅有一辆车、一张海岸赛道，核心是漂移、小喷、氮气及声音反馈。

## 目录与边界

- `src/main.ts`：游戏状态、输入、界面与固定步长循环。
- `src/physics.ts`：独立的车辆运动、漂移与喷气规则，可脱离浏览器测试。
- `src/track.ts`：闭合赛道采样、投影与检查点规则。
- `src/world.ts`：Three.js 场景、车辆、镜头与视觉效果。
- `src/audio.ts`：Web Audio 合成音效；只在用户操作后启动。
- `src/style.css`：游戏 HUD、起始面板与响应式布局。
- `tests/`：车辆及比赛规则回归测试。
- `.github/workflows/pages.yml`：GitHub Pages 生产构建与部署工作流。
- `.tmp/`：本项目临时验证产物，不参与交付。

使用 Three.js、TypeScript、Vite，不引入服务器或重型物理引擎。驾驶规则采用固定步长，渲染独立运行。可见文案通过统一排版函数处理。游戏资源使用程序化几何与合成音效，无在线资源依赖。

## 工作与验证

先读本文件和 `ROADMAP.md`；使用方式见 `README.md`。改动驾驶逻辑必须执行 `npm test`，交付前执行 `npm run build`，并检查实际浏览器画面与关键输入。影响 GitHub Pages 部署时，还要执行 `npm run build:pages` 并检查生产静态资源路径。不得以构建成功替代手感或声音试听。未实际试听的音效必须明确说明。

本地试玩是默认交付方式；用户明确授权时，可以建立 GitHub 远端并发布。发布前确认远端仓库与公开／私有状态。方向键与 WASD 驾驶，Shift 漂移，Space 小喷，E 或 Ctrl 氮气，R 重开，Esc 暂停。WASD 组合优先推荐 E，避免浏览器关闭标签页快捷键。
