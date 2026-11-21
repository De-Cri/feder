; Paper is now called Feder: the new installer goes into a new folder
; (the app name decides the folder and the "Installed apps" entry).
; After installing, it silently uninstalls the old "Paper", if present.
; Data (login, preferences) stays: it depends on the identifier, which doesn't change,
; and the silent uninstall doesn't delete the app's data.
; Updates (/UPDATE, started by the app's updater): the app closes its window and
; launches this installer, but on some PCs its exit hangs and cerchio.exe stays
; running in the background (seen updating 0.5.0 → 0.6.0). Then the installer can't
; replace it and quits without installing. Here, before Tauri's "is the app running?"
; check, the user's leftover copies are closed. Only for updates: a manual install
; still asks before closing the app.
!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode = 1
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "${MAINBINARYNAME}.exe"'
    Pop $R0
    Sleep 1000
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Paper" "UninstallString"
  StrCmp $R0 "" feder_old_done
  StrCpy $R1 $R0 1
  StrCmp $R1 '"' +2
    StrCpy $R0 '"$R0"'
  ExecWait '$R0 /S'
  feder_old_done:
!macroend
