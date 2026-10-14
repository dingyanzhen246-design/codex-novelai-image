@echo off
setlocal

set "PLUGIN_DIR=%~dp0"
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"

rem Launch Node as a detached process so closing this launcher cannot kill the settings server.
powershell.exe -NoProfile -WindowStyle Hidden -Command "$plugin = [IO.Path]::GetFullPath('%PLUGIN_DIR%'); Start-Process -FilePath '%NODE_EXE%' -ArgumentList @((Join-Path $plugin 'standalone_settings.mjs')) -WorkingDirectory $plugin -WindowStyle Hidden"

rem Wait until the server is accepting requests before opening the browser.
for /l %%I in (1,1,30) do (
  powershell.exe -NoProfile -WindowStyle Hidden -Command "$r = try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:47831/health' -TimeoutSec 1 } catch { $null }; if ($r -and $r.StatusCode -eq 200) { exit 0 } else { exit 1 }"
  if not errorlevel 1 goto :open
  >nul ping 127.0.0.1 -n 2
)

echo NovelAI 设置服务启动失败，请检查 Node.js 是否已安装。
exit /b 1

:open
start "" "http://127.0.0.1:47831/"
endlocal

