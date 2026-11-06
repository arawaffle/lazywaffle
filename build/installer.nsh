; LazyWaffle installer: on uninstall, also remove the "run at login" registry entry
; (kept while an update is being installed over the old version)
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "local.lazywaffle"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "local.lazywaffle"
  ${endIf}
!macroend
