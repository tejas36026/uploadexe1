class AdvancedTracker {
    constructor() {
        this.activities = [];
        this.currentText = '';
        this.currentSentence = '';
        this.classifications = {
            typed: {color: '#27ae60', label: 'Typed'},
            pasted: {color: '#e74c3c', label: 'Pasted'},
            fastTyping: {color: '#f39c12', label: 'Fast Typing'},
            thoughtful: {color: '#9b59b6', label: 'Thoughtful'},
            correction: {color: '#3498db', label: 'Correction'}
        };
    }

    async processActivity(type, data) {
        const context = await this.getContext();
        const timestamp = new Date();
        
        const activity = {
            type,
            ...data,
            ...context,
            timestamp,
            hour: timestamp.getHours(),
            date: timestamp.toISOString().split('T')[0],
            classification: this.classifyActivity(type, data, timestamp)
        };

        this.activities.push(activity);
        this.updateTextAnalysis(activity);
        return activity;
    }

    async getContext() {
        try {
            const windowInfo = await activeWin();
            return {
                appName: windowInfo?.owner?.name || 'Unknown',
                windowTitle: windowInfo?.title || 'Unknown',
                url: windowInfo?.url || null,
                processId: windowInfo?.owner?.processId || null
            };
        } catch (error) {
            return {
                appName: 'Unknown',
                windowTitle: 'Unknown',
                url: null,
                processId: null
            };
        }
    }

    classifyActivity(type, data, timestamp) {
        if (type === 'mouse') return null;
        
        // Paste detection
        if (data.ctrlKey && data.key.toLowerCase() === 'v') return 'pasted';
        
        // Fast typing (under 50ms between keystrokes)
        const lastKey = this.activities
            .filter(a => a.type === 'keystroke')
            .slice(-1)[0];
            
        if (lastKey && (timestamp - lastKey.timestamp) < 50) {
            return 'fastTyping';
        }
        
        // Thoughtful typing (over 10s between keystrokes)
        if (lastKey && (timestamp - lastKey.timestamp) > 10000) {
            return 'thoughtful';
        }
        
        // Corrections
        if (['backspace', 'delete'].includes(data.key.toLowerCase())) {
            return 'correction';
        }
        
        return 'typed';
    }

    updateTextAnalysis(activity) {
        if (activity.type !== 'keystroke') return;

        // Handle text input
        if (activity.key.length === 1) {
            this.currentText += activity.key;
            this.currentSentence += activity.key;
        } 
        else if (activity.key === ' ') {
            this.currentText += ' ';
            this.currentSentence += ' ';
        }
        else if (activity.key === 'Enter' || activity.key === '.') {
            if (this.currentSentence.trim()) {
                this.saveSentence();
            }
        }
        else if (activity.key === 'Backspace') {
            this.currentText = this.currentText.slice(0, -1);
            this.currentSentence = this.currentSentence.slice(0, -1);
        }
    }

    saveSentence() {
        const sentence = {
            text: this.currentSentence.trim(),
            timestamp: new Date(),
            classification: this.determineSentenceClassification(),
            context: this.activities.slice(-1)[0]?.context || {}
        };
        
        this.sentences.push(sentence);
        this.currentSentence = '';
        return sentence;
    }

    determineSentenceClassification() {
        // Analyze for paste-like characteristics
        const words = this.currentSentence.split(' ');
        const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
        
        if (avgWordLength > 6 && words.length > 15) {
            return 'pasted';
        }
        
        return 'typed';
    }
}