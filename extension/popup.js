document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnSettings = document.getElementById('btn-settings');
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  const queueCount = document.getElementById('queue-count');
  const queryText = document.getElementById('current-query');

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
      queueCount.innerText = res.queue ? res.queue.length : 0;
      queryText.innerText = `Query ${res.state.currentQueryIndex + 1}/${res.queriesLength}`;
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
});
