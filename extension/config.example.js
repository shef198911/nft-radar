const CONFIG = {
  workerUrl: 'https://your-worker.your-subdomain.workers.dev',
  clientKey: 'replace-with-your-client-key',
  pageRefreshInterval: 15,
  moniFilterEnabled: true,
  moniFilterMinScore: 1000,
  minFollowers: 0,
  moniFilterIfUnavailable: 'reject'
};

if (typeof window !== 'undefined') window.CONFIG = CONFIG;
