function escapeHTML(str) {
  if (!str) return '';
  return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

function formatAuthor(data) {
  if (!data.username) return null;

  const username = String(data.username).replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return null;

  const displayName = data.display_name && data.display_name !== username
    ? `${data.display_name} (@${username})`
    : `@${username}`;

  return {
    label: displayName,
    url: `https://x.com/${username}`
  };
}

export function formatTelegramMessage(data, lang = 'en') {
  const isRu = lang === 'ru';
  let emoji = '🚨';
  if (data.priority === 'HOT') emoji = '🔥';
  else if (data.priority === 'HIGH') emoji = '🚨';
  else if (data.priority === 'NORMAL') emoji = '👀';
  
  const categoryTag = data.category ? ` #${escapeHTML(data.category.toUpperCase())}` : '';

  // ==========================================
  // 1. X-LIST ALPHA LAYER FORMATTING
  // ==========================================
  if (data.is_x_list) {
    const hasCustomCategory = data.category && data.category.toLowerCase() !== 'nft' && data.category.toLowerCase() !== 'general';
    const catTag = hasCustomCategory ? ` #${escapeHTML(data.category.toUpperCase())}` : '';
    const headerTitle = 'X Alpha';
    let header = `<b>${emoji} ${headerTitle}${catTag}</b>`;
    if (data.chain && data.chain !== 'Unknown') {
      let chainEmoji = '🔗';
      if (data.chain === 'Robinhood Chain') chainEmoji = '🦊';
      else if (data.chain === 'Solana') chainEmoji = '🟣';
      else if (data.chain === 'Ethereum') chainEmoji = '🔷';
      else if (data.chain === 'Base') chainEmoji = '🔵';
      else if (data.chain === 'Arbitrum') chainEmoji = '💙';
      else if (data.chain === 'Polygon') chainEmoji = '💜';
      else if (data.chain === 'BNB Chain') chainEmoji = '🟡';
      else if (data.chain === 'Avalanche') chainEmoji = '🔺';
      header += ` | <b>${chainEmoji} ${escapeHTML(data.chain.toUpperCase())}</b>`;
    }

    let msg = `${header}\n\n`;

    const author = formatAuthor(data);
    if (author) {
      msg += `👤 <b>${isRu ? 'Автор' : 'Author'}:</b> <a href="${escapeHTML(author.url)}">${escapeHTML(author.label)}</a>\n`;
    }

    if (data.project_name && data.project_name !== data.username) {
      msg += `🚀 <b>${isRu ? 'Проект' : 'Project'}:</b> ${escapeHTML(data.project_name)}\n`;
    }

    // Only display Category if genuine, non-empty, and not a false "WHITELIST" without actual forms
    const oppType = (data.opportunity_type || '').toUpperCase();
    if (oppType && oppType !== 'UNKNOWN' && (oppType !== 'WHITELIST' || data.whitelist_form_url || data.form_link)) {
      msg += `🧠 <b>${isRu ? 'Категория' : 'Category'}:</b> ${escapeHTML(oppType)}\n`;
    }

    // Whitelist / Form link (Premint, Alphabot, etc.) if genuinely present
    if (data.whitelist_form_url || data.form_link) {
      const formUrl = data.whitelist_form_url || data.form_link;
      const platRu = data.form_platform ? (data.form_platform === 'premint' ? 'Premint' : data.form_platform === 'alphabot' ? 'Alphabot' : data.form_platform === 'heymint' ? 'HeyMint' : data.form_platform === 'google_forms' ? 'Google Форма' : data.form_platform) : 'Вайтлист';
      const platEn = data.form_platform ? (data.form_platform === 'premint' ? 'Premint' : data.form_platform === 'alphabot' ? 'Alphabot' : data.form_platform === 'heymint' ? 'HeyMint' : data.form_platform === 'google_forms' ? 'Google Form' : data.form_platform) : 'Whitelist';
      const formLabel = isRu ? `Форма (${platRu})` : `Form (${platEn})`;
      msg += `📝 <b>${formLabel}:</b> <a href="${escapeHTML(formUrl)}">${escapeHTML(formUrl)}</a>\n`;
    }

    msg += `🤖 <b>AI Score:</b> ${data.score}/100\n\n`;

    if (isRu) {
      const textRu = data.text_ru || data.translated_text || data.text;
      if (textRu && typeof textRu === 'string') {
        msg += `${escapeHTML(textRu.trim())}\n\n`;
      }
    } else {
      let textEn = (data.text_en || '').trim();
      if (!textEn && data.text && typeof data.text === 'string' && !/[а-яА-ЯёЁ]/.test(data.text)) {
        textEn = data.text.trim();
      }
      if (textEn && !/[а-яА-ЯёЁ]/.test(textEn)) {
        msg += `${escapeHTML(textEn)}\n\n`;
      }
    }

    // For X-List, we do NOT include 'Price', 'Supply', 'WL spots', 'Mint', or 'Tags'.
    // And NO redundant '👉 Open Tweet' in text body (the inline keyboard button handles it cleanly).
    return msg;
  }

  // ==========================================
  // 2. NFT SEARCH LAYER FORMATTING (ПОИСКОВИК NFT)
  // ==========================================
  const headerTitle = isRu ? 'NFT ВОЗМОЖНОСТЬ (NFT OPPORTUNITY)' : 'NFT OPPORTUNITY';
  let header = `<b>${emoji} ${headerTitle}${categoryTag}</b>`;
  if (data.chain && data.chain !== 'Unknown') {
    let chainEmoji = '🔗';
    if (data.chain === 'Robinhood Chain') chainEmoji = '🦊';
    else if (data.chain === 'Solana') chainEmoji = '🟣';
    else if (data.chain === 'Ethereum') chainEmoji = '🔷';
    else if (data.chain === 'Base') chainEmoji = '🔵';
    else if (data.chain === 'Arbitrum') chainEmoji = '💙';
    else if (data.chain === 'Polygon') chainEmoji = '💜';
    else if (data.chain === 'BNB Chain') chainEmoji = '🟡';
    else if (data.chain === 'Avalanche') chainEmoji = '🔺';
    header += ` | <b>${chainEmoji} ${escapeHTML(data.chain.toUpperCase())}</b>`;
  }
  
  let msg = `${header}\n\n`;
  
  if (data.project_name) {
    msg += `🚀 <b>${isRu ? 'Проект' : 'Project'}:</b> ${escapeHTML(data.project_name)}\n`;
  } else if (data.display_name) {
    msg += `🚀 <b>${isRu ? 'Источник' : 'Source'}:</b> ${escapeHTML(data.display_name)}\n`;
  }

  const author = formatAuthor(data);
  if (author) {
    msg += `👤 <b>${isRu ? 'Автор' : 'Author'}:</b> <a href="${escapeHTML(author.url)}">${escapeHTML(author.label)}</a>\n`;
  }
  
  const types = [];
  if (data.is_free) types.push(isRu ? 'Free Минт' : 'Free Mint');
  if (data.is_free_whitelist) types.push(isRu ? 'Бесплатный WL' : 'Whitelist Free');
  if (data.is_wl_giveaway) types.push('WL Giveaway');
  else if (data.is_wl_raffle) types.push('WL Raffle');
  else if ((data.is_whitelist || data.is_allowlist) && !data.is_free_whitelist) types.push('Whitelist');
  if (data.is_fcfs) types.push('FCFS');
  if (data.is_gtd) types.push('GTD');
  
  if (types.length > 0) {
    msg += `🎯 <b>${isRu ? 'Теги' : 'Tags'}:</b> ${types.join(' + ')}\n`;
  } else if (data.opportunity_type && data.opportunity_type !== 'UNKNOWN') {
    msg += `🎯 <b>${isRu ? 'Тип' : 'Type'}:</b> ${escapeHTML(data.opportunity_type)}\n`;
  }
  
  if (data.wl_spots) {
    msg += `🎁 <b>${isRu ? 'WL мест' : 'WL spots'}:</b> ${escapeHTML(data.wl_spots)}\n`;
  }
  
  if (data.price && data.price !== 'FREE') {
    msg += `💰 <b>${isRu ? 'Цена' : 'Price'}:</b> ${escapeHTML(data.price)}\n`;
  } else if (data.price === 'FREE') {
    msg += `💰 <b>${isRu ? 'Цена' : 'Price'}:</b> FREE\n`;
  }
  
  if (data.mint_time_raw) {
    msg += `⏰ <b>${isRu ? 'Минт' : 'Mint'}:</b> ${escapeHTML(data.mint_time_raw)}\n`;
  }
  
  if (data.supply) {
    msg += `📦 <b>${isRu ? 'Саплай' : 'Supply'}:</b> ${escapeHTML(data.supply)}\n`;
  }

  if (data.whitelist_form_url || data.form_link) {
    const formUrl = data.whitelist_form_url || data.form_link;
    const platRu = data.form_platform ? (data.form_platform === 'premint' ? 'Premint' : data.form_platform === 'alphabot' ? 'Alphabot' : data.form_platform === 'heymint' ? 'HeyMint' : data.form_platform === 'google_forms' ? 'Google Форма' : data.form_platform) : 'Вайтлист';
    const platEn = data.form_platform ? (data.form_platform === 'premint' ? 'Premint' : data.form_platform === 'alphabot' ? 'Alphabot' : data.form_platform === 'heymint' ? 'HeyMint' : data.form_platform === 'google_forms' ? 'Google Form' : data.form_platform) : 'Whitelist';
    const formLabel = isRu ? `Форма (${platRu})` : `Form (${platEn})`;
    msg += `📝 <b>${formLabel}:</b> <a href="${escapeHTML(formUrl)}">${escapeHTML(formUrl)}</a>\n`;
  }
  
  if (data.moni_score !== null && data.moni_score !== undefined) {
    msg += `🌟 <b>Moni Score:</b> ${data.moni_score.toLocaleString()}\n`;
  }

  if (data.link_risk_level && data.link_risk_level !== 'OK') {
    const icon = data.link_risk_level === 'HIGH' ? '🚫' : (data.link_risk_level === 'MEDIUM' ? '⚠️' : '🛡️');
    msg += `${icon} <b>Link Risk:</b> ${escapeHTML(data.link_risk_level)}`;
    if (data.link_risk_reasons && data.link_risk_reasons.length > 0) {
      msg += ` - ${escapeHTML(data.link_risk_reasons.slice(0, 3).join('; '))}`;
    }
    msg += '\n';
  }
  
  msg += `📈 <b>Radar Score:</b> ${data.score}/100\n\n`;

  if (isRu) {
    const textRu = data.text_ru || data.translated_text || data.text;
    if (textRu && typeof textRu === 'string') {
      msg += `${escapeHTML(textRu.trim())}\n\n`;
    }
  } else {
    let textEn = (data.text_en || '').trim();
    if (!textEn && data.text && typeof data.text === 'string' && !/[а-яА-ЯёЁ]/.test(data.text)) {
      textEn = data.text.trim();
    }
    if (textEn && !/[а-яА-ЯёЁ]/.test(textEn)) {
      msg += `${escapeHTML(textEn)}\n\n`;
    }
  }

  if (data.tweet_url) {
    msg += `👉 <a href="${escapeHTML(data.tweet_url)}">${isRu ? 'Открыть твит' : 'Open Tweet'}</a>\n\n`;
  }
  
  return msg;
}
