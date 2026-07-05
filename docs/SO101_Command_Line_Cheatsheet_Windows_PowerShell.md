# SO101 Terminal 命令行速查表(windows powershell)

## 1. 先记住这 5 件事

| 你看到/按下 | 意思 |
| --- | --- |
| Terminal | 用文字给电脑下指令的窗口 |
| `Enter` | 运行这一行 |
| `Ctrl+C` | 停止正在跑的程序 |
| `↑` / `↓` | 找回刚才用过的命令 |
| `cls` or `Ctrl+L` | 清空屏幕，不会删除文件 |

命令长这样：`工具名 --选项=值`。例：`lerobot-info` 检查环境，`--robot.port=COM3` 表示使用 `COM3` 这个 USB 接口。值里有空格时加引号：`"pick up the red block"`。

## 2. 常用命令

| 命令 | 它做什么 | 小例子 |
| --- | --- | --- |
| `Get-ChildItem` | 看当前文件夹里有什么 | `Get-ChildItem` |
| `New-Item` | 新建文件夹 | `New-Item -ItemType Directory practice` |
| `Set-Location` | 进入某个文件夹，或回到上一级 | `Set-Location practice`、`Set-Location ..` |
| `Get-Content` | 读出文件里的文字 | `Get-Content note.txt` |
| `Write-Output` | 把文字显示出来，也可以写进文件 | `Write-Output "hello"`、`Write-Output "hello" > note.txt` |
| `Remove-Item` | 删除文件 | `Remove-Item note.txt` |

提醒：`Remove-Item` 删除后不容易找回。练习时只删自己刚创建的文件，不要使用 `Remove-Item -Recurse -Force`。

## 3. 小挑战：整理一个练习文件夹

目标：用这 6 个命令创建一个文件夹，写一条任务说明，读出来，再删除一个临时文件。

```powershell
New-Item -ItemType Directory robot-practice
Set-Location robot-practice
Write-Output "task: pick up the red block" > task.txt
Get-Content task.txt
New-Item -ItemType Directory logs
Write-Output "this file can be deleted" > delete-me.txt
Get-ChildItem
Remove-Item delete-me.txt
Get-ChildItem
Set-Location ..
```

完成标志：最后一次 `Get-ChildItem` 里还能看到 `logs` 和 `task.txt`，但看不到 `delete-me.txt`。
