# Minecraft 3D Skin Layers 0.5.0 开发计划

制定日期：2026-10-14（Asia/Shanghai）。状态：执行中。

## 目标与已确定范围

继续完善现有 `0.5.0` 预发布轮次，验证完成后发布 `0.5.0`。
已公开的 `v0.5.0-pre`、它的源码与制品保持不变，不重新定义该历史版本。

本轮交付三个功能变化：

1. 移除 Alpha 阈值、最大方块数量、每批创建数量三个数值选择，全入口使用现有默认值，保留预检、报错与失败回滚。
2. 对接 Blockbench MCP 插件公开扩展 API，让 MCP 无需操作弹窗即可调用本插件的业务功能。
3. 纳入更新后的 Steve/Alex 模板和纹理，增加皮肤类型选择，更新模型显示名称及默认模板，补齐两份关节模板的右前臂外层。

用户已明确本轮补齐 `Right Arm Layer2`，并更新对应测试基线。
保留每个体素六个面映射同一像素、原始层元数据、恢复、原地再生成、透明清理及副本项目行为。
桌面、Web、移动 PWA 的现有 UI 能力继续支持；MCP 是可选的桌面能力。

## 分支与版本纪律

当前开发基线：`dev` 的 `bc883d669ef331618f1155687432808922dd5a9a`。
本计划分支：`milestone/next-version-plan`，直接从该 `dev` 创建。

- `dev` 集成开发成果；功能、修复、重构、计划和验证都从 `dev` 拉出相应分支。
- `main` 只在定版时集成经过验证的 `dev` 范围，再提交版本字段、CHANGELOG 和发布制品。
- 不在 main 编写业务功能或临时修 Bug，也不在 main 直接提交普通开发文档。
- 依赖分支从已合入前置成果的最新 `dev` 创建。MCP 分支不能从尚未合并的模板或重构分支派生。
- 完成一个可独立验收的阶段后，核对差异、执行相关验证，使用 Conventional Commits 和真实的 `--no-ff` 合并。
- 本轮是同一 `0.5.0` 功能范围，开发修复不累计成 `0.5.3`。普通提交不修改正式版本号。
- 若需要分发开发快照，临时构建注入 `0.5.0-dev.N` 并记录 SHA，不创建永久快照 Tag，不覆盖 `0.5.0-pre` 制品。
- `dev.N` 是开发通道，在 SemVer 中排序低于已有 `pre`。若继续正式交付预发布，可使用后续 `0.5.0-pre.1` 等版本，仍按定版流程在 main 准备，不覆写既有预发布。
- 正式发布由 main 最终版本准备提交产生 `v0.5.0`；Release 从这个 Tag 构建，不再递增版本。
- 现有 `v0.2.1` 冲突按历史审计保留；本轮不使用它计算版本，不批量推送全部 Tag。

## 里程碑与依赖

| 阶段 | 从 dev 创建的分支 | 工作成果 | 开始条件 / 完成验收 |
| --- | --- | --- | --- |
| M0 计划与规则 | `milestone/next-version-plan` | 本计划及 main/dev 职责修正 | 本轮目标、默认值、模板补齐范围和 API 基线已明确 |
| M1 固定生成参数 | `feature/fixed-generation-options` | 删除数值控件，统一选项解析和旧设置迁移 | 全入口固定 `0/10000/200`，限额错误与其他用户选项不退化 |
| M2 皮肤类型与模板 | `feature/skin-type-templates` | 六份模板、四份纹理、向导、两份右前臂外层补齐 | 12 个选择组合正确，新的模板 golden 经独立规划核实 |
| M3 共享命令服务 | `refactor/shared-skin-operations` | UI/MCP 可共用的执行服务、互斥、结果和错误模型 | M1、M2 合回 dev；异步 Undo、项目归属与回滚验证通过 |
| M4 MCP 接入 | `feature/mcp-integration` | 六个工具、注册/注销、参数校验及桌面联调 | 从含 M3 的 dev 创建；工具调用确实完成操作并正确报告结果 |
| M5 全链路验收 | `milestone/0.5.0-validation` | 桌面/Web/PWA 回归、文档、制品验证清单 | M1–M4 合回 dev；全部发布验收完成 |
| R 定版发布 | `main` | `0.5.0` 版本准备提交、`v0.5.0` 与指定 Tag 制品 | 选定 dev 范围完成验证，维护者选择发布 |

