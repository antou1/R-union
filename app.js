/* ============================================================
   MeetNow — app.js
   PeerJS signalling + localStorage profile (nom + photo)
   ============================================================ */

// ─── State ────────────────────────────────────────────────────
let localStream   = null;
let screenStream  = null;
let micEnabled    = true;
let camEnabled    = true;
let screenSharing = false;
let chatOpen      = false;
let setupMode     = 'create';
let meetingCode   = '';
let meetingTitle  = '';
let userName      = '';
let userPhoto     = null;   // base64 ou null
let userColor     = '#2563eb';
let timerInterval = null;
let timerSeconds  = 0;

let myPeer = null;
const peers = {};

// ─── LocalStorage profile ─────────────────────────────────────
const PROFILE_KEY = 'meetnow_profile';

function saveProfile() {
  const profile = { name: userName, color: userColor, photo: userPhoto };
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch(e) {}
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

// ─── Page helpers ─────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const el = document.getElementById(id);
  el.style.display = 'flex';
  requestAnimationFrame(() => el.classList.add('active'));
}

function closePage(id) {
  const el = document.getElementById(id);
  el.classList.remove('active');
  setTimeout(() => { el.style.display = 'none'; }, 300);
}

// ─── Home ─────────────────────────────────────────────────────
function openSetup(mode) {
  setupMode = mode;
  document.getElementById('setup-title').textContent =
    mode === 'create' ? 'Créer une réunion' : 'Rejoindre la réunion';
  document.getElementById('meeting-name-field').style.display =
    mode === 'create' ? 'flex' : 'none';

  // Pré-remplir depuis localStorage
  const profile = loadProfile();
  if (profile) {
    if (profile.name) {
      document.getElementById('user-name').value = profile.name;
      userName = profile.name;
    }
    if (profile.color) {
      userColor = profile.color;
      applyColorSelection(profile.color);
    }
    if (profile.photo) {
      userPhoto = profile.photo;
      applyPhotoToSetup(profile.photo);
    }
  }

  updateSetupAvatar();
  showPage('page-setup');
  startPreview();
}

function handleJoin() {
  const raw = document.getElementById('join-input').value.trim();
  if (!raw) { showToast('Entrez un code ou lien de réunion'); return; }
  let code = raw;
  try {
    if (raw.includes('?meet=')) code = new URL(raw).searchParams.get('meet');
    else if (raw.includes('/')) code = raw.split('/').pop().split('?')[0];
  } catch(_) {}
  meetingCode = code.toLowerCase().trim();
  openSetup('join');
}

// ─── Photo upload ─────────────────────────────────────────────
function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    // Redimensionner via canvas pour ne pas surcharger le DataChannel
    const img = new Image();
    img.onload = () => {
      const MAX = 120;
      const canvas = document.createElement('canvas');
      const ratio  = Math.min(MAX / img.width, MAX / img.height);
      canvas.width  = img.width  * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      userPhoto = canvas.toDataURL('image/jpeg', 0.75);
      applyPhotoToSetup(userPhoto);
      // Désélectionner les couleurs
      document.querySelectorAll('.color-opt').forEach(el => el.classList.remove('selected'));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  // Reset input pour permettre re-sélection du même fichier
  event.target.value = '';
}

function applyPhotoToSetup(photoData) {
  // Aperçu dans la boîte caméra
  const img    = document.getElementById('setup-avatar-img');
  const avatar = document.getElementById('setup-avatar');
  img.src = photoData;
  img.classList.remove('hidden');
  avatar.style.display = 'none';

  // Miniature dans picker
  const thumb = document.getElementById('photo-thumb');
  const plus  = document.getElementById('photo-plus');
  const opt   = document.getElementById('photo-preview-opt');
  thumb.src = photoData;
  thumb.classList.remove('hidden');
  plus.style.display = 'none';
  opt.classList.add('has-photo', 'selected');
  document.querySelectorAll('.color-opt').forEach(el => el.classList.remove('selected'));
}

function clearPhoto() {
  userPhoto = null;
  const img    = document.getElementById('setup-avatar-img');
  const avatar = document.getElementById('setup-avatar');
  img.classList.add('hidden');
  img.src = '';
  avatar.style.display = '';

  const thumb = document.getElementById('photo-thumb');
  const plus  = document.getElementById('photo-plus');
  const opt   = document.getElementById('photo-preview-opt');
  thumb.classList.add('hidden');
  plus.style.display = '';
  opt.classList.remove('has-photo', 'selected');
}

