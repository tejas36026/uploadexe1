// dashboard_renderer.js
window.electronAPI.onUpdateDashboard((_event, sentences) => {
    
    // --- 1. Render the Analyzed Text Sample ---
    const textSampleDiv = document.getElementById('text-sample');
    textSampleDiv.innerHTML = ''; // Clear previous content
    sentences.forEach(s => {
        const span = document.createElement('span');
        span.textContent = s.text + ' ';
        span.className = s.classification; // This applies the red/green/yellow style
        textSampleDiv.appendChild(span);
    });

    // --- 2. Render the Bar Chart ---
    const ctx = document.getElementById('summaryChart').getContext('2d');
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sentences.map((s, i) => `S${sentences.length - i}`), // Labels like S1, S2...
            datasets: [
                {
                    label: 'WPM',
                    data: sentences.map(s => s.metrics.wpm),
                    backgroundColor: '#3498db' // Blue
                },
                {
                    label: 'Pasted Chars',
                    data: sentences.map(s => s.metrics.pastedChars),
                    backgroundColor: '#e74c3c' // Red
                },
                {
                    label: 'Deletes',
                    data: sentences.map(s => s.metrics.deletes),
                    backgroundColor: '#f1c40f' // Yellow
                }
            ]
        },
        options: {
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
});