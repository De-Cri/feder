; Updates (/UPDATE, started by the app's updater): if a previous attempt left
; cerchio.exe running in the background with no window, Tauri's installer can't
; replace it and quits. Here, before Tauri's "is the app running?" check, the
; user's leftover copies are closed. Only for updates: a manual install still asks.
; (Seen 0.5.0 -> 0.6.x. The real cause there was Windows 11 Smart App Control
; blocking the unsigned installer: the updater had already closed the window, so
; the app stayed in the background. Only signing the installers fixes that.)
!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode = 1
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "${MAINBINARYNAME}.exe"'
    Pop $R0
    Sleep 1000
  ${EndIf}
!macroend

; Paper is now called Feder: the new installer goes into a new folder
; (the app name decides the folder and the "Installed apps" entry).
; After installing, it silently uninstalls the old "Paper", if present.
; Data (login, preferences) stays: it depends on the identifier, which doesn't change,
; and the silent uninstall doesn't delete the app's data.
!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Paper" "UninstallString"
  StrCmp $R0 "" feder_old_done
  StrCpy $R1 $R0 1
  StrCmp $R1 '"' +2
    StrCpy $R0 '"$R0"'
  ExecWait '$R0 /S'
  feder_old_done:
!macroend
