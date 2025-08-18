const { app, BrowserWindow, ipcMain, globalShortcut, screen, clipboard ,Notification} = require('electron');
const path = require('path');
const fs = require('fs');
const activeWin = require('active-win');
const { GlobalKeyboardListener } = require('node-global-key-listener');


let sessionCounter = 1;
const SESSION_COUNTER_FILE = path.join(app.getPath('userData'), 'session_counter.json');

let currentSessionActivities = []; 
let mainWindow;
let controlWindow;
let isTracking = false;
let isInvisible = false;
let trackingData = [];
let sessionID = null; // <<< NEW: To track the current session
let sessionData = [];
let startTime = null;
let keyListener;


const DATA_DIR = path.join(__dirname, 'data');

// Include/Exclude lists
let includeList = [];
let excludeList = [];

try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
} catch (error) {
    console.error('Error creating data directory:', error);
}


const SESSIONS_DIR = path.join(app.getPath('userData'), 'sessions');
try {
    if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
} catch (error) {
    console.error('Error creating sessions directory:', error);
}


ipcMain.handle('trigger-print', async (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            // Tell the dashboard window to start its printing process
            mainWindow.webContents.send('start-printing-view');
            return { success: true };
        } catch (error) {
            console.error("Failed to trigger print:", error);
            return { success: false };
        }
    }
    return { success: false, message: "Dashboard window not found." };
});



const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE));
            includeList = settings.includeList || [];
            excludeList = settings.excludeList || [];
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

function saveSettings() {
  try {
      const settings = { includeList, excludeList };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
      console.error('Error saving settings:', error);
  }
}

function loadSessionCounter() {
    try {
        if (fs.existsSync(SESSION_COUNTER_FILE)) {
            const data = JSON.parse(fs.readFileSync(SESSION_COUNTER_FILE));
            sessionCounter = data.counter || 1;
        }
    } catch (error) {
        console.error('Error loading session counter:', error);
        sessionCounter = 1;
    }
}

ipcMain.handle('print-request', async (event, action) => {
    console.log(`Routing print request from controls dropdown. Action: ${action}`);

    // --- LOGIC FOR 'Print Last Session' ---
    if (action === 'last') {
        try {
            // Find the most recent session file
            const sessionFiles = fs.readdirSync(SESSIONS_DIR).filter(file => file.endsWith('.json'));
            if (sessionFiles.length === 0) {
                console.log('No sessions found to print.');
                new Notification({ title: 'Print Failed', body: 'No saved sessions were found.' }).show();
                return { success: false, message: 'No saved sessions were found.' };
            }

            sessionFiles.sort((a, b) => {
                const timeA = parseInt(a.split('_').pop().replace('.json', ''), 10);
                const timeB = parseInt(b.split('_').pop().replace('.json', ''), 10);
                return timeB - timeA; // Sort descending to get the latest
            });

            const lastSessionId = sessionFiles[0];
            console.log(`Located last session to print: ${lastSessionId}`);

            // Ensure dashboard window is open
            if (!mainWindow || mainWindow.isDestroyed()) {
                createMainWindow();
                await new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
            }

            // Load session data and send it to the dashboard for printing
            const sessionFilePath = path.join(SESSIONS_DIR, lastSessionId);
            const sessionDataToPrint = JSON.parse(fs.readFileSync(sessionFilePath));

            mainWindow.show();
            mainWindow.webContents.send('generate-report', sessionDataToPrint);
            
            // Wait for dashboard to confirm it has rendered the report
            await new Promise(resolve => ipcMain.once('report-ready-for-pdf', resolve));

            // Tell the dashboard to trigger the print dialog
            mainWindow.webContents.send('trigger-pdf-generation');
            return { success: true };

        } catch (error) {
            console.error('Error handling "print last" action:', error);
            return { success: false, message: 'Failed to print the last session.' };
        }
    }

    // --- LOGIC FOR 'Choose Session' ---
    if (action === 'choose') {
        try {
            // Simply show the dashboard window, which already lists all sessions
            if (!mainWindow || mainWindow.isDestroyed()) {
                createMainWindow();
            }
            mainWindow.show();
            mainWindow.focus(); // Bring window to the front
            return { success: true, message: 'Dashboard shown for session selection.' };
        } catch (error) {
            console.error('Error handling "choose session" action:', error);
            return { success: false, message: 'Could not show dashboard.' };
        }
    }

    // Fallback for any unknown action
    console.warn(`Unknown print-request action received: ${action}`);
    return { success: false, message: `Unknown action: ${action}` };
});