// ─── Color picker ─────────────────────────────────────────────
function pickColor(el) {
  clearPhoto();
  userColor = el.dataset.color;
  applyColorSelection(userColor);
  // Mettre à jour l'avatar
  document.getElementById('setup-avatar').style.background = userColor;
}

function applyColorSelection(color) {
  document.querySelectorAll('.color-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.color === color);
  });
  document.getElementById('setup-avatar').style.background = color;
}

// ─── Setup / Preview ──────────────────────────────────────────
async function startPreview() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('local-preview').srcObject = localStream;
    document.getElementById('cam-off-state').classList.add('hidden');
  } catch (e) {
    console.warn('Caméra/micro indisponible:', e);
    document.getElementById('cam-off-state').classList.remove('hidden');
    localStream = new MediaStream();
  }
}

function updateSetupAvatar() {
  const name = document.getElementById('user-name').value.trim() || 'V';
  document.getElementById('setup-avatar').textContent = toInitials(name);
  if (!userPhoto) {
    document.getElementById('setup-avatar').style.background = userColor;
  }
}
document.getElementById('user-name').addEventListener('input', () => {
  updateSetupAvatar();
  // Sauvegarder le nom en live pour l'auto-remplissage
  userName = document.getElementById('user-name').value.trim();
});

let previewMicOn = true, previewCamOn = true;

function togglePreviewMic() {
  previewMicOn = !previewMicOn;
  localStream?.getAudioTracks().forEach(t => t.enabled = previewMicOn);
  document.getElementById('preview-mic-btn').classList.toggle('off', !previewMicOn);
}

function togglePreviewCam() {
  previewCamOn = !previewCamOn;
  localStream?.getVideoTracks().forEach(t => t.enabled = previewCamOn);
  document.getElementById('cam-off-state').classList.toggle('hidden', previewCamOn);
  document.getElementById('preview-cam-btn').classList.toggle('off', !previewCamOn);
}

async function confirmSetup() {
  userName     = document.getElementById('user-name').value.trim() || 'Invité';
  meetingTitle = document.getElementById('meeting-name').value.trim() || 'Réunion';
  micEnabled   = previewMicOn;
  camEnabled   = previewCamOn;

  if (setupMode === 'create') meetingCode = generateCode();

  // Sauvegarder le profil
  saveProfile();

  if (!localStream || localStream.getTracks().length === 0) {
    try { localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
    catch (e) { localStream = new MediaStream(); }
  }

  localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);

  closePage('page-setup');
  enterRoom();
}

// ─── Room ─────────────────────────────────────────────────────
function enterRoom() {
  document.getElementById('room-title-text').textContent = meetingTitle;
  document.getElementById('share-code-text').textContent = buildShareUrl();

  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('local-cam-off').classList.toggle('hidden', camEnabled);

  // Avatar local : photo ou initiales
  applyAvatarToTile('local-avatar', 'local-cam-off', userName, userPhoto, userColor);
  document.getElementById('local-name').textContent = userName;

  updateControlUI();
  updateGridLayout();
  updateWaiting();

  timerSeconds  = 0;
  timerInterval = setInterval(tickTimer, 1000);

  initPeer();
  showPage('page-room');
}

// ─── Appliquer avatar (photo ou couleur+initiales) à une tile ─
function applyAvatarToTile(avatarId, camOffId, name, photo, color) {
  const camOff = document.getElementById(camOffId);
  if (!camOff) return;

  // Supprimer ancienne image si présente
  camOff.querySelectorAll('.local-avatar-img, .tile-avatar-img').forEach(el => el.remove());

  const avatarEl = document.getElementById(avatarId) || camOff.querySelector('.tile-avatar');
  if (!avatarEl) return;

  if (photo) {
    const img = document.createElement('img');
    img.src = photo;
    img.className = avatarId === 'local-avatar' ? 'local-avatar-img' : 'tile-avatar-img';
    img.alt = name;
    avatarEl.style.display = 'none';
    camOff.appendChild(img);
  } else {
    avatarEl.style.display = '';
    avatarEl.textContent = toInitials(name);
    if (color) avatarEl.style.background = color;
  }
}

function applyRemoteAvatar(peerId, name, photo, color) {
  const tile = document.getElementById('tile-' + peerId);
  if (!tile) return;
  const camOff  = tile.querySelector('.tile-cam-off');
  const avatarEl = tile.querySelector('.tile-avatar');
  if (!camOff || !avatarEl) return;

  tile.querySelectorAll('.tile-avatar-img').forEach(el => el.remove());

  if (photo) {
    const img = document.createElement('img');
    img.src = photo;
    img.className = 'tile-avatar-img';
    img.alt = name;
    avatarEl.style.display = 'none';
    camOff.appendChild(img);
  } else {
    avatarEl.style.display = '';
    avatarEl.textContent = toInitials(name);
    if (color) avatarEl.style.background = color;
  }
}

