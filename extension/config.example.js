const CONFIG = {
  workerUrl: 'https://your-worker.your-subdomain.workers.dev',
  clientKey: 'replace-with-your-client-key',
  moniFilterEnabled: true,
  moniFilterMinScore: 1000,
  moniFilterIfUnavailable: 'reject'
};

if (typeof window !== 'undefined') window.CONFIG = CONFIG;