// This handler generates and prints a summary of apps with actual text activity.
ipcMain.handle('print-text-app-summary', async () => {
    console.log('Generating filtered app summary report for printing...');
    try {
        // Ensure the dashboard window exists to display the report.
        if (!mainWindow || mainWindow.isDestroyed()) {
            createMainWindow();
            await new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
        }

        const allSessionFiles = fs.readdirSync(SESSIONS_DIR).filter(file => file.endsWith('.json'));
        if (allSessionFiles.length === 0) {
            new Notification({ title: 'No Data', body: 'There are no saved sessions to generate a report from.' }).show();
            return { success: false, message: 'No sessions found.' };
        }

        // Object to hold the summary data for apps with text.
        const appTextSummary = {};

        // Process every session file to gather data.
        allSessionFiles.forEach(file => {
            const sessionData = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file)));
            if (!sessionData || !sessionData.activities) return;

            sessionData.activities.forEach(activity => {
                // We only care about activities with text content.
                if (activity.type === 'keystroke' || activity.type === 'paste') {
                    const appName = activity.appName || 'Unknown';
                    
                    // If this is the first time we see this app, initialize it.
                    if (!appTextSummary[appName]) {
                        appTextSummary[appName] = {
                            name: appName,
                            keystrokes: 0,
                            pastes: 0,
                            characters: 0,
                        };
                    }

                    // Increment counters based on activity type.
                    if (activity.type === 'keystroke') {
                        appTextSummary[appName].keystrokes++;
                        appTextSummary[appName].characters++;
                    } else if (activity.type === 'paste' && activity.text) {
                        appTextSummary[appName].pastes++;
                        appTextSummary[appName].characters += activity.text.length;
                    }
                }
            });
        });

        // Convert the summary object to an array and filter out apps with NO text activity.
        const filteredReportData = Object.values(appTextSummary).filter(app => app.keystrokes > 0 || app.pastes > 0);
        
        // Sort the final list by the number of characters, descending.
        filteredReportData.sort((a, b) => b.characters - a.characters);

        if (filteredReportData.length === 0) {
             new Notification({ title: 'No Text Activity', body: 'No sessions contain any recorded keystrokes or pastes.' }).show();
             return { success: false, message: 'No text activity found to report.' };
        }

        // Send the final, filtered data to dashboard.html to be displayed for printing.
        mainWindow.show();
        mainWindow.webContents.send('generate-filtered-app-report', filteredReportData);

        // Wait for the dashboard to confirm it's ready for printing.
        await new Promise(resolve => ipcMain.once('report-ready-for-pdf', resolve));

        // Send the final command to trigger the print dialog.
        mainWindow.webContents.send('trigger-pdf-generation');
        return { success: true };

    } catch (error) {
        console.error('Error in print-text-app-summary handler:', error);
        return { success: false, message: 'Failed to generate the application summary report.' };
    }
});




function saveSessionCounter() {
    try {
        fs.writeFileSync(SESSION_COUNTER_FILE, JSON.stringify({ counter: sessionCounter }, null, 2));
    } catch (error) {
        console.error('Error saving session counter:', error);
    }
}


function createMainWindow() {
  mainWindow = new BrowserWindow({ 
      width: 1600, 
      height: 1000, 
      webPreferences: { 
          nodeIntegration: true, 
          contextIsolation: false 
      } 
  });
  mainWindow.loadFile('dashboard.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}





function createControlWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  
  controlWindow = new BrowserWindow({
      width: 300,
      height: 120,
      x: width - 320,
      y: 20,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
      }
  });

  controlWindow.loadFile('controls.html');
  controlWindow.setVisibleOnAllWorkspaces(true);
}

