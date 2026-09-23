import { fetchOpenSeaJson, getOpenSeaApiKey } from './opensea.js';

async function sendTelegramMessage(env, chatId, text) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    })
  });
}

export async function handleTelegramWebhook(request, env) {
  if (request.method !== 'POST') return new Response('OK');
  
  let update;
  try {
    update = await request.json();
  } catch (e) {
    return new Response('OK');
  }

  if (!update.message || !update.message.text) return new Response('OK');
  
  if (update.message.chat.type !== 'private') {
    return new Response('OK');
  }
  
  const chatId = update.message.chat.id.toString();
  const text = update.message.text.trim();
  const now = new Date().toISOString();

  // Get user state
  let user = await env.DB.prepare('SELECT state, state_data FROM telegram_users WHERE chat_id = ?').bind(chatId).first();
  if (!user) {
    user = { state: 'IDLE', state_data: null };
    await env.DB.prepare('INSERT INTO telegram_users (chat_id, state, updated_at) VALUES (?, ?, ?)').bind(chatId, 'IDLE', now).run();
  }

  if (text === '/cancel' || text === '/start') {
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
    await sendTelegramMessage(env, chatId, "Привет! Я бот NFT Radar.\n\nКоманды:\n/track - отслеживать цену коллекции на OpenSea\n/list - список отслеживаемых коллекций\n/untrack - перестать отслеживать");
    return new Response('OK');
  }

  if (text === '/list') {
    const { results } = await env.DB.prepare('SELECT collection_name, threshold_percent, baseline_price FROM price_alerts WHERE chat_id = ?').bind(chatId).all();
    if (!results || results.length === 0) {
      await sendTelegramMessage(env, chatId, "У вас нет отслеживаемых коллекций.");
    } else {
      let msg = "<b>Ваши коллекции:</b>\n\n";
      for (const row of results) {
        msg += `🔹 <b>${row.collection_name}</b>\nПорог: ${row.threshold_percent}%\nТекущая база: ${row.baseline_price || 'неизвестно'} ETH\n\n`;
      }
      await sendTelegramMessage(env, chatId, msg);
    }
    return new Response('OK');
  }

  if (text === '/untrack') {
    await env.DB.prepare('UPDATE telegram_users SET state = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_UNTRACK', now, chatId).run();
    await sendTelegramMessage(env, chatId, "Пришлите ссылку на коллекцию (или slug), которую хотите перестать отслеживать.");
    return new Response('OK');
  }

  if (user.state === 'WAITING_UNTRACK') {
    let slug = text;
    try {
      if (text.includes('opensea.io/collection/')) {
        const url = new URL(text);
        slug = url.pathname.split('collection/')[1].split('/')[0];
      }
    } catch(e) {}
    
    const result = await env.DB.prepare('DELETE FROM price_alerts WHERE chat_id = ? AND collection_slug = ?').bind(chatId, slug).run();
    if (result.meta.changes > 0) {
      await sendTelegramMessage(env, chatId, `✅ Коллекция <b>${slug}</b> удалена из отслеживания.`);
    } else {
      await sendTelegramMessage(env, chatId, `❌ Коллекция <b>${slug}</b> не найдена в вашем списке.`);
    }
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
    return new Response('OK');
  }

  if (text === '/track') {
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_LINK', null, now, chatId).run();
    await sendTelegramMessage(env, chatId, "Пришлите ссылку на коллекцию OpenSea (например: https://opensea.io/collection/jpeg-frens)");
    return new Response('OK');
  }

  if (user.state === 'WAITING_LINK') {
    let slug = text;
    try {
      if (text.includes('opensea.io/collection/')) {
        const url = new URL(text);
        slug = url.pathname.split('collection/')[1].split('/')[0];
      }
    } catch(e) {
      await sendTelegramMessage(env, chatId, "❌ Неверная ссылка. Пришлите ссылку на коллекцию или отправьте /cancel");
      return new Response('OK');
    }

    try {
      const apiKey = await getOpenSeaApiKey(env);
      const data = await fetchOpenSeaJson(`/collections/${slug}`, apiKey);
      const statsData = await fetchOpenSeaJson(`/collections/${slug}/stats`, apiKey);
      
      const name = data.name || slug;
      const floor = statsData.total?.floor_price || 0;
      
      const stateData = JSON.stringify({ slug, name, floor });
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_PERCENT', stateData, now, chatId).run();
      
      await sendTelegramMessage(env, chatId, `✅ Коллекция найдена: <b>${name}</b>\n\nТекущий Floor Price: <b>${floor} ETH</b>\n\nПри каком изменении цены (в процентах) присылать уведомление? Напишите число (например: 15)`);
    } catch (e) {
      console.error(e);
      await sendTelegramMessage(env, chatId, `❌ Ошибка при поиске коллекции <b>${slug}</b>. Проверьте ссылку или попробуйте позже.`);
      await env.DB.prepare('UPDATE telegram_users SET state = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', now, chatId).run();
    }
    return new Response('OK');
  }

  if (user.state === 'WAITING_PERCENT') {
    const percent = parseFloat(text.replace('%', '').replace(',', '.'));
    if (isNaN(percent) || percent <= 0) {
      await sendTelegramMessage(env, chatId, "❌ Пожалуйста, введите корректное число (например: 15 или 5.5)");
      return new Response('OK');
    }

    try {
      const data = JSON.parse(user.state_data);
      await env.DB.prepare(`
        INSERT OR REPLACE INTO price_alerts (chat_id, collection_slug, collection_name, baseline_price, threshold_percent, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(chatId, data.slug, data.name, data.floor, percent, now, now).run();
      
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
      
      await sendTelegramMessage(env, chatId, `🚀 Отлично! Теперь я отслеживаю <b>${data.name}</b>.\nЯ пришлю уведомление, если цена (${data.floor} ETH) изменится на <b>${percent}%</b> или больше.`);
    } catch (e) {
      console.error(e);
      await sendTelegramMessage(env, chatId, "❌ Произошла ошибка. Начните заново с команды /track");
      await env.DB.prepare('UPDATE telegram_users SET state = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', now, chatId).run();
    }
    return new Response('OK');
  }

  // Fallback
  await sendTelegramMessage(env, chatId, "Я вас не понял. Используйте команду /track для добавления коллекции.");
  return new Response('OK');
}

export async function checkPriceAlerts(env) {
  const { results: alerts } = await env.DB.prepare('SELECT * FROM price_alerts').all();
  if (!alerts || alerts.length === 0) return;

  const now = new Date().toISOString();
  let apiKey;
  try {
    apiKey = await getOpenSeaApiKey(env);
  } catch (e) {
    return;
  }

  // Process unique collections to minimize API calls
  const uniqueSlugs = [...new Set(alerts.map(a => a.collection_slug))];
  const currentPrices = {};

  for (const slug of uniqueSlugs) {
    try {
      const stats = await fetchOpenSeaJson(`/collections/${slug}/stats`, apiKey);
      if (stats.total && typeof stats.total.floor_price === 'number') {
         currentPrices[slug] = {
           floor: stats.total.floor_price,
           volume: stats.total.volume || 0,
           sales: stats.total.sales || 0
         };
      }
    } catch (e) {
      console.error(`Failed to fetch stats for ${slug}: ${e.message}`);
    }
  }

  for (const alert of alerts) {
    const stats = currentPrices[alert.collection_slug];
    if (!stats) continue;

    const currentFloor = stats.floor;
    const baseFloor = alert.baseline_price;
    
    // If we didn't have a baseline, set it now
    if (baseFloor === null || baseFloor === 0) {
      await env.DB.prepare('UPDATE price_alerts SET baseline_price = ?, updated_at = ? WHERE id = ?')
        .bind(currentFloor, now, alert.id).run();
      continue;
    }

    const diff = Math.abs(currentFloor - baseFloor);
    const percentChange = (diff / baseFloor) * 100;

    if (percentChange >= alert.threshold_percent) {
      const direction = currentFloor > baseFloor ? '📈 Выросла' : '📉 Упала';
      const msg = `🚨 <b>Алерт: ${alert.collection_name}</b>\n\nЦена ${direction} на <b>${percentChange.toFixed(1)}%</b>!\n\nСтарая цена: ${baseFloor} ETH\nНовая цена: <b>${currentFloor} ETH</b>\n\n📊 Объем: ${stats.volume.toFixed(2)} ETH\n🛒 Продажи: ${stats.sales}`;
      
      await sendTelegramMessage(env, alert.chat_id, msg);
      
      // Update baseline to the new price so it resets for the next jump
      await env.DB.prepare('UPDATE price_alerts SET baseline_price = ?, updated_at = ? WHERE id = ?')
        .bind(currentFloor, now, alert.id).run();
    }
  }
}
