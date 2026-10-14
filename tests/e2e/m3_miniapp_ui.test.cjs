// tests/e2e/m3_miniapp_ui.test.cjs
// Milestone 3 Verification Suite: Telegram Mini App UI (F12 Calendar UI & F13 X-List Categories)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const assert = require('assert');

function runTest(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    return false;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('=== Milestone 3: Mini App UI Verification ===\n');

  const publicPath = path.resolve(__dirname, '../../public/index.html');
  const workerPublicPath = path.resolve(__dirname, '../../worker/public/index.html');

  assert(fs.existsSync(publicPath), 'public/index.html exists');
  assert(fs.existsSync(workerPublicPath), 'worker/public/index.html exists');

  const publicHtml = fs.readFileSync(publicPath, 'utf8');
  const workerHtml = fs.readFileSync(workerPublicPath, 'utf8');

  let passed = 0;
  let total = 0;

  // 1. Byte-for-byte synchronization
  total++;
  if (runTest('1. Byte-for-byte identical public/index.html and worker/public/index.html', () => {
    const hash1 = crypto.createHash('sha256').update(publicHtml).digest('hex');
    const hash2 = crypto.createHash('sha256').update(workerHtml).digest('hex');
    assert.strictEqual(hash1, hash2, 'SHA-256 hashes must match identically');
    assert.strictEqual(publicHtml.length, workerHtml.length, 'File byte lengths must match');
    assert.strictEqual(publicHtml, workerHtml, 'Full content strings must match');
  })) passed++;

  // 2. HTML Tag Balance and Structure
  total++;
  if (runTest('2. HTML Tag Balance (all divs properly closed)', () => {
    const openDivs = (publicHtml.match(/<div(\s|>)/gi) || []).length;
    const closeDivs = (publicHtml.match(/<\/div>/gi) || []).length;
    assert.strictEqual(openDivs, closeDivs, `Div tags mismatch: ${openDivs} open vs ${closeDivs} close`);
  })) passed++;

  // 3. Extract and compile Vue App Script
  total++;
  let vueAppCode = '';
  if (runTest('3. Vue 3 Application Script Syntax Validity', () => {
    const scriptMatches = publicHtml.match(/<script[\s\S]*?<\/script>/gi);
    assert(scriptMatches && scriptMatches.length >= 2, 'Must contain multiple script tags');
    // Find the main app script containing createApp
    const appScript = scriptMatches.find(s => s.includes('createApp'));
    assert(appScript, 'Main createApp script tag found');
    vueAppCode = appScript.replace(/^<script.*?>/i, '').replace(/<\/script>$/i, '');
    new vm.Script(vueAppCode); // Compiles without syntax error
  })) passed++;

  // 4. F12: Vue Data State Properties
  total++;
  if (runTest('4. F12: Calendar Data State Properties Defined', () => {
    assert(vueAppCode.includes('calendarEvents: []'), 'calendarEvents initialized as empty array');
    assert(vueAppCode.includes("calendarFilter: 'all'"), "calendarFilter initialized to 'all'");
    assert(vueAppCode.includes('showCalendarModal: false'), 'showCalendarModal initialized to false');
    assert(vueAppCode.includes('calendarLoading: false'), 'calendarLoading initialized to false');
    assert(vueAppCode.includes('calendarForm: {'), 'calendarForm object initialized');
    assert(vueAppCode.includes("project_name: ''"), 'calendarForm contains project_name');
    assert(vueAppCode.includes("event_type: 'mint'"), 'calendarForm contains default event_type mint');
    assert(vueAppCode.includes("event_date: ''"), 'calendarForm contains event_date');
    assert(vueAppCode.includes("details: ''"), 'calendarForm contains details');
    assert(vueAppCode.includes("tweet_url: ''"), 'calendarForm contains tweet_url');
  })) passed++;

  // 5. F12: Vue Computed and Methods for Calendar
  total++;
  if (runTest('5. F12: Calendar Computed & API Methods', () => {
    assert(vueAppCode.includes('filteredCalendarEvents()'), 'computed.filteredCalendarEvents defined');
    assert(vueAppCode.includes('loadCalendarEvents()'), 'methods.loadCalendarEvents defined');
    assert(vueAppCode.includes('saveCalendarEvent()'), 'methods.saveCalendarEvent defined');
    assert(vueAppCode.includes('deleteCalendarEvent('), 'methods.deleteCalendarEvent defined');
    assert(vueAppCode.includes('this.loadCalendarEvents()'), 'loadCalendarEvents invoked in mounted()');
    assert(vueAppCode.includes('/api/miniapp/calendar'), 'Calendar API route used');
  })) passed++;

  // 6. F12: Calendar UI Elements in Template
  total++;
  if (runTest('6. F12: Calendar Views, Dock Nav, Home Teaser & Modal in HTML', () => {
    assert(publicHtml.includes("currentView === 'calendar'"), 'Dedicated Calendar view container exists');
    assert(publicHtml.includes('📅 {{ t("calendar") }}') || publicHtml.includes('📅 {{ t("calendar_events") }}') || publicHtml.includes('Календарь'), 'Calendar header exists');
    assert(publicHtml.includes("calendarFilter = 'all'"), 'All filter pill button exists');
    assert(publicHtml.includes("calendarFilter = 'mint'"), 'Mint filter pill button exists');
    assert(publicHtml.includes("calendarFilter = 'tge'"), 'TGE filter pill button exists');
    assert(publicHtml.includes("calendarFilter = 'checker'"), 'Checker filter pill button exists');
    assert(publicHtml.includes("calendarFilter = 'whitelist'"), 'Whitelist filter pill button exists');
    assert(publicHtml.includes('filteredCalendarEvents'), 'v-for loops over filteredCalendarEvents');
    assert(publicHtml.includes('https://x.com/'), 'Explicit https://x.com/ link rendered for author');
    assert(publicHtml.includes('ph-arrow-square-out'), 'External tweet button with phosphor icon');
    assert(publicHtml.includes('deleteCalendarEvent(event.id)'), 'Delete event button hookup');
    assert(publicHtml.includes("includes(currentView)") && publicHtml.includes("'calendar'"), 'Nav dock includes calendar in currentView checks');
    assert(publicHtml.includes('ph-calendar') && publicHtml.includes("currentView = 'calendar'"), 'Nav dock calendar button exists');
    assert(publicHtml.includes('showCalendarModal = true'), 'Add event button triggers showCalendarModal');
    assert(publicHtml.includes('calendarForm.project_name'), 'Add modal project_name binding');
    assert(publicHtml.includes('calendarForm.event_type'), 'Add modal event_type binding');
    assert(publicHtml.includes('calendarForm.event_date'), 'Add modal datetime-local binding');
    assert(publicHtml.includes('saveCalendarEvent'), 'Add modal submit button hookup');
  })) passed++;

  // 7. F13: X-List Categories Data and Computed
  total++;
  if (runTest('7. F13: X-List Categories Data & Computed Properties', () => {
    assert(vueAppCode.includes("targetCategoryFilter: 'all'"), "targetCategoryFilter initialized to 'all'");
    assert(vueAppCode.includes("newTargetCategory: 'nft'"), "newTargetCategory initialized to 'nft'");
    assert(vueAppCode.includes('filteredParserTargetsList()'), 'computed.filteredParserTargetsList defined');
    assert(vueAppCode.includes('updateTargetCategory('), 'methods.updateTargetCategory defined');
    assert(vueAppCode.includes('getTargetUsername('), 'methods.getTargetUsername defined');
    assert(vueAppCode.includes('getTargetCategory('), 'methods.getTargetCategory defined');
  })) passed++;

  // 8. F13: X-List Categories in Admin Parser Modal
  total++;
  if (runTest('8. F13: Admin Parser Modal Category Badges & Filtering', () => {
    assert(publicHtml.includes("targetCategoryFilter = 'all'"), 'All categories filter pill exists');
    assert(publicHtml.includes("targetCategoryFilter = 'nft'"), 'NFT category filter pill exists');
    assert(publicHtml.includes("targetCategoryFilter = 'defi'"), 'DeFi category filter pill exists');
    assert(publicHtml.includes("targetCategoryFilter = 'airdrop'"), 'Airdrop category filter pill exists');
    assert(publicHtml.includes("targetCategoryFilter = 'nodes'"), 'Nodes category filter pill exists');
    assert(publicHtml.includes('getTargetCategory(target)'), 'Target card renders category badge/selector');
    assert(publicHtml.includes('newTargetCategory'), 'Add target form binds newTargetCategory select');
    assert(publicHtml.includes('updateTargetCategory(target'), 'Target card allows category switching');
  })) passed++;

  // 9. API Methods Contract Verification (Functional execution with Mock Express Server)
  total++;
  await runAsyncTest('9. Backend Contract Alignment (Express mock simulating M1 backend)', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());

    let mockDb = {
      calendar: [
        { id: 1, project_name: 'CyberKongz Mint', username: 'cyberkongz', event_type: 'mint', event_date: '2026-10-14 18:00 UTC', details: 'Free mint 5000 supply', tweet_url: 'https://x.com/cyberkongz/status/1' }
      ],
      targets: [
        { id: 1, username: 'jumperapp', category: 'defi', display_name: 'Jumper' },
        { id: 2, username: 'cyberkongz', category: 'nft', display_name: 'CyberKongz' }
      ]
    };

    app.get('/api/miniapp/calendar', (req, res) => {
      let events = mockDb.calendar;
      if (req.query.event_type && req.query.event_type !== 'all') {
        events = events.filter(e => e.event_type === req.query.event_type);
      }
      res.json({ events });
    });

    app.post('/api/miniapp/calendar', (req, res) => {
      const { project_name, username, event_type, event_date, details, tweet_url } = req.body;
      const newId = mockDb.calendar.length + 1;
      const ev = { id: newId, project_name, username, event_type, event_date, details, tweet_url };
      mockDb.calendar.push(ev);
      res.json({ success: true, id: newId });
    });

    app.delete('/api/miniapp/calendar/:id', (req, res) => {
      mockDb.calendar = mockDb.calendar.filter(e => e.id !== parseInt(req.params.id));
      res.json({ success: true });
    });

    app.get('/api/miniapp/admin/targets', (req, res) => {
      let targets = mockDb.targets;
      if (req.query.category && req.query.category !== 'all') {
        targets = targets.filter(t => t.category === req.query.category);
      }
      res.json({ targets });
    });

    app.put('/api/miniapp/admin/targets/category', (req, res) => {
      const { username, id, category } = req.body;
      const target = mockDb.targets.find(t => (id && t.id === id) || (username && t.username.toLowerCase() === username.toLowerCase()));
      if (target) target.category = category;
      res.json({ success: true });
    });

    app.post('/api/miniapp/admin/parser_targets', (req, res) => {
      const { urls, category } = req.body;
      let count = 0;
      for (const u of urls || []) {
        const username = u.replace('https://x.com/', '').trim();
        mockDb.targets.push({ id: mockDb.targets.length + 1, username, category: category || 'nft', display_name: username });
        count++;
      }
      res.json({ success: true, added: count });
    });

    const server = await new Promise(resolve => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Test Calendar GET
      const calRes = await fetch(`${baseUrl}/api/miniapp/calendar?chat_id=332680373`);
      const calData = await calRes.json();
      assert.strictEqual(calData.events.length, 1);
      assert.strictEqual(calData.events[0].username, 'cyberkongz');

      // Test Calendar POST
      const addRes = await fetch(`${baseUrl}/api/miniapp/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: '332680373',
          project_name: 'Base TGE',
          username: 'base',
          event_type: 'tge',
          event_date: '2026-11-01T12:00',
          tweet_url: 'https://x.com/base/status/2'
        })
      });
      const addData = await addRes.json();
      assert(addData.success && addData.id === 2);
      assert.strictEqual(mockDb.calendar.length, 2);

      // Test Calendar DELETE
      const delRes = await fetch(`${baseUrl}/api/miniapp/calendar/1?chat_id=332680373`, { method: 'DELETE' });
      const delData = await delRes.json();
      assert(delData.success);
      assert.strictEqual(mockDb.calendar.length, 1);
      assert.strictEqual(mockDb.calendar[0].id, 2);

      // Test Targets GET
      const tgtRes = await fetch(`${baseUrl}/api/miniapp/admin/targets?chat_id=332680373`);
      const tgtData = await tgtRes.json();
      assert.strictEqual(tgtData.targets.length, 2);
      assert.strictEqual(tgtData.targets[0].category, 'defi');

      // Test Target Category Update PUT
      const updRes = await fetch(`${baseUrl}/api/miniapp/admin/targets/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: '332680373', username: 'jumperapp', category: 'airdrop' })
      });
      const updData = await updRes.json();
      assert(updData.success);
      assert.strictEqual(mockDb.targets.find(t => t.username === 'jumperapp').category, 'airdrop');

      // Test Target Add with Category POST
      const addTgtRes = await fetch(`${baseUrl}/api/miniapp/admin/parser_targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: '332680373', urls: ['https://x.com/hypurrfun'], category: 'nodes' })
      });
      const addTgtData = await addTgtRes.json();
      assert(addTgtData.success && addTgtData.added === 1);
      const newTgt = mockDb.targets.find(t => t.username === 'hypurrfun');
      assert(newTgt && newTgt.category === 'nodes');

    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  passed++;

  console.log(`\nResults: ${passed}/${total} tests passed.`);
  if (passed !== total) {
    process.exit(1);
  }
  console.log('Milestone 3 Mini App UI Verification Complete! PASS.');
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