M1、M2 可以并行。两者都完成后再提取 M3，避免模板、新建入口与服务重构同时改同一文件。
M4 依赖 M3；M5 汇总回归。每个阶段只创建实际要开展的分支，不预先制造空分叉。
依赖顺序：`M0 → (M1 + M2) → M3 → M4 → M5 → R`。

## M1：固定生成参数

| 工程参数 | 固定值 | 行为 |
| --- | --- | --- |
| Alpha 阈值 | `0` | 普通生成保留 alpha > 0；透明清理只移除 alpha = 0 |
| 最大方块数量 | `10,000` | 超过时中止该次生成，继续报告实际数量与固定上限 |
| 每批创建数量 | `200` | 保留按批次让出 UI 的机制，避免取消或重构时失去响应 |

实施任务：

- 从 `src/ui/settingsDialog.ts` 移除三个 `number` 控件。
- 把统一选项解析移到 UI 之外的模块，例如 `src/domain/options.ts`：
  用户可选项与已解析工程选项区分，固定值来自 `DEFAULT_OPTIONS`。
- 读取旧 localStorage 时忽略旧的三个数值；保存前同样规范化。
  保留原 storage key 和其余用户偏好，不整体重置设置。
- 手动生成、自动生成、新建、再生成、清理与后续 MCP 均通过同一公共命令边界解析固定值。
  底层纯算法为了测试仍可接受数值，不能让插件的公共入口重新开放它们。
- 保留 `VoxelLimitError` 及现有警告，改写中英文提示，不再要求用户“调高上限”。
  建议提示：`已中止：本次需要 %0 个方块，超出固定上限 %1。`
- 新建流程目前超限时已创建模板项目，保持未体素化模板并准确说明结果，不能声称整个工作区完全没变化。
- 保留弹窗确认后的重新扫描：选中范围或纹理仍可能改变，旧预检可能过期。
- 同步移除失效的表单翻译、README 可调参数行，以及 TEST_PLAN 中调整 Alpha 的交互验收。

修改范围：`src/domain/constants.ts`、`src/domain/types.ts`、新增选项解析模块、
`src/ui/settingsDialog.ts`、`src/plugin.ts`、`src/newSkin/newSkinFormat.ts`、
`src/i18n/strings.ts`、相关选项测试、README、SPEC、TEST_PLAN。

阶段验收：

- 旧值 `128 / 1000000 / 5000`、字符串和非法值升级后均变为 `0 / 10000 / 200`，其他偏好保留。
- 损坏存储使用默认值；保存不重新写入非默认值。
- 三个控件消失，其余复选框、项目副本与再生成包含透明像素仍可用。
- 公开命令允许计划数 `10,000`，拒绝 `10,001`；错误不产生半成品或成功 Undo。
- 透明度为 1 或 128 的像素不会受旧 Alpha 阈值影响；只有 0 被普通生成忽略或透明清理删除。

## M2：Steve/Alex 与模板更新

模板输入来自工作区 `temp_model/`，实施时将经过核实的资源复制进仓库资产目录，
不让发布包运行时依赖这个外部目录。原文件作为输入保留；补齐版在仓库中维护，
记录补齐前后差异，后续如需导出回工作区单独执行。

| 皮肤类型 | 显示：默认模型（默认选中，ID=root） | 显示：Blockbench 经典（ID=classic） | 显示：关节模型（ID=joint） |
| --- | --- | --- | --- |
| Steve | `steve_skins_model_root.bbmodel` | `steve_skins_model.bbmodel` | `steve_skins_model_root_joint.bbmodel` |
| Alex | `alex_skins_model_root.bbmodel` | `alex_skins_model.bbmodel` | `alex_skins_model_root_joint.bbmodel` |

