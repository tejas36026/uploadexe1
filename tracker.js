const activeWin = require('active-win');
const { screen } = require('electron');

class AdvancedTracker {
    constructor() {
        this.currentText = '';
        this.sentences = [];
        this.typingTimes = [];
        this.lastKeystroke = null;
        this.pasteDetection = [];
        this.mousePositions = [];
        
        // Typing classification thresholds
        this.FAST_TYPING_THRESHOLD = 50; // ms between keystrokes
        this.THINKING_TIME_THRESHOLD = 10000; // 10 seconds
        this.PASTE_SPEED_THRESHOLD = 20; // ms between characters for paste detection
    }

    processKeystroke(keystroke) {
        console.log('Keystroke received:', keystroke.key); 

    
        const now = new Date();
        const activity = {
            ...keystroke,
            timestamp: now,
            classification: this.classifyKeystroke(keystroke, now)
        };

        this.updateTypingAnalysis(activity);
        return activity;
    }

    classifyKeystroke(keystroke, timestamp) {
        const timeSinceLastKey = this.lastKeystroke ? 
            timestamp - this.lastKeystroke.timestamp : 0;

        let classification = 'normal';

        // Detect paste operations
        if (this.detectPaste(keystroke, timeSinceLastKey)) {
            classification = 'pasted';
        }
        // Detect fast typing (20% faster than average)
        else if (timeSinceLastKey > 0 && timeSinceLastKey < this.FAST_TYPING_THRESHOLD) {
            classification = 'fast-typing';
        }
        // Detect thoughtful typing (with thinking time)
        else if (timeSinceLastKey > this.THINKING_TIME_THRESHOLD) {
            classification = 'thoughtful';
        }
        // Detect corrections (backspace, delete, ctrl+z)
        else if (this.isCorrection(keystroke)) {
            classification = 'correction';
        }

        this.lastKeystroke = { ...keystroke, timestamp };
        return classification;
    }

    detectPaste(keystroke, timeSinceLastKey) {
        // Detect Ctrl+V
        if (keystroke.key === 'V' && keystroke.ctrlKey) {
            return true;
        }

        // Detect rapid text input (likely paste)
        if (timeSinceLastKey > 0 && timeSinceLastKey < this.PASTE_SPEED_THRESHOLD) {
            this.pasteDetection.push(timeSinceLastKey);
            
            // If we have 10+ consecutive fast keystrokes, likely a paste
            if (this.pasteDetection.length >= 10) {
                const avgTime = this.pasteDetection.reduce((a, b) => a + b, 0) / this.pasteDetection.length;
                if (avgTime < this.PASTE_SPEED_THRESHOLD) {
                    this.pasteDetection = []; // Reset
                    return true;
                }
            }
        } else {
            this.pasteDetection = []; // Reset if timing breaks
        }

        return false;
    }

    isCorrection(keystroke) {
        const correctionKeys = ['BACKSPACE', 'DELETE'];
        const isCtrlZ = keystroke.key === 'Z' && keystroke.ctrlKey;
        
        return correctionKeys.includes(keystroke.key) || isCtrlZ;
    }

    updateTypingAnalysis(activity) {
        // Build current text for sentence analysis
        if (activity.key && activity.key.length === 1) {
            this.currentText += activity.key;
        } else if (activity.key === 'SPACE') {
            this.currentText += ' ';
        } else if (activity.key === 'ENTER' || activity.key === '.') {
            if (this.currentText.trim()) {
                this.sentences.push({
                    text: this.currentText.trim(),
                    timestamp: activity.timestamp,
                    classification: this.classifySentence(this.currentText.trim()),
                    context: {
                        appName: activity.appName,
                        windowTitle: activity.windowTitle,
                        url: activity.url
                    }
                });
                this.currentText = '';
            }
        } else if (activity.key === 'BACKSPACE') {
            this.currentText = this.currentText.slice(0, -1);
        }

        // Track typing rhythm
        if (this.lastKeystroke) {
            const interval = activity.timestamp - this.lastKeystroke.timestamp;
            this.typingTimes.push({
                interval,
                timestamp: activity.timestamp,
                key: activity.key
            });
        }
    }