// ─── PeerJS ───────────────────────────────────────────────────
function hostPeerId() { return 'mn-' + meetingCode + '-h'; }
function isHost()     { return setupMode === 'create'; }

function initPeer() {
  const id = isHost() ? hostPeerId() : undefined;
  myPeer = new Peer(id, { debug: 0 });

  myPeer.on('open', peerId => {
    console.log('PeerJS connecté:', peerId);
    if (!isHost()) {
      connectData(hostPeerId());
      callPeer(hostPeerId(), userName);
    }
  });

  myPeer.on('call', call => { call.answer(localStream); handleCall(call); });
  myPeer.on('connection', conn => setupDataConn(conn));

  myPeer.on('error', err => {
    console.error('PeerJS:', err.type, err);
    if (err.type === 'unavailable-id') {
      setupMode = 'join';
      myPeer.destroy();
      myPeer = new Peer(undefined, { debug: 0 });
      myPeer.on('open', () => { connectData(hostPeerId()); callPeer(hostPeerId(), userName); });
      myPeer.on('call', call => { call.answer(localStream); handleCall(call); });
      myPeer.on('connection', conn => setupDataConn(conn));
      myPeer.on('error', e => showToast('Erreur réseau : ' + e.type));
    } else if (err.type === 'peer-unavailable') {
      showToast('Hôte introuvable. Vérifiez le lien ou attendez.');
    } else {
      showToast('Erreur réseau : ' + err.type);
    }
  });
}

// ─── Appel vidéo ──────────────────────────────────────────────
function callPeer(peerId, name) {
  if (peers[peerId]?.call) return;
  const call = myPeer.call(peerId, localStream, {
    metadata: { name: userName, color: userColor, photo: userPhoto }
  });
  if (!call) return;
  if (!peers[peerId]) peers[peerId] = {};
  peers[peerId].name  = name || peerId;
  peers[peerId].color = userColor;
  handleCall(call);
}

function handleCall(call) {
  const peerId = call.peer;
  if (!peers[peerId]) peers[peerId] = {};
  peers[peerId].call = call;
  if (call.metadata?.name)  peers[peerId].name  = call.metadata.name;
  if (call.metadata?.color) peers[peerId].color = call.metadata.color;
  if (call.metadata?.photo) peers[peerId].photo = call.metadata.photo;

  call.on('stream', remoteStream => {
    peers[peerId].stream = remoteStream;
    const p = peers[peerId];
    let tile = document.getElementById('tile-' + peerId);
    if (!tile) tile = createRemoteTile(peerId, p.name || 'Participant', p.photo, p.color);
    const video = tile.querySelector('video');
    if (video.srcObject !== remoteStream) video.srcObject = remoteStream;
    updateGridLayout();
    updateWaiting();
  });

  call.on('close', () => removePeer(peerId));
  call.on('error', () => removePeer(peerId));
}

// ─── DataConnection ───────────────────────────────────────────
function myProfilePayload() {
  return { name: userName, color: userColor, photo: userPhoto };
}

function connectData(peerId) {
  if (peers[peerId]?.data?.open) return;
  const conn = myPeer.connect(peerId, {
    metadata: myProfilePayload(), reliable: true
  });
  if (!peers[peerId]) peers[peerId] = {};
  peers[peerId].data = conn;

  conn.on('open', () => { conn.send({ type: 'hello', ...myProfilePayload() }); });
  conn.on('data',  d  => handleDataMsg(d, peerId));
  conn.on('close', () => removePeer(peerId));
  conn.on('error', e  => console.warn('DataConn error', e));
}

function setupDataConn(conn) {
  const peerId = conn.peer;
  if (!peers[peerId]) peers[peerId] = {};
  peers[peerId].data = conn;
  if (conn.metadata?.name)  peers[peerId].name  = conn.metadata.name;
  if (conn.metadata?.color) peers[peerId].color = conn.metadata.color;
  if (conn.metadata?.photo) peers[peerId].photo = conn.metadata.photo;

  conn.on('open', () => {
    // Envoyer roster
    const roster = Object.entries(peers)
      .filter(([id]) => id !== peerId)
      .map(([id, p]) => ({ id, name: p.name || '?', color: p.color, photo: p.photo }));
    conn.send({ type: 'roster', peers: roster, hostId: myPeer.id });
    callPeer(peerId, peers[peerId].name);
  });
  conn.on('data',  d => handleDataMsg(d, peerId));
  conn.on('close', () => removePeer(peerId));
  conn.on('error', e => console.warn('DataConn error', e));
}