function startTracking() {
    if (isTracking) return;
    
    isTracking = true;
    currentSessionActivities = []; 

    // Generate session ID with sequential number
    const timestamp = Date.now();
    sessionID = `session_${sessionCounter}_${timestamp}`;
    
    console.log(`🎯 Starting Session #${sessionCounter} at ${new Date().toLocaleString()}`);
    console.log(`📋 Session ID: ${sessionID}`);
    
    startTime = new Date();
    sessionData = {
        sessionID: sessionID,
        sessionNumber: sessionCounter,
        startTime: startTime,
        endTime: null,
        activities: [],
        apps: {}
    };

    // Initialize keyboard listener
    keyListener = new GlobalKeyboardListener();
    
    keyListener.addListener(async (e, down) => {
        if (!isTracking || e.state !== 'DOWN') return;
        
        const context = await getCurrentContext();
        
        // Check for Paste (Ctrl+V)
        if (e.name === 'V' && (down['LEFT CTRL'] || down['RIGHT CTRL'])) {
            const pastedText = clipboard.readText();
            
            if (pastedText) {
                captureActivity('paste', {
                    text: pastedText,
                    timestamp: new Date(),
                    sessionID: sessionID,
                    sessionNumber: sessionCounter,
                    ...context
                });
            }
            return;
        }
        
        // Record other keystrokes with session info
        if (e.name) {
            captureActivity('keystroke', { 
                key: e.name, 
                sessionID: sessionID,
                sessionNumber: sessionCounter,
                ...context 
            });
        }
    });

    // Start mouse tracking for this session
    startMouseTracking();
    
    console.log(`✅ Session #${sessionCounter} tracking started successfully`);
}


function stopTracking() {
    if (!isTracking) return;
    
    isTracking = false;
    
    sessionData.endTime = new Date();
    const duration = sessionData.endTime - sessionData.startTime;
    
    console.log(`🛑 Stopping Session #${sessionCounter}`);
    console.log(`📊 Total Activities: ${currentSessionActivities.length}`);
    
    if (keyListener) {
        keyListener.kill();
        keyListener = null;
    }

    // Process and save session data
    if (currentSessionActivities.length > 0) {
        // Group activities by apps for this session
        const sessionApps = {};
        
        currentSessionActivities.forEach(activity => {
            const appName = activity.appName || 'Unknown';
            if (!sessionApps[appName]) {
                sessionApps[appName] = {
                    name: appName,
                    activities: [],
                    firstSeen: activity.timestamp,
                    lastSeen: activity.timestamp,
                    totalActivities: 0
                };
            }
            sessionApps[appName].activities.push(activity);
            sessionApps[appName].lastSeen = activity.timestamp;
            sessionApps[appName].totalActivities++;
        });

        console.log(`📱 Apps used in Session #${sessionCounter}:`, Object.keys(sessionApps));

        const completeSessionData = {
            sessionID: sessionID,
            sessionNumber: sessionCounter,
            startTime: sessionData.startTime.toISOString(),
            endTime: sessionData.endTime.toISOString(),
            duration: duration,
            totalActivities: currentSessionActivities.length,
            activities: currentSessionActivities,
            apps: sessionApps,
            mainContext: {
                appName: Object.values(sessionApps).sort((a,b) => b.totalActivities - a.totalActivities)[0]?.name || 'Unknown',
                windowTitle: currentSessionActivities[0]?.windowTitle || 'Unknown',
                url: currentSessionActivities[0]?.url || 'N/A'
            }
        };
        saveSessionCounter(); // Saves the new number so it's not lost
        const filename = `session_${sessionCounter}_${Date.now()}.json`;
        fs.writeFile(path.join(SESSIONS_DIR, filename), JSON.stringify(completeSessionData, null, 2), (err) => { if (err) console.error('Error saving session:', err); });
        console.log(`💾 Session #${sessionCounter} saved as: ${filename}`);

        sessionCounter++;
        saveSessionCounter();

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('new-session-saved');
            mainWindow.show();
        }
    }

    // Clear current session data
    currentSessionActivities = [];
    sessionID = null;
    
    console.log(`✅ Session #${sessionCounter - 1} completed and saved successfully`);
    console.log(`🔄 Ready for Session #${sessionCounter}`);
}





async function getCurrentContext() {
  try {
      const activeWindow = await activeWin();
      console.log('activeWindow :>> ', activeWindow);
      return { windowTitle: activeWindow?.title || '?', appName: activeWindow?.owner?.name || '?', url: activeWindow?.url || 'N/A' };

    } 
    
    catch (error) { 

    return { windowTitle: '?', appName: '?', url: 'N/A' }; }

}


