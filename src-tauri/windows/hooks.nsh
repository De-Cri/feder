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