皮肤类型默认建议 Steve，以延续现有模型行为；纹理尺寸保留 64/128，默认 64。
对应纹理为 `steve-64.png`、`steve-128.png`、`alex-64.png`、`alex-128.png`。
Steve 手臂宽 4、Alex 手臂宽 3，使用作者提供的独立几何与 UV，不运行时缩放互转。
用户自定义项目名称和标识符继续保留；空名称暂沿用 `temp-64/temp-128`，
本轮明确改变的是模型选项显示名称及默认选项。

实施任务：

- `assets/templates/` 按 `steve/`、`alex/` 纳入六份模型，纹理纳入 `assets/textures/`。
- 在两份关节模板中补齐 `Right Arm Layer2`，位置位于正确的右前臂分组，
  使用对应底层 `Right Arm2` 的位置/旋转/枢轴与对应袖层膨胀参数。
  右臂 UV 必须按各自 Steve/Alex 图集核实，不直接复制左臂 UV。
- 保持正确的 4/3 像素臂宽、关节层级、示例动画、镜像规则、可见性和可还原元数据。
- Alex 关节模型当前第一张纹理未被使用，所有面指向第二张纹理：
  入库/嵌入阶段清理未引用纹理并重映射引用，不能默认第一张纹理有效。
- `scripts/embed-templates.mjs` 生成 `[skinType][template]` 模型表及 `[skinType][size]` 纹理表。
  清理外部路径、编辑器选择状态等非资源内容，保留模型作者的几何、UV、分组和动画。
- `src/newSkin/templates.ts` 增加 `SkinType` 与解析；保留内部 ID，默认回退改 root，严格构建函数拒绝非法组合。
- 向导增加 Steve/Alex 字段，模板顺序为 root/classic/joint；新建服务传递 skinType，MCP 后续复用。
- UV 空间保持 64；128 图像提供双倍纹理密度，不把 UV 空间错误同步放大为 128。
- `src/assets/embedded.ts` 由脚本生成，不手改；生成两次结果应一致。

修改范围：模板/纹理资产、嵌入脚本与生成文件、`src/newSkin/`、i18n、
模板单元测试、集成夹具与新 golden、README、SPEC。

阶段验收：

- Steve/Alex × root/classic/joint × 64/128 共 12 个组合全部有效，纹理类型和尺寸匹配。
- 两种 joint 都有右前臂外层；补齐后的 Layer 数、面数与像素规划数量由真实几何重新计算，不能沿用旧 golden 数量。
- 新版模板使用新增夹具；旧的已发布模型夹具保留，继续验证旧文件的兼容还原。
- 单独检查右袖六面 UV、64/128 纹理采样、左右臂不串贴图、弯曲时 pivot 和动画正确。
- 新建后生成、再生成、透明清理、恢复、Undo/Redo、保存重开均保持完整结构。
- 深拷贝互不污染嵌入模板；未知 skinType、template、size 在 MCP/业务边界明确拒绝。

右前臂补齐的实现依据已经用现有模板在内存中交叉验证：复制各自 `Right Arm2`，
新建唯一 UUID，名称设为 `Right Arm Layer2`，inflate 为 `0.25`；保留各自
几何、origin、旋转与有效纹理引用，挂入原右前臂分组。六面 UV 的 V 坐标
在对应底层基础上加 16，与当前右上臂底层/外层对应关系一致；不照搬 Alex
左臂带 X 偏移的枢轴。最终每份 joint 应为 22 个 Cube、11 个 Layer，
并复核分段顶底盖在关节转动时的接缝。

以当前输入资源计算的候选新 golden：

| 修正后的 joint 组合 | 普通生成可见体素 | 新建全像素体素 |
| --- | --- | --- |
| Steve 64 | 720 | 1,920 |
| Steve 128 | 4,622 | 7,680 |
| Alex 64 | 754 | 1,840 |
| Alex 128 | 3,310 | 7,360 |