ipcMain.handle('print-specific-app', async (event, { appName, appTitle, sessionId }) => {
    try {
        const sessionData = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, sessionId)));
        
        const filteredActivities = sessionData.activities.filter(act => 
            act.appName === appName && act.windowTitle === appTitle
        );
        
        // Check if there's printable content
        const hasContent = filteredActivities.some(act => 
            act.type === 'keystroke' || act.type === 'paste'
        );
        
        if (!hasContent) {
            return { success: false, message: 'No text content found for this application' };
        }
        
        // Rest of your existing code...
        const appSpecificData = {
            ...sessionData,
            activities: filteredActivities,
            totalActivities: filteredActivities.length,
            apps: {
                [appName]: {
                    name: appName,
                    activities: filteredActivities,
                    totalActivities: filteredActivities.length,
                    firstSeen: filteredActivities[0]?.timestamp,
                    lastSeen: filteredActivities[filteredActivities.length - 1]?.timestamp
                }
            }
        };
        
        if (!mainWindow || mainWindow.isDestroyed()) {
            createMainWindow();
            await new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
        }
        
        mainWindow.show();
        mainWindow.webContents.send('generate-report', appSpecificData);
        
        await new Promise(resolve => ipcMain.once('report-ready-for-pdf', resolve));
        mainWindow.webContents.send('trigger-pdf-generation');

        return { success: true };
    } catch (error) {
        console.error('Error in print-specific-app:', error);
        return { success: false, message: 'Failed to print app report.' };
    }
});


// ipcMain.handle('print-individual-app', async (event, { appName, appTitle, sessionId, sessionNumber }) => {
//     try {
//         const sessionData = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, sessionId)));
        
//         // Filter for specific app activities
//         const appActivities = sessionData.activities.filter(act => 
//             act.appName === appName && act.windowTitle === appTitle
//         );
        
//         // Only get text-based activities
//         const textActivities = appActivities.filter(act => 
//             act.type === 'keystroke' || act.type === 'paste'
//         );
        
//         console.log(`App: ${appName}, Total: ${appActivities.length}, Text: ${textActivities.length}`);
        
//         if (textActivities.length === 0) {
//             return { success: false, message: `${appName} has no text content (only ${appActivities.length} mouse movements)` };
//         }
        
//         // Use ALL activities (including mouse) but ensure text exists
//         const appOnlyData = {
//             sessionID: sessionData.sessionID + '_' + appName.replace(/\s+/g, '_'),
//             sessionNumber: sessionNumber,
//             startTime: sessionData.startTime,
//             endTime: sessionData.endTime,
//             activities: appActivities, // Include all activities for this app
//             totalActivities: appActivities.length,
//             apps: {
//                 [appName]: {
//                     name: appName,
//                     activities: appActivities,
//                     totalActivities: appActivities.length,
//                     firstSeen: appActivities[0]?.timestamp,
//                     lastSeen: appActivities[appActivities.length - 1]?.timestamp
//                 }
//             }
//         };
        
//         if (!mainWindow || mainWindow.isDestroyed()) {
//             createMainWindow();
//             await new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
//         }
        
//         mainWindow.show();
//         mainWindow.webContents.send('generate-report', appOnlyData);
        
//         await new Promise(resolve => ipcMain.once('report-ready-for-pdf', resolve));
//         mainWindow.webContents.send('trigger-pdf-generation');

//         return { success: true };
//     } catch (error) {
//         console.error('Error printing individual app:', error);
//         return { success: false, message: 'Failed to print app report.' };
//     }
// });


