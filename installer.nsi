; ===================================================================
; THIS IS THE CODE THAT CREATES THE SMALL INSTALLER
; ===================================================================

; --- Step 1: Define Your App's Information ---
!define APP_NAME "Activity Tracker"
!define COMPANY_NAME "YourCompany"
!define VERSION "1.0.0"
!define MAIN_EXE_NAME "Activity Tracker.exe" ; This must match the exe name inside your zip

; --- Step 2: Paste Your GitHub Download Link Here ---
!define PAYLOAD_URL "https://github.com/tejas36026/uploadexe/releases/download/v.1.0.0/app-payload.zip"

; --- Step 3: Installer Configuration (You can leave this as is) ---
!define PAYLOAD_FILENAME "app-payload.zip"

Name "${APP_NAME}"
OutFile "dist\${APP_NAME}-Installer-Web.exe" ; The final small exe will be created here
InstallDir "$LOCALAPPDATA\${COMPANY_NAME}\${APP_NAME}"
RequestExecutionLevel user
BrandingText " "

Page directory
Page instfiles
UninstPage uninstConfirm

; --- Step 4: The Logic That Downloads and Installs (The "Magic") ---
Section "Install"
    SetOutPath $INSTDIR

    DetailPrint "Downloading ${APP_NAME}..."
    ; This line downloads your big zip file from the internet
    InetC::get "${PAYLOAD_URL}" "$INSTDIR\${PAYLOAD_FILENAME}" /end
    Pop $0
    StrCmp $0 "OK" download_ok
        MessageBox MB_OK|MB_ICONSTOP "Download failed: $0. Please check your internet connection."
        Abort
download_ok:

    DetailPrint "Unpacking files..."
    ; This line unzips the big application
    nsis7z::Extract "$INSTDIR\${PAYLOAD_FILENAME}"
    Delete "$INSTDIR\${PAYLOAD_FILENAME}" ; Deletes the zip after unpacking

    DetailPrint "Creating shortcuts..."
    CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${MAIN_EXE_NAME}"
    CreateDirectory "$SMPROGRAMS\${APP_NAME}"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${MAIN_EXE_NAME}"
    WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; --- Uninstaller Logic ---
Section "Uninstall"
    Delete "$DESKTOP\${APP_NAME}.lnk"
    RMDir /r "$SMPROGRAMS\${APP_NAME}"
    RMDir /r "$INSTDIR"
SectionEnd