规划器与独立逐像素计数均得到这些结果，无 warnings；实施后仍须重新计算确认。
当前 64/128 图片图案不同，可见数量不能用乘 4 推算，只有全像素数量可这样校验。
现行 joint 模板测试更新为补齐版断言，Steve 64 原 `680/1792` 变为 `720/1920`；
旧发布夹具及其原断言保留为 legacy 兼容用例，不覆写其历史语义。

## M3：共享命令服务与事务

提取不弹窗、可等待、有结果/错误返回的业务服务，例如 `src/operations/`。
保留现有扫描、纯规划、writer、restorer、regenerator、cleaner，避免复制另一套算法。
UI 负责展示及用户确认；服务负责预检与执行；MCP 负责 schema、可用条件与结果转换。

必须处理的现有问题与接口：

- `runRegenerateGuarded()` 现在 `void runRegenerate()` 后立即释放锁，异步异常也未被捕获。
  抽取时等待完整 Promise，并让 UI、MCP、自动生成、新建共用一个持续到操作结束的写入锁。
- 新建目前使用独立 `creating` 锁，而且继承“仅处理选中层”旧选项。
  新建服务使用明确的新建选项，不因空项目无选中对象而跳过体素化。
- 服务忙碌不能静默成功；使用明确 BUSY 结果，失败不能只弹 toast 后返回 void。
- `target=current/copy` 保持原行为，副本模式预检通过后才创建副本，候选在副本中重新解析。
- MCP 参数使用独立、明确的默认，不读取或覆写用户 UI 的 localStorage 偏好。
- 固定目标项目 UUID，纹理等待、每批恢复和写入前确认项目归属。
  副本/新建先创建并选中计划内目标，再绑定它的 UUID，不能把这次主动切换误判为 PROJECT_CHANGED。
  项目切换、关闭或取消时，终止后续写入并在原项目正确回滚，不能对新活动项目执行 Undo。
- 本插件写入互斥无法保证上游所有 MCP 工具全局互斥；联调要验证其他工具或用户切项目时的行为。
- 统一结构化结果：操作、目标项目 ID、创建/删除/恢复数量、耗时、warnings，以及实际是否保留模板/创建副本。
- 操作错误明确分类：BUSY、NO_PROJECT、INVALID_MODE、VOXEL_LIMIT、NO_TARGETS、PROJECT_CHANGED、CANCELLED、EXECUTION_FAILED。

事务兼容技术验证是 M3 的完成条件：

1. 上游 `runUndoableEdit()` 为同步实现，不能直接包裹异步批处理，不能和本插件现有 Undo 嵌套。
2. 优先保留本插件一个完整异步 Undo 生命周期，由上游工具执行期间的编辑事件监听记录 AI 使用。
   实测验证 init/finish、成功/失败、分批让出 UI 的事件归属，不能仅凭类型推断兼容。
3. 一次编辑只产生一个 Undo 条目，开始/结束都正确传 `groups`，失败取消并恢复。
   同步操作如复用上游 helper，必须先把无事务写入与事务所有权分离。
4. 验证项目变化与取消下原目标完整回滚。若当前 Host 无法保证，要先补齐目标绑定/事务上下文，再继续 MCP 接入。
5. 新建项目与副本项目的创建本身不等同于现有几何 Undo；准确记录失败后的项目状态，
   不声称一次几何撤销自动关闭新项目。不得留下部分创建的体素或误改原项目。

验收包括完整等待、锁释放、重入、异步拒绝、项目变化、纹理失败、超限、
UI 与服务相同输入结果一致，以及原有原子回滚/可逆性测试继续通过。

## M4：MCP 工具

上游兼容基线：Blockbench MCP **v1.10.0**，固定源码
`d0271716c6434add875fd024e9ea6b474bc0ca09`。
当前上游 main 的相关扩展文件与此版本一致；实施时以固定来源复核，
不在计划中假定用户当前安装的 MCP 已经达到这个版本。