ipcMain.handle('print-last-session', async () => {
    try {
        // 1. Get all session files from the sessions directory.
        const sessionFiles = fs.readdirSync(SESSIONS_DIR)
                               .filter(file => file.endsWith('.json'));

        // 2. Check if there are any sessions available to print.
        if (sessionFiles.length === 0) {
            console.log('No sessions found to print.');
            // You can optionally show an error dialog to the user here.
            return { success: false, message: 'No saved sessions were found.' };
        }

        // 3. Sort the files to find the most recent one.
        // This sort function correctly parses the timestamp from filenames like 'session_1_1754137905613.json'.
        sessionFiles.sort((a, b) => {
            const timeA = parseInt(a.split('_').pop().replace('.json', ''), 10);
            const timeB = parseInt(b.split('_').pop().replace('.json', ''), 10);
            return timeB - timeA; // Sort in descending order to get the latest session first.
        });

        // 4. The most recent session is the first file in the sorted array.
        const lastSessionId = sessionFiles[0];
        console.log(`Located last session to print: ${lastSessionId}`);

        // 5. Now, reuse your existing print logic from the 'print-session' handler.
        if (!mainWindow || mainWindow.isDestroyed()) {
            console.log('Dashboard window not found, creating it for printing...');
            createMainWindow();
            // Wait for the new window to fully load its content.
            await new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
            console.log('Dashboard window is ready for printing.');
        }

        const sessionFilePath = path.join(SESSIONS_DIR, lastSessionId);
        const sessionDataToPrint = JSON.parse(fs.readFileSync(sessionFilePath));

        // Make sure the dashboard window is visible.
        mainWindow.show();
        
        // Send the specific session data to the dashboard to be rendered for printing.
        mainWindow.webContents.send('generate-report', sessionDataToPrint);
        
        // Wait for the dashboard to confirm that the report is rendered and ready.
        await new Promise(resolve => ipcMain.once('report-ready-for-pdf', resolve));

        // Tell the dashboard to trigger the final PDF generation/print dialog.
        mainWindow.webContents.send('trigger-pdf-generation');

        return { success: true };

    } catch (error) {
        console.error('Error in print-last-session handler:', error);
        return { success: false, message: 'An error occurred while trying to print the last session.' };
    }
});

ipcMain.handle('print-app-list', async () => {
    try {
        // Step 1: Make sure the dashboard window exists to display the report.
        if (!mainWindow || mainWindow.isDestroyed()) {
            createMainWindow();
            await new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
        }

        // Step 2: Read all session files from the disk.
        const allSessionFiles = fs.readdirSync(SESSIONS_DIR).filter(file => file.endsWith('.json'));
        if (allSessionFiles.length === 0) {
            new Notification({ title: 'No Data', body: 'There are no saved sessions to generate an app report.' }).show();
            return { success: false, message: 'No sessions found.' };
        }

        // Step 3: Process the files to summarize app usage.
        const appSummary = {};
        allSessionFiles.forEach(file => {
            const sessionData = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file)));
            if (sessionData && sessionData.apps) {
                for (const appName in sessionData.apps) {
                    const app = sessionData.apps[appName];
                    if (!appSummary[appName]) {
                        appSummary[appName] = { name: appName, totalActivities: 0, totalTimeSpent: 0, sessionCount: 0 };
                    }
                    appSummary[appName].totalActivities += app.totalActivities || 0;
                    appSummary[appName].sessionCount++;
                    if (app.activities && app.activities.length > 1) {
                        const appStartTime = new Date(app.activities[0].timestamp);
                        const appEndTime = new Date(app.activities[app.activities.length - 1].timestamp);
                        appSummary[appName].totalTimeSpent += (appEndTime - appStartTime);
                    }
                }
            }
        });

        const sortedAppSummary = Object.values(appSummary).sort((a, b) => b.totalActivities - a.totalActivities);

        // Step 4: Send the final, calculated data to dashboard.html to be displayed.
        mainWindow.show();
        mainWindow.webContents.send('generate-app-summary-report', sortedAppSummary);

        // Step 5: Wait for the dashboard to confirm it's ready for printing.
        await new Promise(resolve => ipcMain.once('report-ready-for-pdf', resolve));

        // Step 6: Send the final command to trigger the print dialog on the dashboard window.
        mainWindow.webContents.send('trigger-pdf-generation');
        return { success: true };

    } catch (error) {
        console.error('Error in print-app-list handler:', error);
        return { success: false, message: 'Failed to generate the application summary report.' };
    }
});

ipcMain.handle('print-choose-session', async () => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            createMainWindow();
        }
        mainWindow.show();
        mainWindow.focus(); // Bring the window to the front
        return { success: true, message: 'Dashboard shown for session selection.' };
    } catch (error) {
        console.error('Error showing dashboard for session selection:', error);
        return { success: false, message: 'Could not show dashboard.' };
    }
});