    classifySentence(text) {
        // Analyze sentence characteristics
        const words = text.split(' ').filter(w => w.length > 0);
        const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
        
        // Check for characteristics that might indicate different input methods
        if (avgWordLength > 6 && words.length > 10) {
            return 'potentially-pasted'; // Long, complex sentences might be pasted
        }
        
        return 'typed';
    }

    async processMouseEvent(mouseData) {
        try {
            const context = await this.getCurrentContext();
            const mouseActivity = {
                ...mouseData,
                ...context,
                timestamp: new Date(),
                type: 'mouse'
            };

            this.mousePositions.push(mouseActivity);
            return mouseActivity;
        } catch (error) {
            console.error('Error processing mouse event:', error);
            return null;
        }
    }

    async getCurrentContext() {
        try {
            const activeWindow = await activeWin();
            return {
                windowTitle: activeWindow?.title || 'Unknown',
                appName: activeWindow?.owner?.name || 'Unknown',
                processId: activeWindow?.owner?.processId || 0,
                url: activeWindow?.url || null
            };
        } catch (error) {
            return {
                windowTitle: 'Unknown',
                appName: 'Unknown',
                processId: 0,
                url: null
            };
        }
    }

    generateTypingRhythm() {
        if (this.typingTimes.length < 2) return [];

        const rhythm = [];
        for (let i = 1; i < this.typingTimes.length; i++) {
            const prev = this.typingTimes[i - 1];
            const curr = this.typingTimes[i];
            
            rhythm.push({
                interval: curr.interval,
                timestamp: curr.timestamp,
                pattern: this.analyzeRhythmPattern(prev.interval, curr.interval)
            });
        }

        return rhythm;
    }

    analyzeRhythmPattern(prevInterval, currInterval) {
        const ratio = currInterval / prevInterval;
        
        if (ratio < 0.5) return 'accelerating';
        if (ratio > 2) return 'decelerating';
        if (Math.abs(ratio - 1) < 0.2) return 'steady';
        return 'variable';
    }

    generateReport() {
        const report = {
            summary: {
                totalKeystrokes: this.typingTimes.length,
                totalSentences: this.sentences.length,
                totalMouseEvents: this.mousePositions.length,
                sessionDuration: this.getSessionDuration()
            },
            sentences: this.sentences,
            typingRhythm: this.generateTypingRhythm(),
            mouseHeatmap: this.generateMouseHeatmap(),
            applicationUsage: this.getApplicationUsage(),
            classification: this.getClassificationSummary()
        };

        return report;
    }

    getSessionDuration() {
        if (this.typingTimes.length === 0) return 0;
        
        const first = this.typingTimes[0].timestamp;
        const last = this.typingTimes[this.typingTimes.length - 1].timestamp;
        
        return last - first;
    }

    generateMouseHeatmap() {
        const heatmap = {};
        const gridSize = 50; // 50x50 pixel grid
        
        this.mousePositions.forEach(pos => {
            const gridX = Math.floor(pos.x / gridSize);
            const gridY = Math.floor(pos.y / gridSize);
            const gridKey = `${gridX},${gridY}`;
            heatmap[gridKey] = (heatmap[gridKey] || 0) + 1;
        });

        // Convert to array format for visualization
        const heatmapData = Object.entries(heatmap).map(([key, count]) => {
            const [x, y] = key.split(',').map(Number);
            return {
                x: x * gridSize + gridSize/2, // Center of grid cell
                y: y * gridSize + gridSize/2,
                value: count
            };
        });

        return {
            gridSize,
            data: heatmapData,
            maxValue: Math.max(...Object.values(heatmap), 1)
        };
    }

    getApplicationUsage() {
        const appUsage = {};
        
        this.typingTimes.forEach(activity => {
            const appName = activity.appName || 'Unknown';
            appUsage[appName] = (appUsage[appName] || 0) + 1;
        });

        this.mousePositions.forEach(activity => {
            const appName = activity.appName || 'Unknown';
            appUsage[appName] = (appUsage[appName] || 0) + 1;
        });

        // Convert to sorted array
        return Object.entries(appUsage)
            .sort((a, b) => b[1] - a[1])
            .map(([appName, count]) => ({ appName, count }));
    }

