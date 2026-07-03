!macro customInstall
  CreateShortCut "$DESKTOP\选课规划系统(服务器模式).lnk" "$INSTDIR\resources\backend\dist\app\server.exe" "" "$INSTDIR\resources\backend\backend.ico" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\选课规划系统(服务器模式).lnk" "$INSTDIR\resources\backend\dist\app\server.exe" "" "$INSTDIR\resources\backend\backend.ico" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\选课规划系统(服务器模式).lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\选课规划系统(服务器模式).lnk"
!macroend
