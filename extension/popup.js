document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnSettings = document.getElementById('btn-settings');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const queueCount = document.getElementById('queue-count');

  function updateUI(isRunning) {
    if (isRunning) {
      statusDot.className = 'status-dot running';
      statusText.innerText = 'Running';
    } else {
      statusDot.className = 'status-dot stopped';
      statusText.innerText = 'Stopped';
    }
  }

  function refreshData() {
    chrome.storage.local.get(['isRunning', 'queue'], (res) => {
      updateUI(res.isRunning);
      if (res.queue) {
        queueCount.innerText = res.queue.length;
      }
    });
  }

  refreshData();
  setInterval(refreshData, 1000);

  btnStart.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'START_SCANNER' });
    updateUI(true);
  });

  btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_SCANNER' });
    updateUI(false);
  });

  btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