function handleDataMsg(msg, fromId) {
  switch (msg.type) {
    case 'hello':
      if (!peers[fromId]) peers[fromId] = {};
      peers[fromId].name  = msg.name;
      peers[fromId].color = msg.color;
      peers[fromId].photo = msg.photo;
      // Mettre à jour la tile si elle existe
      const tile = document.getElementById('tile-' + fromId);
      if (tile) {
        tile.querySelector('.tile-name').textContent = escapeHTML(msg.name);
        applyRemoteAvatar(fromId, msg.name, msg.photo, msg.color);
      }
      break;

    case 'roster':
      msg.peers.forEach(({ id, name, color, photo }) => {
        if (id === myPeer.id) return;
        if (!peers[id]) peers[id] = { name, color, photo };
        connectData(id);
        callPeer(id, name);
      });
      break;

    case 'chat':
      appendChatMessage({ name: msg.name, text: msg.text, photo: msg.photo, color: msg.color, mine: false });
      break;

    case 'meta':
      updatePeerMeta(fromId, msg);
      break;

    case 'leave':
      removePeer(fromId);
      break;
  }
}

function broadcastData(msg) {
  Object.values(peers).forEach(({ data }) => {
    try { if (data && data.open) data.send(msg); } catch(_) {}
  });
}

// ─── Peer management ──────────────────────────────────────────
function removePeer(peerId) {
  if (!peers[peerId]) return;
  try { peers[peerId].call?.close(); } catch(_) {}
  delete peers[peerId];
  document.getElementById('tile-' + peerId)?.remove();
  updateGridLayout();
  updateWaiting();
}

// ─── Remote Tile ──────────────────────────────────────────────
function createRemoteTile(peerId, peerName, photo, color) {
  const div = document.createElement('div');
  div.className = 'vtile remote';
  div.id = 'tile-' + peerId;

  const avatarBg    = color || '#2563eb';
  const avatarInits = toInitials(peerName);

  div.innerHTML = `
    <video autoplay playsinline></video>
    <div class="tile-cam-off">
      <div class="tile-avatar" style="background:${avatarBg}">${avatarInits}</div>
    </div>
    <div class="tile-info">
      <div class="tile-name">${escapeHTML(peerName)}</div>
      <div class="tile-indicators"></div>
    </div>
  `;
  document.getElementById('video-area').appendChild(div);

  // Appliquer photo si fournie
  if (photo) applyRemoteAvatar(peerId, peerName, photo, color);

  return div;
}

function updatePeerMeta(peerId, msg) {
  const tile = document.getElementById('tile-' + peerId);
  if (!tile) return;
  if (msg.camOn !== undefined)
    tile.querySelector('.tile-cam-off')?.classList.toggle('hidden', msg.camOn);
  if (msg.micOn !== undefined) {
    const ind = tile.querySelector('.tile-indicators');
    if (ind) ind.innerHTML = msg.micOn ? '' : micOffHTML();
  }
}

// ─── Grid Layout ──────────────────────────────────────────────
function updateGridLayout() {
  const area  = document.getElementById('video-area');
  const count = area.querySelectorAll('.vtile').length;
  area.className = 'video-area count-' + Math.max(1, count);
}

function updateWaiting() {
  const remotes = document.querySelectorAll('.vtile.remote').length;
  document.getElementById('waiting-msg').classList.toggle('visible', remotes === 0);
}

// ─── Controls ─────────────────────────────────────────────────
function toggleRoomMic() {
  micEnabled = !micEnabled;
  localStream?.getAudioTracks().forEach(t => t.enabled = micEnabled);
  updateControlUI();
  broadcastData({ type: 'meta', micOn: micEnabled, camOn: camEnabled });
}

function toggleRoomCam() {
  camEnabled = !camEnabled;
  localStream?.getVideoTracks().forEach(t => t.enabled = camEnabled);
  document.getElementById('local-cam-off').classList.toggle('hidden', camEnabled);
  updateControlUI();
  broadcastData({ type: 'meta', micOn: micEnabled, camOn: camEnabled });
}

