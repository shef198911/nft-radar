document.addEventListener('DOMContentLoaded', () => {
  const workerUrlInput = document.getElementById('workerUrl');
  const clientKeyInput = document.getElementById('clientKey');
  const scanIntervalInput = document.getElementById('scanInterval');
  const maxScrollsInput = document.getElementById('maxScrolls');
  const saveBtn = document.getElementById('save');
  const msg = document.getElementById('msg');

  // Load existing settings
  chrome.storage.local.get(['settings'], (res) => {
    let settings = res.settings || {};
    workerUrlInput.value = settings.workerUrl || (typeof CONFIG !== 'undefined' ? CONFIG.workerUrl : '');
    clientKeyInput.value = settings.clientKey || (typeof CONFIG !== 'undefined' ? CONFIG.clientKey : '');
    scanIntervalInput.value = settings.scanInterval || 10;
    maxScrollsInput.value = settings.maxScrolls || 5;
  });

  saveBtn.addEventListener('click', () => {
    const settings = {
      workerUrl: workerUrlInput.value.trim(),
      clientKey: clientKeyInput.value.trim(),
      scanInterval: parseInt(scanIntervalInput.value, 10),
      maxScrolls: parseInt(maxScrollsInput.value, 10)
    };

    chrome.storage.local.set({ settings }, () => {
      chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
      msg.innerText = 'Settings saved successfully!';
      setTimeout(() => { msg.innerText = ''; }, 3000);
    });
  });
});
