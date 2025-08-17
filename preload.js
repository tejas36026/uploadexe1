// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Functions for the controls UI
    startTracking: () => ipcRenderer.send('start-tracking'),
    stopTracking: () => ipcRenderer.send('stop-tracking'),
    setInvisible: (isInvisible) => ipcRenderer.send('set-invisible', isInvisible),
    
    // Function for the dashboard to receive data
    onUpdateDashboard: (callback) => ipcRenderer.on('update-dashboard', callback),
});