const fs = require('fs');
let code = fs.readFileSync('worker/src/i18n.js', 'utf8');

const additionsRu = `
    btn_refresh_floor: "🔄 Обновить Floor Price",
    btn_edit_threshold: "✏️ Изменить порог",
    btn_pause: "⏸ Приостановить алерт",
    btn_resume: "▶️ Возобновить алерт",
`;

const additionsEn = `
    btn_refresh_floor: "🔄 Refresh Floor Price",
    btn_edit_threshold: "✏️ Edit Threshold",
    btn_pause: "⏸ Pause Alert",
    btn_resume: "▶️ Resume Alert",
`;

code = code.replace('btn_add_collection: "➕ Добавить коллекцию",', additionsRu + '    btn_add_collection: "➕ Добавить коллекцию",');
code = code.replace('btn_add_collection: "➕ Add Collection",', additionsEn + '    btn_add_collection: "➕ Add Collection",');

fs.writeFileSync('worker/src/i18n.js', code);
