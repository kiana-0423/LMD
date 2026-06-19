# LMD 润滑材料数据库

## 项目简介

LMD 是一套面向润滑材料研发的本地桌面数据库与智能设计软件。系统围绕“分子/物质、描述符、基础油/添加剂、配方、实验条件、性能结果、分析与预测”这条数据链组织信息，目标是在本地环境中完成实验数据管理、分子结构保存、描述符计算、配方记录和后续机器学习数据准备。

当前项目处于 MVP 阶段，重点是提供可运行的 Tauri 桌面应用骨架、SQLite 本地存储、Python 科学计算 sidecar、分子绘画与导入流程、描述符中心、基础数据表、数据挖掘入口和主要业务页面。

## 技术栈

前端使用 React、TypeScript、Ant Design 和 Vite 构建。界面包含正式导航、数据表、录入表单、分子详情抽屉、描述符状态视图和分析设计工作区。

桌面壳使用 Tauri 2.0 和 Rust。Rust 负责本地 SQLite 初始化、文件路径管理、Tauri command 暴露、数据库读写以及调用 Python sidecar。

科学计算通过 Python sidecar 完成。sidecar 以 CLI JSON 形式运行，提供 SMILES 标准化、RDKit 描述符、Mordred 描述符、2D 可视化、3D 结构生成、Excel 导入预处理和预测占位能力。

本地存储使用 SQLite。用户数据保存在工作区目录中，数据库文件为 `lmd.sqlite`，结构文件、曲线、报告、模型和导出文件放在工作区子目录中。

## 环境要求

需要 Node.js 和 npm 用于前端依赖与 Vite 开发服务器。项目当前依赖包含 Ketcher，建议使用满足依赖声明的较新 Node.js 版本。

需要 Rust 工具链和 Cargo，用于编译 Tauri 后端和桌面应用。macOS 可通过 Homebrew 或 rustup 安装。

需要 Python 3.10 或更高版本。Python sidecar 依赖 RDKit、Mordred、numpy、pandas、scikit-learn、scipy 和 matplotlib。RDKit 在部分平台上通过 conda-forge 安装更稳定。

## 快速开始

克隆仓库后，先在项目根目录安装前端依赖：运行 `npm install`。

进入 `python-sidecar` 目录后创建并激活虚拟环境，然后运行 `pip install -e .` 安装 sidecar。若 RDKit 的 pip 安装在本机失败，可以先通过 conda-forge 安装 RDKit，再执行 editable install。

确认 Rust 工具链可用后，在项目根目录运行 `npm run tauri dev` 启动桌面开发模式。仅调试前端时可以运行 `npm run dev`，但浏览器模式会使用 mock fallback，无法完整代表 Tauri 桌面端的真实 SQLite 行为。

生产构建使用 `npm run tauri build`。如果要打包 Python sidecar，需要先完成 PyInstaller 或等价打包流程，并在 Tauri 外部二进制配置中接入。

## 项目结构

`src/` 是前端源码目录，包含布局、路由、页面组件、业务组件、API 封装、mock 数据和全局样式。

`src-tauri/` 是 Tauri/Rust 后端目录，包含 Tauri 配置、SQLite schema、数据库迁移、应用路径、命令模块和桌面图标。

`python-sidecar/` 是 Python 科学计算 sidecar，包含 CLI 入口、服务模块、JSON 工具、示例输入和 Python 依赖配置。

`asset/logo/` 保存原始 logo 资产，`public/` 保存前端静态资源。

`dist/`、`node_modules/`、`src-tauri/target/`、Python 虚拟环境和缓存目录是生成物，不应作为源码维护。

## 功能模块

仪表盘 `/dashboard` 汇总 SQLite 工作区中的分子、描述符、基础油、添加剂、配方、实验、性能结果、附件、数据源和任务状态。

分子库 `/molecules` 展示本地分子记录，支持详情抽屉查看概览、2D 结构、3D 结构、描述符摘要、相关配方和备注。

分子录入 `/molecule-entry` 通过 SMILES 保存分子并生成 RDKit 与 Mordred 描述符记录。

分子绘画 `/molecule-sketcher` 集成 Ketcher，支持从结构生成 SMILES、检查重复、计算预览描述符并导入为新分子。

描述符中心 `/descriptors` 管理分子描述符状态，支持导出全部描述符 CSV 和机器学习描述符矩阵。

基础油/添加剂库 `/base-additive` 展示 SQLite 中的基础油和添加剂记录，并支持删除数据库中的真实记录。

配方库 `/formulations` 展示 SQLite 中的配方、组分摘要、实验摘要和性能摘要。

配方录入 `/formulation-entry` 提供配方组成、制备条件和稳定性观察的录入界面。

实验与性能 `/experiments` 管理实验条件和性能结果，用于配方性能追踪。

分子性能预测 `/data-mining/molecule-performance` 使用分子库描述符和物理性能作为输入，训练描述符到目标性能的机器学习模型。

配方预测 `/data-mining/formulation-prediction` 使用配方比例、实验数据和配方中各分子的描述符，建立配方与摩擦性能之间的模型。

分子设计 `/data-mining/molecule-design` 根据已有学习模型和预期性能反推目标描述符空间，生成候选分子。

导入/导出 `/import-export` 用于分子数据导入预览、分子库 CSV 导出和描述符矩阵导出。

## 开发说明

浏览器模式和 Tauri 模式行为不同。浏览器模式没有 Rust 后端和本地 SQLite 访问能力，`invokeOrMock` 会自动调用 mock fallback，适合快速调试 UI。Tauri 模式运行在桌面壳中，`invokeOrMock` 会调用 Rust command，适合验证真实数据库读写和 sidecar 调用。

前端 API 统一封装在 `src/lib/api.ts` 和相关业务 API 文件中。页面不应直接依赖 mock 数据，除非作为浏览器模式 fallback。

Rust command 位于 `src-tauri/src/commands/`。新增数据库读写时应优先复用现有 `default_database_path()`、SQLite schema、DTO 命名规则和错误处理风格。

Python sidecar 通过命令行读取 JSON 输入并输出 JSON 结果。Rust 使用临时输入文件调用 `python -m lmd_sidecar.main`，并解析 stdout 中的最终 JSON。sidecar 不直接写 SQLite，数据库写入始终由 Rust 负责。

结构文件、导出文件和附件应保存在工作区目录下，数据库中只保存相对路径。

## 待办事项

当前仍处于 MVP 阶段，部分命令和页面保留占位能力。后续需要完善基础油、添加剂、配方、实验和附件的完整创建与编辑流程。

描述符 CSV 导出当前前端可基于已加载数据生成，后续需要补齐 Rust 端直接从 SQLite 展开 `descriptors_json` 的导出能力。

Python sidecar 打包尚未完成，尤其是 RDKit 和 Mordred 在 Windows 清洁环境中的分发需要单独验证。

工作区选择 UI、设置页面、批量任务队列、模型训练、预测服务和完整导入导出校验仍需继续实现。

测试覆盖仍需持续扩展，包括前端组件测试、Rust 数据库测试和 Python sidecar 单元测试。