接入方式：本插件加载时向 `globalThis.MCP_QUEUE` 推入 `{ plugin: PLUGIN_ID, setup(mcp) }`。
setup 使用 `mcp.registerTool`；schema 使用 MCP 自身的 `mcp.z.object(...).strict()`。
仅引用公开类型，Zod 可作开发依赖，不打包 MCP 服务或 Zod 运行时，不启动第二个服务。
工具名使用现有插件 ID 前缀，注册处显式标明所属插件和读写提示。

| 工具名 | 功能 | 对外参数 |
| --- | --- | --- |
| `minecraft_3d_skin_layers_inspect` | 只读检查项目与可用操作 | 无可调工程参数；返回项目 ID、层/生成组计数、固定限制与可用能力 |
| `minecraft_3d_skin_layers_generate` | 无弹窗生成 | target=current/copy、保留源层、空层替换、仅选中层 |
| `minecraft_3d_skin_layers_restore` | 无弹窗恢复原始层 | target=current/copy |
| `minecraft_3d_skin_layers_regenerate` | 按当前纹理重新生成 | includeTransparent |
| `minecraft_3d_skin_layers_clear_transparent` | 清除本插件生成的透明方块 | 无 Alpha 参数 |
| `minecraft_3d_skin_layers_new_skin` | 新建完整 3D 皮肤 | skinType=steve/alex、template=root/classic/joint、size=64/128、可选名称与标识符 |

三个固定数值不进入任何 schema；传入它们或其他未知字段会拒绝。
MCP 新建默认 Steve/root/64，与 UI 一致。所有实际调用再次检查可用条件，
不能只靠 tools/list 隐藏功能拦截旧客户端请求。新建不要求已有项目，
其他工具按业务要求检查项目、编辑模式及可处理对象。

工具使用 M3 服务，完整 await；不直接暴露当前吞异常的 run*Guarded，
不使用默认 exposeAction 触发弹窗后立刻报告成功。
成功由 `mcp.createJsonResult` 返回实绩；失败带 `isError: true` 及稳定错误码。
只读 inspect 标记 readOnly，写操作如删除/替换如实标记，不宣称所有操作都能安全重试。

生命周期任务：

- 本插件先加载、MCP 先加载两种顺序都注册。
- 管理每次 setup 的 disposer；注册中途失败需清理已经注册的工具。
- 停用/重载本插件清理工具、监听器及队列项，清理操作幂等。
  如有运行中的服务，主动取消并禁止继续写入，确保其回滚和锁释放。
- MCP 停用/重启后重新注册；本插件已卸载时不能“复活”工具。
- MCP 尚未加载时先卸载本插件，也主动移除其待处理 queue entry。
- 已连接客户端收到 tools/list_changed；重复重载没有重名工具。

兼容边界：

- 继续使用现有 `variant: both`；Web/PWA 没有 MCP 时全部 UI 正常工作。
  setup 检查版本与公开 API 能力，缺失或旧版不兼容时跳过注册，UI 不受影响。
- 本轮只接 live Blockbench Desktop 的 HTTP MCP；上游 headless stdio 不加载本插件，不属于本轮支持范围。
- v1.10.0 HTTP 执行器实际传递 signal，客户端取消或连接关闭可以传播中止；
  仍需联调验证停止写入、原项目回滚及锁释放。SDK 取消后可能不再回复，
  不把收到 CANCELLED 错误响应作为取消验收条件。类型也有 reportProgress，
  但目前上游 HTTP 回调为空实现，不能承诺客户端收到实时进度通知。
- 延续本项目 GitHub Release、文件/URL 加载分发。上游扩展文档明确注册 MCP 的插件
  应通过自身仓库或 URL 分发；本轮不规划提交到官方插件商店。

阶段验收：实际安装兼容 MCP 后通过 tools/list / tools/call 调用六个工具；
同参数与 UI 结果一致，写操作没有弹窗依赖；无 MCP 时仍可加载。
覆盖非法参数、无项目、无目标、超限、并发 BUSY、取消、项目变化、重载、
一次 Undo/Redo、失败回滚、真实 AI 使用记录，以及持久化用户偏好不受 MCP 更改。

## M5：全链路验收与发布清单

