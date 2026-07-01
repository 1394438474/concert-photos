@echo off
echo ============================================
echo   演唱会照片分享 - 公网模式启动中...
echo ============================================
echo.
echo [1/2] 启动本地服务器 (端口 3000)...
start "Concert-Server" cmd /c "npm start"

echo [2/2] 启动公网隧道...
echo.
echo 首次访问需要先运行: npm install -g localtunnel
echo 然后每次启动只需运行这个脚本即可
echo.
echo 稍等几秒，隧道建立后会显示公网地址...
echo ============================================

timeout /t 5 /nobreak >nul

npx localtunnel --port 3000 --subdomain concert-photos-xl

pause
