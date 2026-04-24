# MeetNow — Plateforme de réunions vidéo

Une plateforme de visioconférence légère, sans serveur, construite avec WebRTC natif.

## 🚀 Démarrage rapide

### Option 1 — Serveur local (recommandé)

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# PHP
php -S localhost:8080
```

Ouvrez ensuite **http://localhost:8080** dans votre navigateur.

### Option 2 — Déploiement en ligne

Déposez les 3 fichiers (`index.html`, `style.css`, `app.js`) sur n'importe quel hébergeur statique :

| Service         | Commande / URL                          |
|-----------------|-----------------------------------------|
| **Netlify**     | Glissez le dossier sur netlify.com/drop |
| **Vercel**      | `npx vercel --prod`                     |
| **GitHub Pages**| Push + activer Pages dans les settings  |
| **Surge.sh**    | `npx surge`                             |

---

## 📁 Structure du projet

```
meet-app/
├── index.html   — Structure HTML (home, setup, room)
├── style.css    — Design sombre, responsive
└── app.js       — Logique WebRTC + signalling
```

---

## ✨ Fonctionnalités

| Fonctionnalité         | Statut |
|------------------------|--------|
| Vidéo HD peer-to-peer  | ✅     |
| Audio bidirectionnel   | ✅     |
| Micro on/off           | ✅     |
| Caméra on/off          | ✅     |
| Partage d'écran        | ✅     |
| Chat en temps réel     | ✅     |
| Lien de réunion        | ✅     |
| Aperçu avant d'entrer  | ✅     |
| Timer de réunion       | ✅     |
| Multi-participants     | ✅     |
| Responsive mobile      | ✅     |
| Sans installation      | ✅     |
| Sans compte            | ✅     |

---

## 🔧 Comment ça marche

### WebRTC
La vidéo et l'audio transitent directement entre les navigateurs (peer-to-peer) via WebRTC. Aucun serveur media n'est nécessaire.

### Signalling
Le signalling (échange des offres SDP et candidats ICE) utilise l'API **BroadcastChannel** du navigateur, ce qui permet la communication entre onglets de la même origine sans serveur.

> **Pour un déploiement multi-appareils sur internet**, remplacez le BroadcastChannel par un serveur WebSocket. Voir la section "Passer en production" ci-dessous.

### STUN
Les serveurs STUN de Google (`stun.l.google.com:19302`) sont utilisés pour la traversée NAT. Gratuits et sans configuration.

---

## 🌐 Passer en production (multi-appareils)

Pour connecter des utilisateurs sur des machines différentes, il faut un **serveur de signalling WebSocket**. Voici un exemple minimal avec Node.js :

### Serveur WebSocket (server.js)

```javascript
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: 3001 });
const rooms = {};

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const room = msg.room;
    if (!rooms[room]) rooms[room] = new Set();
    rooms[room].add(ws);
    ws._room = room;
    // Broadcast to all peers in same room
    for (const peer of rooms[room]) {
      if (peer !== ws && peer.readyState === 1) {
        peer.send(raw.toString());
      }
    }
  });
  ws.on('close', () => {
    if (ws._room && rooms[ws._room]) rooms[ws._room].delete(ws);
  });
});

console.log('Signalling server running on ws://localhost:3001');
```

### Modification dans app.js

Remplacez la fonction `openSignalling()` par :

```javascript
function openSignalling() {
  const ws = new WebSocket('wss://votre-serveur.com');
  
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', room: meetingCode, from: localId, name: userName }));
  };

  ws.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.from === localId) return;
    switch (msg.type) {
      case 'join':   await handlePeerJoin(msg);  break;
      case 'offer':  await handleOffer(msg);     break;
      case 'answer': await handleAnswer(msg);    break;
      case 'ice':    await handleIce(msg);       break;
      case 'leave':  handlePeerLeave(msg);        break;
      case 'meta':   handleMetaMessage(msg);      break;
    }
  };

  channel = { postMessage: (msg) => ws.send(JSON.stringify(msg)), close: () => ws.close() };
}
```

### Serveurs TURN (optionnel)

Pour les réseaux d'entreprise avec NAT symétrique, ajoutez un serveur TURN dans `RTC_CONFIG` :

```javascript
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:votre-turn-server.com:3478',
      username: 'user',
      credential: 'password'
    }
  ]
};
```

Services TURN gratuits/abordables : **Metered.ca**, **Twilio**, **Xirsys**

---

## 🎨 Personnalisation

### Couleur principale
Dans `style.css`, modifiez la variable `--brand` :
```css
:root {
  --brand: #2563eb; /* Changez cette valeur */
}
```

### Nom de l'application
Dans `index.html`, cherchez `MeetNow` et remplacez par votre nom.

### Logo
Remplacez les balises `<svg>` du logo par votre propre image :
```html
<img src="logo.png" alt="MonApp" style="height:32px" />
```

---

## 🔒 Sécurité

- La vidéo WebRTC est chiffrée de bout en bout (DTLS-SRTP)
- Les codes de réunion sont aléatoires (16M+ de combinaisons)
- Aucune donnée n'est stockée sur un serveur
- Aucun compte ni email requis

---

## 📋 Compatibilité navigateurs

| Navigateur       | Support |
|------------------|---------|
| Chrome / Edge    | ✅ Complet |
| Firefox          | ✅ Complet |
| Safari 15+       | ✅ Complet |
| Mobile Chrome    | ✅ Complet |
| Mobile Safari    | ✅ Partiel (partage d'écran limité) |

---

## 📝 Licence

MIT — Libre d'utilisation, modification et distribution.