| 类别 | 必须通过 |
| --- | --- |
| 自动化 | `npm run check`：类型检查、全部单元/集成测试、构建；新模板嵌入可重复生成 |
| 桌面 UI | 三个数值控件移除；其余选项和提示正常；六种模型 × 两种尺寸正确 |
| 模型质量 | Steve/Alex 臂宽、右前臂外层、UV 与枢轴；旧模型兼容；保存/重开和动画不退化 |
| 可逆性 | 生成、恢复、再生成、清理的 Undo/Redo 完整；副本保护原项目；失败无部分体素 |
| MCP | 六个工具实际调用、严格参数、生命周期、并发、取消/项目切换、真实结果与错误 |
| Web/PWA | 无 MCP 仍正常加载、创建和使用；小屏触摸操作与批次让出 UI 保留 |
| 限额 | 固定 10,000 的边界和错误；全部 128 模板实际规划数量不超限，禁止静默提高限制 |
| 文档 | 中英文 README、SPEC、TEST_PLAN、MCP 工具说明与本计划相符；去除调高上限的建议 |
| 发布来源 | main 版本准备范围正确；版本字段与 Tag 一致；制品来自指定 Tag 并记录 SHA-256 |

本轮不预先指定“必须增加多少条测试”，以新增行为、兼容性和实际失败路径覆盖为准。
上一阶段已有 126 个测试通过，仅作现有基线，实施后的测试数量会随必要覆盖变化。
桌面联调涉及创建模型前先采用 Blockbench 使用技能的场景检查和检查点，
使用测试项目验证，不把用户正在编辑的项目当作测试夹具。

完成 M5 后：核对 dev 范围 → 合入 main → 准备 `0.5.0` 版本/变更记录/制品 →
验证最终提交 → 创建 `v0.5.0` → 选择 Release → 从该 Tag 构建或复用经核实制品。
版本准备提交再同步回 dev，使之后开发使用同一基线；不在 main 顺手修业务缺陷。
推送和 Release 按当时已有授权执行，不以本计划自动执行。

## 实施时的检查点

- M1 验收后，所有命令已使用固定默认并保留错误，避免 MCP 分支重新引入数值参数。
- M2 验收后，补齐版模板、图片引用和 golden 一致，资源输入 SHA 和修改记录可追溯。
- M3 验收后，异步 Undo 和项目归属已实证；不把未经验证的事务方案直接接到客户端。
- M4 验收后，记录实际 Blockbench/MCP 版本、工具列表、调用结果和卸载行为。
- M5 验收后，决定是否先交付后续预发布；无论次数多少，正式版本仍按本轮范围定为 0.5.0。

## 参考依据

- 项目当前代码：`src/domain/constants.ts`、`src/ui/settingsDialog.ts`、`src/plugin.ts`、
  `src/newSkin/`、`scripts/embed-templates.mjs` 及对应测试。
- 当前资源输入：工作区 `temp_model/` 六份 bbmodel、四份 PNG；实施前重新读取输入并保存指纹。
- [MCP 扩展接口](https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/d0271716c6434add875fd024e9ea6b474bc0ca09/docs/plugin.md)
- [MCP 公开类型](https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/d0271716c6434add875fd024e9ea6b474bc0ca09/lib/mcp-api.d.ts)
- [MCP 注册实现](https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/d0271716c6434add875fd024e9ea6b474bc0ca09/lib/plugin-api.ts)
- [MCP 同步 Undo 实现](https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/d0271716c6434add875fd024e9ea6b474bc0ca09/lib/undo.ts)
- [MCP 编辑使用记录](https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/d0271716c6434add875fd024e9ea6b474bc0ca09/lib/ai-disclosure.ts)
- [MCP 工具执行上下文](https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/d0271716c6434add875fd024e9ea6b474bc0ca09/lib/factories.ts)
- [HTTP 取消传播](https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/d0271716c6434add875fd024e9ea6b474bc0ca09/server/server.ts)
- [Git 工作流](GIT_WORKFLOW.md) · [历史版本审计](GIT_HISTORY_AUDIT.md)