function captureActivity(type, data) {
    if (!isTracking || !sessionID) return;
    const appName = data.appName || '?';
    if (excludeList.length > 0 && excludeList.includes(appName)) {
        console.log(`Skipping excluded app: ${appName}`);
        return; 
    }

    if (includeList.length > 0 && !includeList.includes(appName)) {
        console.log(`Skipping non-included app: ${appName}`);
        return;
    }
    const activity = {
        id: Date.now() + Math.random(),
        type,
        timestamp: new Date().toISOString(),
        sessionID: sessionID,
        sessionNumber: sessionCounter, // Add session number to each activity
        ...data
    };
    
    
    // Enhanced console logging with session info
    if (type === 'keystroke') {
        console.log(`⌨️ Session #${sessionCounter} | ${activity.appName} | Key: ${activity.key} | Time: ${new Date().toLocaleTimeString()}`);
    } else if (type === 'paste') {
        console.log(`📋 Session #${sessionCounter} | ${activity.appName} | Pasted: ${(activity.text || '').substring(0, 50)}... | Time: ${new Date().toLocaleTimeString()}`);
    } else if (type === 'mouse') {
        // Less verbose for mouse to avoid spam
        if (Math.random() < 0.1) { // Log only 10% of mouse events
            console.log(`🖱️ Session #${sessionCounter} | ${activity.appName} | Mouse: (${activity.x}, ${activity.y})`);
        }
    }
    
    trackingData.push(activity);
    if (sessionData) {
        sessionData.activities.push(activity);
    }
    currentSessionActivities.push(activity);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('activity-update', activity);
    }
}

function startMouseTracking() {
    const trackMouse = async () => {
        if (!isTracking || !sessionID) return;
        
        const mousePos = screen.getCursorScreenPoint();
        const context = await getCurrentContext();
        console.log('context :>> ', context);
        captureActivity('mouse', {
            x: mousePos.x,
            y: mousePos.y,
            timestamp: new Date(),
            sessionID: sessionID,
            sessionNumber: sessionCounter,
            ...context
        });
        
        setTimeout(trackMouse, 100);
    };
    
    trackMouse();
}

ipcMain.handle('get-all-sessions', () => {
    const sessionFiles = fs.readdirSync(SESSIONS_DIR).filter(file => file.endsWith('.json'));
    
    return sessionFiles.map(file => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file)));
            
            return {
                id: file,
                sessionNumber: data.sessionNumber || 'Unknown',
                sessionID: data.sessionID,
                startTime: data.startTime,
                endTime: data.endTime,
                duration: data.duration,
                totalActivities: data.totalActivities,
                apps: data.apps,
                mainContext: data.mainContext
            };
        } catch { 
            return null; 
        }
    }).filter(s => s).sort((a, b) => (b.sessionNumber || 0) - (a.sessionNumber || 0)); // Sort by session number descending
});



ipcMain.handle('delete-all-sessions', () => {
    try {
        fs.readdirSync(SESSIONS_DIR).forEach(file => fs.unlinkSync(path.join(SESSIONS_DIR, file)));

        sessionCounter = 1;
        saveSessionCounter();

      // Tell dashboard to refresh its (now empty) list
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-session-saved'); 
      }
      return { success: true };
    } catch (error) { console.error('Failed to delete sessions:', error); return { success: false }; }
  });

  

  ipcMain.handle('search-all-data', async (event, searchTerm) => {
    if (!searchTerm || searchTerm.trim() === '') {
        return [];
    }

    const matchingSessionIds = new Set();
    const lowerCaseSearchTerm = searchTerm.toLowerCase();

    try {
        const sessionFiles = fs.readdirSync(SESSIONS_DIR).filter(file => file.endsWith('.json'));

        for (const file of sessionFiles) {
            const filePath = path.join(SESSIONS_DIR, file);
            const sessionData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

            if (!sessionData || !Array.isArray(sessionData.activities)) {
                continue;
            }

            let fullTextContent = '';
            let metadataMatch = false;

            // This loop checks metadata and builds a single string of all typed/pasted content
            for (const activity of sessionData.activities) {
                // Check for match in app name or window title
                if ((activity.appName && activity.appName.toLowerCase().includes(lowerCaseSearchTerm)) ||
                    (activity.windowTitle && activity.windowTitle.toLowerCase().includes(lowerCaseSearchTerm))) {
                    metadataMatch = true;
                }

                // Build the full text string
                if (activity.type === 'paste' && activity.text) {
                    fullTextContent += activity.text + ' ';
                } else if (activity.type === 'keystroke' && activity.key) {
                    if (activity.key.length === 1) {
                        fullTextContent += activity.key;
                    } else if (activity.key === 'SPACE') {
                        fullTextContent += ' ';
                    }
                }
            }
            const contentMatch = fullTextContent.toLowerCase().includes(lowerCaseSearchTerm);
            if (metadataMatch || contentMatch) {
                matchingSessionIds.add(file);
            }
        }
    } catch (error)
    {
        console.error('Error during file search:', error);
        return [];
    }

    return Array.from(matchingSessionIds);
});

  
  ipcMain.handle('get-session-details', (event, sessionId) => {
    try {
        console.log('Looking for session file:', sessionId);
        const filePath = path.join(SESSIONS_DIR, sessionId);
        
        if (!fs.existsSync(filePath)) {
            console.log('File does not exist:', filePath);
            return null;
        }
        
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading session file:', error);
        return null;
    }
});






