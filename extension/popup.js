document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnSettings = document.getElementById('btn-settings');
  const btnResetStats = document.getElementById('btn-reset-stats');
  const btnToggleMoni = document.getElementById('btn-toggle-moni');
  const btnSaveMin = document.getElementById('btn-save-min');
  const moniMinInput = document.getElementById('moni-min-input');
  
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  const queueCount = document.getElementById('queue-count');
  const failedCount = document.getElementById('failed-count');
  const queryText = document.getElementById('current-query');

  // Initialize input value once on load
  chrome.storage.local.get(['settings'], (res) => {
     const s = res.settings || {};
     moniMinInput.value = s.moniFilterMinScore !== undefined ? s.moniFilterMinScore : 1000;
  });

  function refreshData() {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
      if (!res) return;
      if (res.state.isRunning) {
        statusText.innerText = 'RUNNING';
        statusDot.className = 'status-dot running';
      } else {
        statusText.innerText = 'STOPPED';
        statusDot.className = 'status-dot stopped';
      }
      queueCount.innerText = res.queue ? res.queue.filter(q => q.status !== 'failed').length : 0;
      failedCount.innerText = res.queue ? res.queue.filter(q => q.status === 'failed').length : 0;
      
      let currentQ = '-';
      if (res.state.currentQueryIndex !== undefined) {
          currentQ = `Index: ${res.state.currentQueryIndex + 1}/${res.queriesLength}`;
      }
      queryText.innerText = currentQ;
    });
    
    chrome.storage.local.get(['radarStats', 'settings'], (res) => {
       const stats = res.radarStats || { tweetsSeen: 0, localPassed: 0, moniChecked: 0, moniPassed: 0, rejected: 0, sent: 0 };
       document.getElementById('stats-seen').innerText = stats.tweetsSeen || 0;
       document.getElementById('stats-local').innerText = stats.localPassed || 0;
       document.getElementById('stats-moni').innerText = stats.moniChecked || 0;
       document.getElementById('stats-moni-passed').innerText = stats.moniPassed || 0;
       document.getElementById('stats-rejected').innerText = stats.rejected || 0;
       document.getElementById('stats-sent').innerText = stats.sent || 0;
       
       const s = res.settings || {};
       const moniEnabled = s.moniFilterEnabled !== false;
       document.getElementById('moni-status').innerText = moniEnabled ? 'ON' : 'OFF';
       document.getElementById('moni-status').style.color = moniEnabled ? 'green' : 'red';
       
       btnToggleMoni.innerText = moniEnabled ? 'Turn OFF' : 'Turn ON';
    });
  }

  refreshData();
  setInterval(refreshData, 1000);

  btnStart.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'START_SCANNER' });
    refreshData();
  });
  btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_SCANNER' });
    refreshData();
  });
  btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  btnResetStats.addEventListener('click', () => {
    chrome.storage.local.set({ 
       radarStats: { tweetsSeen: 0, localPassed: 0, moniChecked: 0, moniPassed: 0, rejected: 0, sent: 0 },
       queue: [] 
    });
    chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' });
    refreshData();
  });
  btnToggleMoni.addEventListener('click', () => {
    chrome.storage.local.get(['settings'], (res) => {
       let s = res.settings || {};
       s.moniFilterEnabled = s.moniFilterEnabled === false ? true : false;
       chrome.storage.local.set({ settings: s }, () => {
         chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: s });
         refreshData();
       });
    });
  });
  
  btnSaveMin.addEventListener('click', () => {
    const minVal = parseInt(moniMinInput.value, 10);
    if (isNaN(minVal)) return;
    chrome.storage.local.get(['settings'], (res) => {
       let s = res.settings || {};
       s.moniFilterMinScore = minVal;
       chrome.storage.local.set({ settings: s }, () => {
         chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: s });
         const saveStatus = document.getElementById('save-status');
         saveStatus.style.display = 'inline';
         setTimeout(() => { saveStatus.style.display = 'none'; }, 2000);
       });
    });
  });
});
