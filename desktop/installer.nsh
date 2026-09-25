; PacedMind's additions to the Windows installer that scripts/release.mjs makes with electron-builder.

!macro preInit
  ; Install where `npm run desktop` does, so each one updates the other's installation.
  !ifndef BUILD_UNINSTALLER
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\Organizer"
  !endif
!macroend

!macro customInstall
  ; The app writes its own Start Menu and desktop shortcuts, with the icon and ID its notifications need.
  ExecWait '"$INSTDIR\Organizer.exe" --install'
!macroend

!macro customUnInstall
  ; An update runs the old version's uninstaller too: then the shortcuts and Start with Windows stay.
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\Organizer.exe" --uninstall'
  ${endIf}
!macroend