function saveSessionData() {
    const filename = `session_${Date.now()}.json`;
    const filepath = path.join(DATA_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(sessionData, null, 2));
}


function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds < 0) return '0s';
    
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function generateReport() {
    // This will be handled by the renderer process
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('generate-report', sessionData);
        if (!isInvisible) {
            mainWindow.show();
        }
    }
}

// IPC Handlers
ipcMain.handle('start-tracking', () => {
    startTracking();
    return { success: true };
});

ipcMain.handle('stop-tracking', () => {
    stopTracking();
    return { success: true };
});

ipcMain.handle('toggle-invisible', (event, invisible) => {
    isInvisible = invisible;
    if (controlWindow) {
        if (invisible) {
            controlWindow.hide();
            // Show a system notification to inform the user
            new Notification({
                title: 'Tracker is Now Invisible',
                body: 'Press Ctrl+Shift+Alt+V to show the controls again.'
            }).show();
            // Auto-start tracking if not already running
            if (!isTracking) {
                startTracking();
            }
        } else {
            controlWindow.show();
        }
    }
    return { success: true };
});



ipcMain.handle('get-tracking-data', () => {
    return trackingData;
});


ipcMain.handle('show-dashboard', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
  } else {
      createMainWindow();
      mainWindow.show();
  }
  return { success: true };
});


app.whenReady().then(() => {
    loadSessionCounter(); // Load the counter first
    createControlWindow();
    // createMainWindow();
    globalShortcut.register('CommandOrControl+Shift+Alt+V', () => {
        console.log('Global shortcut pressed. Toggling control window.');
        if (controlWindow && !controlWindow.isDestroyed()) {
            if (controlWindow.isVisible()) {
                controlWindow.hide();
            } else {
                controlWindow.show();
            }
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});



ipcMain.handle('print-session', async (event, sessionId) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        console.log('Dashboard window not found, creating it for printing...');
        createMainWindow();
        // Wait for the new window to fully load its content
        await new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
        console.log('Dashboard window created and ready for printing.');
    }

    try {
        // Find the specific session file
        const sessionFilePath = path.join(SESSIONS_DIR, sessionId);
        if (!fs.existsSync(sessionFilePath)) {
             return { success: false, message: 'Session file not found.' };
        }
        
        const sessionDataToPrint = JSON.parse(fs.readFileSync(sessionFilePath));

        console.log(`Sending print command for session: ${sessionDataToPrint.sessionID}`);
        
        mainWindow.show(); // Make sure the window is visible
        
        // Send the data to the dashboard and wait for it to confirm it's ready
        mainWindow.webContents.send('generate-report', sessionDataToPrint);
        
        // Wait for the renderer to signal that the report is rendered
        await new Promise(resolve => ipcMain.once('report-ready-for-pdf', resolve));

        // Now, tell the dashboard to create the PDF/print
        mainWindow.webContents.send('trigger-pdf-generation');

        return { success: true };

    } catch (error) {
        console.error('Error in print-session handler:', error);
        return { success: false, message: 'Failed to process print command.' };
    }
});



app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (keyListener) {
        keyListener.kill();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        createControlWindow();
    }
});