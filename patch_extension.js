const fs = require('fs');
let code = fs.readFileSync('extension/content.js', 'utf8');

const oldFunc = `const check = () => {
            const followerLink = document.querySelector(\`#layers a[href="/\${username}/followers"]\`);
            if (followerLink) {`;

const newFunc = `const check = () => {
            // Case-insensitive query selector for the followers link
            let followerLink = null;
            const links = document.querySelectorAll('#layers a[href*="/followers" i]');
            for (let a of links) {
                if (a.getAttribute('href').toLowerCase().includes(\`/\${username.toLowerCase()}/followers\`)) {
                    followerLink = a;
                    break;
                }
            }
            if (!followerLink) {
               // Fallback: sometimes the hover card is directly inside #layers, sometimes not. Let's look anywhere in #layers.
               const anyLinks = document.querySelectorAll('#layers a');
               for (let a of anyLinks) {
                   const href = a.getAttribute('href');
                   if (href && href.toLowerCase().includes(\`/\${username.toLowerCase()}/followers\`)) {
                       followerLink = a;
                       break;
                   }
               }
            }

            if (followerLink) {`;

code = code.replace(oldFunc, newFunc);

const oldGate = `const bothDisabled = !s.moniFilterEnabled && s.minFollowers === 0;
    return bothDisabled || passFollowers || passMoni;`;

const newGate = `const bothDisabled = !s.moniFilterEnabled && s.minFollowers === 0;
    if (bothDisabled) return true;
    
    // Explicit requested logic: if Moni is not found, look at followers
    if (s.moniFilterEnabled && moniScore === null) {
        if (s.minFollowers > 0) return passFollowers;
        if (s.moniFilterIfUnavailable === 'reject') return false;
        return true; // allow if unavailable
    }
    
    return passFollowers || passMoni;`;

code = code.replace(oldGate, newGate);

fs.writeFileSync('extension/content.js', code);