    getClassificationSummary() {
        const summary = {
            typed: 0,
            pasted: 0,
            'fast-typing': 0,
            thoughtful: 0,
            correction: 0
        };

        this.typingTimes.forEach(activity => {
            if (activity.classification) {
                summary[activity.classification] = (summary[activity.classification] || 0) + 1;
            }
        });

        return summary;
    }

    // Additional helper methods
    calculateTypingSpeed() {
        if (this.typingTimes.length < 2) return 0;
        
        const first = this.typingTimes[0].timestamp;
        const last = this.typingTimes[this.typingTimes.length - 1].timestamp;
        const durationMinutes = (last - first) / (1000 * 60);
        
        // Count words in sentences
        let wordCount = 0;
        this.sentences.forEach(sentence => {
            wordCount += sentence.text.split(/\s+/).length;
        });
        
        return Math.round(wordCount / durationMinutes);
    }

    detectTypingPatterns() {
        const patterns = {
            burstTyping: 0,
            steadyTyping: 0,
            mixedPattern: 0
        };
        
        const rhythm = this.generateTypingRhythm();
        if (rhythm.length === 0) return patterns;
        
        let consecutiveFast = 0;
        let currentPattern = null;
        
        for (let i = 0; i < rhythm.length; i++) {
            if (rhythm[i].pattern === 'accelerating') {
                consecutiveFast++;
                if (consecutiveFast >= 5) {
                    currentPattern = 'burst';
                }
            } else if (rhythm[i].pattern === 'steady') {
                if (currentPattern === 'steady') {
                    patterns.steadyTyping++;
                } else {
                    currentPattern = 'steady';
                }
                consecutiveFast = 0;
            } else {
                if (currentPattern === 'mixed') {
                    patterns.mixedPattern++;
                } else {
                    currentPattern = 'mixed';
                }
                consecutiveFast = 0;
            }
        }
        
        return patterns;
    }

    // Data persistence methods
    saveToFile(filePath) {
        const data = {
            sentences: this.sentences,
            typingTimes: this.typingTimes,
            mousePositions: this.mousePositions,
            metadata: {
                createdAt: new Date(),
                typingSpeed: this.calculateTypingSpeed(),
                sessionDuration: this.getSessionDuration()
            }
        };
        
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving tracker data:', error);
            return false;
        }
    }

    loadFromFile(filePath) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            this.sentences = data.sentences || [];
            this.typingTimes = data.typingTimes || [];
            this.mousePositions = data.mousePositions || [];
            return true;
        } catch (error) {
            console.error('Error loading tracker data:', error);
            return false;
        }
    }

    // Real-time monitoring methods
    startMonitoring() {
        this.monitoringInterval = setInterval(() => {
            this.checkActivityLevel();
            this.detectIdleTime();
        }, 5000); // Check every 5 seconds
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
    }

    checkActivityLevel() {
        const now = new Date();
        const lastMinuteActivities = this.typingTimes.filter(
            activity => now - activity.timestamp < 60000
        ).length;
        
        if (lastMinuteActivities < 5) {
            this.triggerEvent('low-activity', { count: lastMinuteActivities });
        } else if (lastMinuteActivities > 60) {
            this.triggerEvent('high-activity', { count: lastMinuteActivities });
        }
    }

    detectIdleTime() {
        if (!this.lastKeystroke) return;
        
        const now = new Date();
        const idleTime = now - this.lastKeystroke.timestamp;
        
        if (idleTime > 300000) { // 5 minutes
            this.triggerEvent('idle', { duration: idleTime });
        }
    }

    triggerEvent(eventName, data) {
        // This would be connected to event listeners in the main application
        console.log(`Tracker event: ${eventName}`, data);
        // In a real implementation, you would emit this to listeners
        // this.emit(eventName, data);
    }
}

module.exports = AdvancedTracker;