async function toggleScreenShare() {
  if (!screenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      Object.values(peers).forEach(({ call }) => {
        if (!call) return;
        const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });
      document.getElementById('local-video').srcObject = screenStream;
      document.getElementById('local-cam-off').classList.add('hidden');
      screenSharing = true;
      document.getElementById('room-screen-btn').classList.add('active');
      screenTrack.onended = stopScreenShare;
    } catch (e) { showToast("Partage d'écran annulé"); }
  } else { stopScreenShare(); }
}

function stopScreenShare() {
  screenSharing = false;
  screenStream?.getTracks().forEach(t => t.stop());
  const camTrack = localStream?.getVideoTracks()[0];
  if (camTrack) {
    Object.values(peers).forEach(({ call }) => {
      if (!call) return;
      const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(camTrack);
    });
  }
  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('local-cam-off').classList.toggle('hidden', camEnabled);
  document.getElementById('room-screen-btn').classList.remove('active');
}

function updateControlUI() {
  document.getElementById('room-mic-btn').classList.toggle('off', !micEnabled);
  document.getElementById('room-cam-btn').classList.toggle('off', !camEnabled);
  const ind = document.getElementById('local-indicators');
  if (ind) ind.innerHTML = micEnabled ? '' : micOffHTML();
}

function micOffHTML() {
  return `<div class="indicator"><svg viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg></div>`;
}

// ─── Leave ────────────────────────────────────────────────────
function leaveRoom() {
  broadcastData({ type: 'leave' });
  Object.keys(peers).forEach(id => removePeer(id));
  myPeer?.destroy(); myPeer = null;
  localStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  localStream = null; screenStream = null; screenSharing = false;
  document.querySelectorAll('.vtile.remote').forEach(el => el.remove());
  clearInterval(timerInterval);
  updateGridLayout(); updateWaiting();
  showPage('page-home');
}

// ─── Chat ─────────────────────────────────────────────────────
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-panel').classList.toggle('open', chatOpen);
  document.getElementById('room-chat-btn').classList.toggle('active', chatOpen);
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  appendChatMessage({ name: userName, text, photo: userPhoto, color: userColor, mine: true });
  broadcastData({ type: 'chat', name: userName, text, photo: userPhoto, color: userColor });
}

function appendChatMessage({ name, text, photo, color, mine }) {
  const list = document.getElementById('chat-messages');
  const now  = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const div  = document.createElement('div');
  div.className = 'chat-msg' + (mine ? ' mine' : '');

  const avatarHTML = photo
    ? `<img src="${photo}" class="chat-avatar-img" alt="${escapeHTML(name)}" />`
    : `<div class="chat-avatar" style="background:${color || '#2563eb'}">${toInitials(name)}</div>`;

  div.innerHTML = `
    <div class="chat-msg-row">
      ${avatarHTML}
      <div class="chat-bubble-wrap">
        <div class="msg-meta"><strong>${escapeHTML(name)}</strong><span>${now}</span></div>
        <div class="msg-body">${escapeHTML(text)}</div>
      </div>
    </div>
  `;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
  if (!chatOpen) {
    const btn = document.getElementById('room-chat-btn');
    btn.style.boxShadow = '0 0 0 2px var(--brand)';
    setTimeout(() => btn.style.boxShadow = '', 2500);
  }
}

// ─── Copy link ────────────────────────────────────────────────
function copyMeetingLink() {
  const url = buildShareUrl();
  navigator.clipboard.writeText(url).then(() => {
    showToast('Lien copié !');
    const btn = document.getElementById('btn-copy');
    const orig = btn.innerHTML;
    btn.textContent = '✓ Copié';
    setTimeout(() => btn.innerHTML = orig, 2000);
  }).catch(() => prompt('Copiez ce lien :', url));
}

function buildShareUrl() {
  return location.origin + location.pathname + '?meet=' + meetingCode;
}

// ─── Timer ────────────────────────────────────────────────────
function tickTimer() {
  timerSeconds++;
  const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
  const s = String(timerSeconds % 60).padStart(2, '0');
  document.getElementById('room-timer').textContent = m + ':' + s;
}

// ─── Toast ────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── Utils ────────────────────────────────────────────────────
function generateCode() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const part  = () => Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return part() + '-' + part() + '-' + part();
}

function toInitials(name) {
  return (name || '?').split(' ').map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2) || '?';
}

function escapeHTML(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Auto-join depuis URL ─────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  showPage('page-home');
  const params = new URLSearchParams(location.search);
  const code   = params.get('meet');
  if (code) {
    meetingCode = code.toLowerCase().trim();
    setupMode   = 'join';
    document.getElementById('join-input').value = meetingCode;
    openSetup('join');
  }
});
