/**
 * Verification Test Suite for Radar MV3 Keep-Alive, Storage Synchronization, and Watchdog Recovery
 */

const path = require('path');
const fs = require('fs');
const { TestHarness, assert } = require('./helpers/test_harness.cjs');

const rootDir = path.resolve(__dirname, '../..');
const extDir = path.join(rootDir, 'extension');

async function runTests() {
  const harness = new TestHarness('Radar Keep-Alive & Wake Synchronization');

  // Test 1: Service Worker SCROLL_DONE race condition fix
  await harness.test('SW-01: SCROLL_DONE waits for storageReady when waking from suspended state', async () => {
    let storageGetCb = null;
    let onMessageListener = null;
    let alarmClears = [];
    let stateSaves = [];

    global.importScripts = () => {};
    global.CONFIG = { workerUrl: 'http://127.0.0.1:9999', clientKey: 'KEY' };
    global.SEARCH_GROUPS = ['query1', 'query2'];

    global.chrome = {
      runtime: {
        onMessage: {
          addListener: (fn) => { onMessageListener = fn; }
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: (keys, cb) => {
            // Keep storage resolution pending to simulate async wake
            storageGetCb = cb;
          },
          set: (obj) => {
            stateSaves.push(obj);
            return Promise.resolve();
          }
        }
      },
      alarms: {
        create: () => {},
        clear: (name) => { alarmClears.push(name); },
        onAlarm: { addListener: () => {} }
      },
      tabs: {
        get: (id, cb) => cb({ id }),
        sendMessage: () => Promise.resolve()
      }
    };

    const swCode = fs.readFileSync(path.join(extDir, 'service-worker.js'), 'utf8');
    eval(swCode);

    assert.ok(typeof onMessageListener === 'function', 'Listener registered');

    // Simulate SCROLL_DONE arriving BEFORE storage has resolved (Service Worker just woke up)
    const activeGen = 123456789;
    onMessageListener({ type: 'SCROLL_DONE', generation: activeGen }, {}, () => {});

    // At this point, storageReady has NOT resolved
    // Now resolve storage with active running state
    assert.ok(storageGetCb, 'Storage get callback must be captured');
    storageGetCb({
      state: {
        isRunning: true,
        scannerGeneration: activeGen,
        activeScrollGeneration: activeGen,
        currentQueryIndex: 0
      },
      settings: {}
    });

    // Allow promise microtasks to flush
    await new Promise(r => setTimeout(r, 60));

    // Verify state via GET_STATE
    let endState = null;
    onMessageListener({ type: 'GET_STATE' }, {}, (resp) => {
      endState = resp.state;
    });
    await new Promise(r => setTimeout(r, 20));

    assert.ok(endState, 'GET_STATE must return updated state');
    assert.strictEqual(endState.activeScrollGeneration, null, 'Active scroll generation must be cleared on completion');
    assert.strictEqual(endState.currentQueryIndex, 1, 'Current query index must advance to 1');
    assert.ok(alarmClears.includes('radar-scroll-watchdog'), 'Watchdog alarm must be cleared');
  });

  // Test 2: CHECK_NEW_TWEETS_PROXY and START_OBSERVER_PROXY wait for storageReady
  await harness.test('SW-02: Proxy messages wait for storageReady and resolve to scannerTabId', async () => {
    let storageGetCb = null;
    let onMessageListener = null;
    let sentToTabMessages = [];

    global.chrome = {
      runtime: {
        onMessage: {
          addListener: (fn) => { onMessageListener = fn; }
        },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: (keys, cb) => { storageGetCb = cb; },
          set: () => Promise.resolve()
        }
      },
      alarms: {
        create: () => {},
        clear: () => {},
        onAlarm: { addListener: () => {} }
      },
      tabs: {
        get: (id, cb) => cb({ id }),
        sendMessage: (tabId, msg, cb) => {
          sentToTabMessages.push({ tabId, msg });
          if (cb) cb({ newCount: 5 });
          return Promise.resolve();
        }
      }
    };

    const swCode = fs.readFileSync(path.join(extDir, 'service-worker.js'), 'utf8');
    eval(swCode);

    let proxyResponse = null;
    // Dispatch CHECK_NEW_TWEETS_PROXY while storage is pending
    const keptChannelOpen = onMessageListener({ type: 'CHECK_NEW_TWEETS_PROXY' }, { tab: { id: 777 } }, (resp) => {
      proxyResponse = resp;
    });

    assert.strictEqual(keptChannelOpen, true, 'Channel must stay open for async response');

    // Dispatch START_OBSERVER_PROXY while storage is pending
    onMessageListener({ type: 'START_OBSERVER_PROXY', isXList: true }, { tab: { id: 777 } });

    // Now resolve storage
    storageGetCb({
      state: {
        isRunning: true,
        scannerTabId: 777
      }
    });

    await new Promise(r => setTimeout(r, 60));

    assert.ok(proxyResponse, 'CHECK_NEW_TWEETS_PROXY must respond');
    assert.strictEqual(proxyResponse.newCount, 5);
    const observerMsg = sentToTabMessages.find(m => m.msg.type === 'START_OBSERVER');
    assert.ok(observerMsg, 'START_OBSERVER must be forwarded to tab');
    assert.strictEqual(observerMsg.tabId, 777);
  });

  // Test 3: Keep-Alive port connection and ping/pong heartbeat
  await harness.test('SW-03: radar-keepalive port accepts connections and responds to ping with pong', async () => {
    let onConnectListener = null;

    global.chrome = {
      runtime: {
        onConnect: {
          addListener: (fn) => { onConnectListener = fn; }
        },
        onMessage: { addListener: () => {} },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: (keys, cb) => cb({}),
          set: () => Promise.resolve()
        }
      },
      alarms: {
        create: () => {},
        clear: () => {},
        onAlarm: { addListener: () => {} }
      },
      tabs: {
        get: (id, cb) => cb({ id })
      }
    };

    const swCode = fs.readFileSync(path.join(extDir, 'service-worker.js'), 'utf8');
    eval(swCode);

    assert.ok(typeof onConnectListener === 'function', 'onConnect listener must be registered');

    let postMessages = [];
    let portMessageListener = null;
    let disconnectListener = null;

    const mockPort = {
      name: 'radar-keepalive',
      postMessage: (m) => { postMessages.push(m); },
      onMessage: {
        addListener: (fn) => { portMessageListener = fn; }
      },
      onDisconnect: {
        addListener: (fn) => { disconnectListener = fn; }
      }
    };

    onConnectListener(mockPort);

    // Send ping
    portMessageListener({ type: 'ping', timestamp: 1000 });
    assert.strictEqual(postMessages.length, 1);
    assert.strictEqual(postMessages[0].type, 'pong');

    // Disconnect
    disconnectListener();
  });

  // Test 4: Health check auto-recovers hung query
  await harness.test('SW-04: runHealthCheck recovers if active scroll hangs past max allowed timeout', async () => {
    let alarmsCreated = {};
    let stateSaves = [];
    let sentToTab = [];
    let onMessageListener = null;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { onMessageListener = fn; } },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: (keys, cb) => cb({
            state: {
              isRunning: true,
              scannerGeneration: 111,
              activeScrollGeneration: 111,
              scrollStartedAt: Date.now() - 300000, // Started 5 mins ago
              scrollTimeoutMs: 120000, // Max allowed was 2 mins
              scannerTabId: 555,
              currentQueryIndex: 0
            }
          }),
          set: (s) => { stateSaves.push(s); return Promise.resolve(); }
        }
      },
      alarms: {
        create: (name, cfg) => { alarmsCreated[name] = cfg; },
        clear: () => {},
        onAlarm: { addListener: () => {} }
      },
      tabs: {
        get: (id, cb) => cb({ id }),
        sendMessage: (id, msg) => { sentToTab.push({ id, msg }); return Promise.resolve(); }
      }
    };

    const swCode = fs.readFileSync(path.join(extDir, 'service-worker.js'), 'utf8');
    eval(swCode);

    await new Promise(r => setTimeout(r, 60));

    // Run health check
    runHealthCheck();

    let checkState = null;
    onMessageListener({ type: 'GET_STATE' }, {}, (resp) => { checkState = resp.state; });
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(checkState.activeScrollGeneration, null, 'Active scroll must be terminated');
    assert.strictEqual(checkState.currentQueryIndex, 1, 'Must have advanced to query index 1');
    const stopMsg = sentToTab.find(t => t.msg.type === 'STOP_SCROLL');
    assert.ok(stopMsg, 'STOP_SCROLL must be dispatched to scanner tab');
  });

  // Test 5: resumeScannerAfterWake detects expired scroll on wake
  await harness.test('SW-05: resumeScannerAfterWake detects scroll that expired while worker was suspended', async () => {
    let onMessageListener = null;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { onMessageListener = fn; } },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: (keys, cb) => cb({
            state: {
              isRunning: true,
              scannerGeneration: 999,
              activeScrollGeneration: 999,
              scrollStartedAt: Date.now() - 400000, // 400s ago
              scrollTimeoutMs: 180000, // 180s limit
              scannerTabId: 888,
              currentQueryIndex: 2
            }
          }),
          set: () => Promise.resolve()
        }
      },
      alarms: {
        create: () => {},
        clear: () => {},
        onAlarm: { addListener: () => {} }
      },
      tabs: {
        get: (id, cb) => cb({ id }),
        sendMessage: () => Promise.resolve()
      }
    };

    const swCode = fs.readFileSync(path.join(extDir, 'service-worker.js'), 'utf8');
    eval(swCode);

    await new Promise(r => setTimeout(r, 60));

    // resumeScannerAfterWake runs on wake when isRunning is true
    resumeScannerAfterWake();

    let checkState = null;
    onMessageListener({ type: 'GET_STATE' }, {}, (resp) => { checkState = resp.state; });
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(checkState.activeScrollGeneration, null, 'Active scroll must be cleaned up immediately');
    assert.strictEqual(checkState.currentQueryIndex, 3, 'Must advance to next query index');
  });

  // Test 6: search-controller.js keep-alive and ping/scroll handlers
  await harness.test('SC-01: search-controller manages radar-keepalive port and handles messages', async () => {
    let connectCalledWithName = null;
    let postMessages = [];
    let messageListener = null;
    let disconnectCalled = false;

    global.window = {};
    global.document = { body: { scrollHeight: 2000 } };
    global.chrome = {
      runtime: {
        connect: (opts) => {
          connectCalledWithName = opts.name;
          return {
            onMessage: { addListener: () => {} },
            onDisconnect: { addListener: () => {} },
            postMessage: (m) => postMessages.push(m),
            disconnect: () => { disconnectCalled = true; }
          };
        },
        sendMessage: () => Promise.resolve(),
        onMessage: {
          addListener: (fn) => { messageListener = fn; }
        }
      }
    };

    const scCode = fs.readFileSync(path.join(extDir, 'search-controller.js'), 'utf8');
    eval(scCode);

    assert.ok(typeof messageListener === 'function', 'Message listener must be registered in search-controller');

    // Trigger START_KEEPALIVE
    messageListener({ type: 'START_KEEPALIVE' });
    assert.strictEqual(connectCalledWithName, 'radar-keepalive', 'Port name must be radar-keepalive');
    assert.ok(postMessages.some(m => m.type === 'ping'), 'Initial ping must be sent');

    // Test PING_SCROLL
    let pingResp = null;
    messageListener({ type: 'PING_SCROLL' }, {}, (r) => { pingResp = r; });
    assert.ok(pingResp, 'PING_SCROLL must respond');
    assert.strictEqual(pingResp.isRunning, false);

    // Test STOP_KEEPALIVE
    messageListener({ type: 'STOP_KEEPALIVE' });
    assert.strictEqual(disconnectCalled, true, 'Port disconnect must be called on STOP_KEEPALIVE');
  });

  // Test 7: Health check probes active scroll via PING_SCROLL and recovers when tab finished but dropped SCROLL_DONE
  await harness.test('SW-06: runHealthCheck probes active scroll via PING_SCROLL and recovers when scroll finished', async () => {
    let onMessageListener = null;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { onMessageListener = fn; } },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: (keys, cb) => cb({
            state: {
              isRunning: true,
              scannerGeneration: 777,
              activeScrollGeneration: 777,
              scrollStartedAt: Date.now() - 35000, // 35s ago (> 30s probe threshold)
              scrollTimeoutMs: 300000, // 5 min timeout not reached yet
              scannerTabId: 444,
              currentQueryIndex: 0
            }
          }),
          set: () => Promise.resolve()
        }
      },
      alarms: {
        create: () => {},
        clear: () => {},
        onAlarm: { addListener: () => {} }
      },
      tabs: {
        get: (id, cb) => cb({ id }),
        sendMessage: (id, msg, cb) => {
          if (msg.type === 'PING_SCROLL') {
            // Tab is alive, but scroll already finished (isRunning: false)
            if (cb) cb({ isRunning: false, currentGeneration: 777, scrolls: 5, maxScrolls: 5 });
          }
          return Promise.resolve();
        }
      }
    };

    const swCode = fs.readFileSync(path.join(extDir, 'service-worker.js'), 'utf8');
    eval(swCode);

    await new Promise(r => setTimeout(r, 60));

    // Execute runHealthCheck()
    runHealthCheck();

    // Allow promise microtasks to flush
    await new Promise(r => setTimeout(r, 40));

    let checkState = null;
    onMessageListener({ type: 'GET_STATE' }, {}, (resp) => { checkState = resp.state; });
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(checkState.activeScrollGeneration, null, 'Active scroll must be completed by probe');
    assert.strictEqual(checkState.currentQueryIndex, 1, 'Query index must advance to 1');
  });

  // Test 8: IS_SCANNER_TAB responds with activeScrollTask and search-controller triggers scroll
  await harness.test('SW-07: IS_SCANNER_TAB provides activeScrollTask to initializing scanner tab', async () => {
    let onMessageListener = null;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { onMessageListener = fn; } },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: (keys, cb) => cb({
            state: {
              isRunning: true,
              scannerGeneration: 888,
              activeScrollGeneration: 888,
              scannerTabId: 101,
              pendingScrollTask: {
                generation: 888,
                maxScrolls: 7,
                isXList: true,
                isParserTarget: false
              }
            }
          }),
          set: () => Promise.resolve()
        }
      },
      alarms: { create: () => {}, clear: () => {}, onAlarm: { addListener: () => {} } },
      tabs: { get: (id, cb) => cb({ id }) }
    };

    const swCode = fs.readFileSync(path.join(extDir, 'service-worker.js'), 'utf8');
    eval(swCode);

    await new Promise(r => setTimeout(r, 60));

    let tabResponse = null;
    onMessageListener({ type: 'IS_SCANNER_TAB' }, { tab: { id: 101 } }, (resp) => {
      tabResponse = resp;
    });

    await new Promise(r => setTimeout(r, 30));

    assert.ok(tabResponse, 'Must respond to IS_SCANNER_TAB');
    assert.strictEqual(tabResponse.isScannerTab, true);
    assert.strictEqual(tabResponse.isRunning, true);
    assert.ok(tabResponse.activeScrollTask, 'activeScrollTask must be provided');
    assert.strictEqual(tabResponse.activeScrollTask.generation, 888);
    assert.strictEqual(tabResponse.activeScrollTask.maxScrolls, 7);
  });

  // Test 9: executeNextQuery and runScheduledQuery concurrency guard
  await harness.test('SW-08: Concurrency guards prevent duplicate execution while activeScroll is set', async () => {
    let navCount = 0;

    global.chrome = {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: (keys, cb) => cb({
            state: {
              isRunning: true,
              scannerGeneration: 999,
              activeScrollGeneration: 999, // Active scroll already running
              currentQueryIndex: 0
            }
          }),
          set: () => Promise.resolve()
        }
      },
      alarms: { create: () => {}, clear: () => {}, onAlarm: { addListener: () => {} } },
      tabs: {
        get: (id, cb) => cb({ id }),
        sendMessage: () => Promise.resolve(),
        create: (opts, cb) => { navCount++; cb({ id: 1 }); }
      }
    };

    const swCode = fs.readFileSync(path.join(extDir, 'service-worker.js'), 'utf8');
    eval(swCode);

    await new Promise(r => setTimeout(r, 60));

    // Try executing while active scroll is in progress
    runScheduledQuery();
    executeNextQuery(999, false);

    await new Promise(r => setTimeout(r, 30));

    assert.strictEqual(navCount, 0, 'No navigation must be triggered when active scroll is running');
  });

  const summary = harness.summary();
  if (!summary.allPassed) {
    console.error(`\nFAILED: ${summary.fails} / ${summary.total} tests failed.`);
    process.exit(1);
  } else {
    console.log(`\nSUCCESS: All ${summary.passes} / ${summary.total} tests passed flawlessly.`);
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
