; Paper si chiama ora Feder: l'installer nuovo finisce in una cartella nuova
; (il nome dell'app decide la cartella e la voce in "App installate").
; Dopo l'installazione disinstalla in silenzio la vecchia "Paper", se c'è.
; I dati (accesso, preferenze) restano: dipendono dall'identificativo, che non cambia,
; e la disinstallazione silenziosa non cancella i dati dell'app.
!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Paper" "UninstallString"
  StrCmp $R0 "" feder_old_done
  StrCpy $R1 $R0 1
  StrCmp $R1 '"' +2
    StrCpy $R0 '"$R0"'
  ExecWait '$R0 /S'
  feder_old_done:
!macroend
