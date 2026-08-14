# 从官方原版 DSH 迁移数据到 DSH-Desktop

> 原则：**只复制、不移动、不删除**——原版（官方 CLI / Web 版）的数据原封不动，
> 随时可以继续使用；桌面版拿到的是独立副本。

## 目录对照

| 内容 | 官方原版位置 | 桌面版位置 |
|---|---|---|
| 对话数据（会话记录） | `~/.dsh/sessions/`（Windows：`%USERPROFILE%\.dsh\sessions\`） | `%APPDATA%\DSH-Desktop\home\sessions\` |
| 模型/界面设置 | `~/.dsh/settings.yaml` | `%APPDATA%\DSH-Desktop\home\settings.yaml` |
| API 凭据（可选，敏感） | `~/.dsh/.credentials.yaml` | `%APPDATA%\DSH-Desktop\home\.credentials.yaml` |
| 匿名标识（可选） | `~/.dsh/.anonymous-user-id` | `%APPDATA%\DSH-Desktop\home\.anonymous-user-id` |
| UI 状态（可选） | `~/.dsh/storages/` | `%APPDATA%\DSH-Desktop\home\storages\` |

> 注：`~` 在 Windows 即 `%USERPROFILE%`；官方 home 也可被环境变量 `DSH_HOME` 覆盖，
> 若你设置了 `DSH_HOME`，用它的值替换上述 `~/.dsh`。

**不要复制 `profiles/`**：原版 home 里的 `profiles/node_modules` 是一批指向**原版安装目录**
的 junction/软链，复制到桌面版后是失效的死链。桌面版首次启动时会自动为自己的安装位置
重建整套链接；如果你在原版里改过 `profiles/<name>/cordis.patch.yml`，把该文件内容
手动合并到桌面版对应位置即可。

## Windows 迁移步骤

1. **退出桌面版**（右键标题栏 → 关闭），确保它没在写数据；
2. 打开 PowerShell，逐条执行（全部是复制，不碰原版）：

```powershell
# PowerShell 原生语法（直接整段粘贴执行）
$src = "$env:USERPROFILE\.dsh"                  # 官方原版数据目录（若设过 DSH_HOME 环境变量则改成它的值）
$dst = "$env:APPDATA\DSH-Desktop\home"          # 桌面版数据目录
New-Item -ItemType Directory -Force -Path $dst | Out-Null

# 1) 对话数据（核心）
New-Item -ItemType Directory -Force -Path "$dst\sessions" | Out-Null
Copy-Item "$src\sessions\*" "$dst\sessions" -Recurse -Force

# 2) 模型与界面设置
Copy-Item "$src\settings.yaml" "$dst\settings.yaml" -Force

# 3) 可选：API 凭据（文件含密钥，复制后桌面版即可直接用同一批 Key；
#    不想复制就跳过，在桌面版设置里重新配置模型即可）
Copy-Item "$src\.credentials.yaml" "$dst\.credentials.yaml" -Force

# 4) 可选：匿名标识与 UI 状态
Copy-Item "$src\.anonymous-user-id" "$dst\.anonymous-user-id" -Force
New-Item -ItemType Directory -Force -Path "$dst\storages" | Out-Null
Copy-Item "$src\storages\*" "$dst\storages" -Recurse -Force
```

3. 启动桌面版。**历史会话**应出现在会话列表中；
   注意会话按"项目目录"分组（如 `--D-Project-dsh-test--`），
   桌面版里把工作区切到相同目录即可看到对应会话。

## macOS / Linux 迁移步骤

```bash
# 桌面版数据目录：macOS ~/Library/Application Support/DSH-Desktop/home
#                Linux ~/.config/DSH-Desktop/home
DST="$HOME/Library/Application Support/DSH-Desktop/home"   # macOS
# DST="$HOME/.config/DSH-Desktop/home"                     # Linux

cp -R "$HOME/.dsh/sessions"       "$DST/"
cp "$HOME/.dsh/settings.yaml"     "$DST/"
cp "$HOME/.dsh/.credentials.yaml" "$DST/"        # 可选，含密钥
cp "$HOME/.dsh/.anonymous-user-id" "$DST/"       # 可选
cp -R "$HOME/.dsh/storages"       "$DST/"        # 可选
```

## 反向迁移 / 回退

桌面版数据也可以随时拷回原版（同样只复制）：

```powershell
$src = "$env:APPDATA\DSH-Desktop\home"
$dst = "$env:USERPROFILE\.dsh"
New-Item -ItemType Directory -Force -Path "$dst\sessions" | Out-Null
Copy-Item "$src\sessions\*" "$dst\sessions" -Recurse -Force
```

## 常见问题

- **迁移后看不到历史会话**：确认会话目录在 `home\sessions\` 下、且桌面版窗口的
  工作区（项目目录）与原版会话所属目录一致；
- **模型报错**：说明凭据没复制或模型配置不兼容，在桌面版的网页设置里重新选择/配置模型；
- **原版还能用吗**：能。以上所有操作都是复制，原版 `~/.dsh` 不受任何影响。
