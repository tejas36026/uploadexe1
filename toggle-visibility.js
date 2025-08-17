const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// This is a separate executable to toggle visibility when in invisible mode
let toggleWindow;

function createToggleWindow() {
    toggleWindow = new BrowserWindow({
        width: 300,
        height: 150,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    toggleWindow.loadFile('toggle.html');
}

app.whenReady().then(() => {
    createToggleWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});

// IPC handler to communicate with main application
ipcMain.handle('toggle-main-visibility', () => {
    // This would communicate with the main application
    // You can implement inter-process communication here
    console.log('Toggling main application visibility');
    return { success: true };
});