document.addEventListener('DOMContentLoaded', () => {
  const workerUrlInput = document.getElementById('workerUrl');
  const clientKeyInput = document.getElementById('clientKey');
  const scanIntervalInput = document.getElementById('scanInterval');
  const maxScrollsInput = document.getElementById('maxScrolls');
  
  const moniFilterEnabled = document.getElementById('moniFilterEnabled');
  const moniFilterMinScore = document.getElementById('moniFilterMinScore');
  const moniFilterIfUnavailable = document.getElementById('moniFilterIfUnavailable');
  
  const saveBtn = document.getElementById('save');
  const msg = document.getElementById('msg');

  // Load existing settings
  chrome.storage.local.get(['settings'], (res) => {
    let settings = res.settings || {};
    workerUrlInput.value = settings.workerUrl || (typeof CONFIG !== 'undefined' ? CONFIG.workerUrl : '');
    clientKeyInput.value = settings.clientKey || (typeof CONFIG !== 'undefined' ? CONFIG.clientKey : '');
    scanIntervalInput.value = settings.scanInterval || 10;
    maxScrollsInput.value = settings.maxScrolls || 5;
    
    moniFilterEnabled.checked = settings.moniFilterEnabled !== undefined ? settings.moniFilterEnabled : (typeof CONFIG !== 'undefined' ? CONFIG.moniFilterEnabled : true);
    moniFilterMinScore.value = settings.moniFilterMinScore !== undefined ? settings.moniFilterMinScore : (typeof CONFIG !== 'undefined' ? CONFIG.moniFilterMinScore : 1000);
    moniFilterIfUnavailable.value = settings.moniFilterIfUnavailable || (typeof CONFIG !== 'undefined' ? CONFIG.moniFilterIfUnavailable : 'allow');
  });

  saveBtn.addEventListener('click', () => {
    const settings = {
      workerUrl: workerUrlInput.value.trim(),
      clientKey: clientKeyInput.value.trim(),
      scanInterval: parseInt(scanIntervalInput.value, 10),
      maxScrolls: parseInt(maxScrollsInput.value, 10),
      moniFilterEnabled: moniFilterEnabled.checked,
      moniFilterMinScore: parseInt(moniFilterMinScore.value, 10) || 0,
      moniFilterIfUnavailable: moniFilterIfUnavailable.value
    };

    chrome.storage.local.set({ settings }, () => {
      chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
      msg.innerText = 'Settings saved successfully!';
      setTimeout(() => { msg.innerText = ''; }, 3000);
    });
  });
});
