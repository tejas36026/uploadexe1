; NSIS Script to Download and Install from GitHub
; Replace the variables below with your specific information

!define APP_NAME "Activity Tracker"
!define APP_VERSION "1.0.0"
!define PUBLISHER "Tejas"
!define GITHUB_DOWNLOAD_URL "https://github.com/tejas36026/uploadexe1/releases/download/v.1.0.0/Activity.Tracker.Setup.1.0.0.exe"
!define INSTALLER_NAME "ActivityTrackerInstaller.exe"
!define MAIN_EXE "Activity.Tracker.Setup.1.0.0.exe"

; Include Modern UI
!include "MUI2.nsh"
!include "nsDialogs.nsh"

; General Settings
Name "${APP_NAME} ${APP_VERSION}"
OutFile "${INSTALLER_NAME}"
InstallDir "$PROGRAMFILES\${APP_NAME}"
InstallDirRegKey HKCU "Software\${APP_NAME}" ""
RequestExecutionLevel admin

; Modern UI Configuration
!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; Languages
!insertmacro MUI_LANGUAGE "English"

; Installer Sections
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  SetOverwrite ifnewer
  
  ; Show downloading message
  DetailPrint "Downloading ${MAIN_EXE} from GitHub..."
  DetailPrint "File size: ~73MB - This may take several minutes..."
  
  ; Try download with very long timeout for large files
  NSISdl::download /TIMEOUT=300000 "${GITHUB_DOWNLOAD_URL}" "$INSTDIR\${MAIN_EXE}"
  Pop $R0
  
  ; Check if download was successful
  StrCmp $R0 "success" download_ok
  StrCmp $R0 "cancel" download_cancelled
    MessageBox MB_RETRYCANCEL "Download failed: $R0$\n$\nThis could be due to:$\n- Slow internet connection (file is ~73MB)$\n- Firewall blocking the download$\n- GitHub server issues$\n$\nTip: Try downloading manually first from GitHub$\nClick Retry to try again, or Cancel to abort." IDRETRY retry_download
    Abort
    
  retry_download:
    DetailPrint "Retrying download with extended timeout..."
    DetailPrint "Please be patient - large file download in progress..."
    NSISdl::download /TIMEOUT=600000 "${GITHUB_DOWNLOAD_URL}" "$INSTDIR\${MAIN_EXE}"
    Pop $R0
    StrCmp $R0 "success" download_ok
      MessageBox MB_YESNOCANCEL "Download failed again: $R0$\n$\nWould you like to:$\nYES - Open GitHub page to download manually$\nNO - Try one more time$\nCANCEL - Abort installation" IDYES open_github IDNO final_retry
      Abort
      
  final_retry:
    DetailPrint "Final attempt with maximum timeout..."
    NSISdl::download /TIMEOUT=900000 "${GITHUB_DOWNLOAD_URL}" "$INSTDIR\${MAIN_EXE}"
    Pop $R0
    StrCmp $R0 "success" download_ok
      MessageBox MB_OK "All download attempts failed. Please download the file manually from GitHub and run it directly."
      Abort
      
  open_github:
    ExecShell "open" "https://github.com/tejas36026/uploadexe1/releases/tag/v.1.0.0"
    Abort
  
  download_cancelled:
    MessageBox MB_OK "Download was cancelled by user."
    Abort
  
  download_ok:
    DetailPrint "Download completed successfully"
    
    ; Verify the file was downloaded
    IfFileExists "$INSTDIR\${MAIN_EXE}" file_exists
      MessageBox MB_OK "Error: Downloaded file not found"
      Abort
    
    file_exists:
      ; Create uninstaller
      WriteUninstaller "$INSTDIR\Uninstall.exe"
      
      ; Registry entries for Add/Remove Programs
      WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayName" "${APP_NAME}"
      WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
      WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "Publisher" "${PUBLISHER}"
      WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion" "${APP_VERSION}"
      WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoModify" 1
      WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoRepair" 1
      
      ; Store installation path
      WriteRegStr HKCU "Software\${APP_NAME}" "" $INSTDIR
      
      ; Create desktop shortcut (optional)
      CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${MAIN_EXE}"
      
      ; Create start menu shortcut (optional)
      CreateDirectory "$SMPROGRAMS\${APP_NAME}"
      CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${MAIN_EXE}"
      CreateShortCut "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
      
      DetailPrint "Installation completed successfully"
SectionEnd

; Uninstaller Section
Section "Uninstall"
  ; Remove files
  Delete "$INSTDIR\${MAIN_EXE}"
  Delete "$INSTDIR\Uninstall.exe"
  
  ; Remove shortcuts
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  
  ; Remove registry entries
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
  DeleteRegKey HKCU "Software\${APP_NAME}"
  
  ; Remove installation directory if empty
  RMDir "$INSTDIR"
  
  MessageBox MB_OK "Uninstallation completed successfully"
SectionEnd

; Function to check internet connection
Function .onInit
  ; Skip internet connection check - proceed directly
  ; The download section will handle connection errors
FunctionEnd