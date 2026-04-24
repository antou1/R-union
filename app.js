/* ============================================================
   MeetNow — app.js
   WebRTC peer-to-peer via a simple BroadcastChannel signalling
   (works across tabs of the same origin; for LAN/internet you'd
   swap the signalling transport for a WebSocket server)
   ============================================================ */

// ─── State ────────────────────────────────────────────────────
let localStream = null;
let screenStream = null;
let micEnabled  = true;
let camEnabled  = true;
let screenSharing = false;
let chatOpen    = false;
let setupMode   = 'create';   // 'create' | 'join'
let meetingCode = '';
let meetingTitle = '';
let userName    = '';
let timerInterval = null;
let timerSeconds  = 0;

// WebRTC peers: { peerId: { pc: RTCPeerConnection, stream: MediaStream } }
const peers = {};

// Signalling via BroadcastChannel (same-origin multi-tab demo)
let channel = null;
const localId = crypto.randomUUID();

// ─── STUN servers ─────────────────────────────────────────────
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

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
  showPage('page-setup');
  startPreview();
}

function handleJoin() {
  const raw = document.getElementById('join-input').value.trim();
  if (!raw) { showToast('Entrez un code ou lien de réunion'); return; }
  // Extract code from a full URL if pasted
  const code = raw.includes('/') ? raw.split('/').pop() : raw;
  meetingCode = code.toLowerCase();
  openSetup('join');
}

// ─── Setup / Preview ──────────────────────────────────────────
async function startPreview() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('local-preview').srcObject = localStream;
    document.getElementById('cam-off-state').classList.add('hidden');
    updateSetupAvatar();
  } catch (e) {
    console.warn('Camera/mic not available:', e);
    document.getElementById('cam-off-state').classList.remove('hidden');
  }
}

function updateSetupAvatar() {
  const name = document.getElementById('user-name').value.trim() || 'V';
  const initials = name.split(' ').map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2);
  document.getElementById('setup-avatar').textContent = initials;
  document.getElementById('local-avatar').textContent  = initials;
}
document.getElementById('user-name').addEventListener('input', updateSetupAvatar);

let previewMicOn = true, previewCamOn = true;

function togglePreviewMic() {
  previewMicOn = !previewMicOn;
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = previewMicOn);
  document.getElementById('preview-mic-btn').classList.toggle('off', !previewMicOn);
}

function togglePreviewCam() {
  previewCamOn = !previewCamOn;
  if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = previewCamOn);
  document.getElementById('cam-off-state').classList.toggle('hidden', previewCamOn);
  document.getElementById('preview-cam-btn').classList.toggle('off', !previewCamOn);
}

async function confirmSetup() {
  userName     = document.getElementById('user-name').value.trim() || 'Invité';
  meetingTitle = document.getElementById('meeting-name').value.trim() || 'Réunion';
  micEnabled   = previewMicOn;
  camEnabled   = previewCamOn;

  if (setupMode === 'create') {
    meetingCode = generateCode();
  }
  // Ensure we have a stream
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
      localStream = new MediaStream(); // empty — camera denied
    }
  }
  closePage('page-setup');
  enterRoom();
}

// ─── Room ─────────────────────────────────────────────────────
function enterRoom() {
  document.getElementById('room-title-text').textContent = meetingTitle;
  const url = `${location.origin}${location.pathname}?meet=${meetingCode}`;
  document.getElementById('share-code-text').textContent = url;

  // Local video
  const localVideo = document.getElementById('local-video');
  localVideo.srcObject = localStream;
  document.getElementById('local-cam-off').classList.toggle('hidden', camEnabled);

  // Name / avatar
  const initials = userName.split(' ').map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2);
  document.getElementById('local-avatar').textContent = initials;
  document.getElementById('local-name').textContent  = userName;
  updateLocalIndicators();

  // Track state
  localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
  updateControlUI();

  // Grid layout
  updateGridLayout();
  updateWaiting();

  // Timer
  timerSeconds = 0;
  timerInterval = setInterval(tickTimer, 1000);

  // Signalling
  openSignalling();

  showPage('page-room');
}

function leaveRoom() {
  // Close all peer connections
  Object.values(peers).forEach(({ pc }) => pc.close());
  Object.keys(peers).forEach(id => delete peers[id]);

  // Remove remote tiles
  document.querySelectorAll('.vtile.remote').forEach(el => el.remove());

  // Stop all tracks
  localStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  localStream = null; screenStream = null;
  screenSharing = false;

  // Close signalling
  if (channel) {
    channel.postMessage({ type: 'leave', from: localId, name: userName });
    channel.close();
    channel = null;
  }

  clearInterval(timerInterval);
  updateGridLayout();
  updateWaiting();
  showPage('page-home');
}

// ─── Signalling (BroadcastChannel) ────────────────────────────
function openSignalling() {
  channel = new BroadcastChannel(`meetnow_${meetingCode}`);
  channel.onmessage = async ({ data }) => {
    if (data.from === localId) return;
    switch (data.type) {
      case 'join':    await handlePeerJoin(data); break;
      case 'offer':   await handleOffer(data);    break;
      case 'answer':  await handleAnswer(data);   break;
      case 'ice':     await handleIce(data);      break;
      case 'leave':   handlePeerLeave(data);       break;
      case 'meta':    updatePeerMeta(data);        break;
    }
  };
  // Announce presence
  channel.postMessage({ type: 'join', from: localId, name: userName });
}

function signal(msg) {
  channel?.postMessage({ ...msg, from: localId });
}

// Someone joined — we initiate offer
async function handlePeerJoin({ from, name }) {
  if (peers[from]) return;
  const pc = createPeerConnection(from, name);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal({ type: 'offer', to: from, sdp: pc.localDescription, name: userName });
}

async function handleOffer({ from, sdp, name }) {
  if (!peers[from]) createPeerConnection(from, name);
  const pc = peers[from].pc;
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  signal({ type: 'answer', to: from, sdp: pc.localDescription });
}

async function handleAnswer({ from, sdp }) {
  const peer = peers[from];
  if (!peer) return;
  await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleIce({ from, candidate }) {
  const peer = peers[from];
  if (!peer || !candidate) return;
  try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(_) {}
}

function handlePeerLeave({ from }) {
  if (!peers[from]) return;
  peers[from].pc.close();
  delete peers[from];
  document.getElementById(`tile-${from}`)?.remove();
  updateGridLayout();
  updateWaiting();
}

function updatePeerMeta({ from, micOn, camOn }) {
  const tile = document.getElementById(`tile-${from}`);
  if (!tile) return;
  tile.querySelector('.tile-cam-off')?.classList.toggle('hidden', camOn);
  const ind = tile.querySelector('.tile-indicators');
  if (ind) ind.innerHTML = micOn ? '' : micOffHTML();
}

// ─── RTCPeerConnection ────────────────────────────────────────
function createPeerConnection(peerId, peerName) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers[peerId] = { pc, stream: new MediaStream() };

  // Add our tracks
  localStream?.getTracks().forEach(t => pc.addTrack(t, localStream));

  // ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) signal({ type: 'ice', to: peerId, candidate });
  };

  // Remote tracks
  pc.ontrack = ({ streams }) => {
    const remoteStream = streams[0] || peers[peerId].stream;
    peers[peerId].stream = remoteStream;

    let tile = document.getElementById(`tile-${peerId}`);
    if (!tile) {
      tile = createRemoteTile(peerId, peerName);
    }
    const video = tile.querySelector('video');
    if (video.srcObject !== remoteStream) video.srcObject = remoteStream;
    updateGridLayout();
    updateWaiting();
  };

  return pc;
}

// ─── Remote Tile ──────────────────────────────────────────────
function createRemoteTile(peerId, peerName) {
  const initials = peerName.split(' ').map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2) || '?';
  const div = document.createElement('div');
  div.className = 'vtile remote';
  div.id = `tile-${peerId}`;
  div.innerHTML = `
    <video autoplay playsinline></video>
    <div class="tile-cam-off">
      <div class="tile-avatar">${initials}</div>
    </div>
    <div class="tile-info">
      <div class="tile-name">${peerName}</div>
      <div class="tile-indicators"></div>
    </div>
  `;
  document.getElementById('video-area').appendChild(div);
  return div;
}

// ─── Grid Layout ──────────────────────────────────────────────
function updateGridLayout() {
  const area  = document.getElementById('video-area');
  const count = area.querySelectorAll('.vtile').length;
  area.className = `video-area count-${Math.max(1, count)}`;
}

function updateWaiting() {
  const remotes = document.querySelectorAll('.vtile.remote').length;
  document.getElementById('waiting-msg').classList.toggle('visible', remotes === 0);
}

// ─── Controls ─────────────────────────────────────────────────
function toggleRoomMic() {
  micEnabled = !micEnabled;
  const tracks = screenSharing && screenStream
    ? screenStream.getAudioTracks()
    : localStream?.getAudioTracks() || [];
  tracks.forEach(t => t.enabled = micEnabled);
  updateControlUI();
  signal({ type: 'meta', micOn: micEnabled, camOn: camEnabled });
}

function toggleRoomCam() {
  camEnabled = !camEnabled;
  localStream?.getVideoTracks().forEach(t => t.enabled = camEnabled);
  document.getElementById('local-cam-off').classList.toggle('hidden', camEnabled);
  updateControlUI();
  signal({ type: 'meta', micOn: micEnabled, camOn: camEnabled });
}

async function toggleScreenShare() {
  if (!screenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      // Replace video track in all peer connections
      Object.values(peers).forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });
      // Show in local tile
      document.getElementById('local-video').srcObject = screenStream;
      document.getElementById('local-cam-off').classList.add('hidden');
      screenSharing = true;
      document.getElementById('room-screen-btn').classList.add('active');
      screenTrack.onended = stopScreenShare;
    } catch (e) {
      showToast('Partage d\'écran annulé');
    }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  screenSharing = false;
  screenStream?.getTracks().forEach(t => t.stop());
  // Restore camera track
  const camTrack = localStream?.getVideoTracks()[0];
  if (camTrack) {
    Object.values(peers).forEach(({ pc }) => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
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
  updateLocalIndicators();
}

function updateLocalIndicators() {
  const ind = document.getElementById('local-indicators');
  if (ind) ind.innerHTML = micEnabled ? '' : micOffHTML();
}

function micOffHTML() {
  return `<div class="indicator">
    <svg viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>
  </div>`;
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

  // Local message
  appendChatMessage({ name: userName, text, mine: true });

  // Broadcast via signalling
  signal({ type: 'meta', chatMsg: { name: userName, text } });
}

// Intercept chat messages in signalling
const _origUpdatePeerMeta = updatePeerMeta;
// Re-handle meta messages that contain chat
const _origChannelOnMsg = null;
function handleMetaMessage(data) {
  if (data.chatMsg) {
    appendChatMessage({ name: data.chatMsg.name, text: data.chatMsg.text, mine: false });
  }
  updatePeerMeta(data);
}

function appendChatMessage({ name, text, mine }) {
  const list = document.getElementById('chat-messages');
  const now  = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const div  = document.createElement('div');
  div.className = `chat-msg${mine ? ' mine' : ''}`;
  div.innerHTML = `
    <div class="msg-meta"><strong>${name}</strong>${now}</div>
    <div class="msg-body">${escapeHTML(text)}</div>
  `;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;

  if (!chatOpen) {
    document.getElementById('room-chat-btn').style.boxShadow = '0 0 0 2px var(--brand)';
    setTimeout(() => document.getElementById('room-chat-btn').style.boxShadow = '', 2000);
  }
}

function escapeHTML(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Copy link ────────────────────────────────────────────────
function copyMeetingLink() {
  const url = `${location.origin}${location.pathname}?meet=${meetingCode}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Lien copié !');
    const btn = document.getElementById('btn-copy');
    btn.textContent = '✓ Copié';
    setTimeout(() => btn.innerHTML = `<svg viewBox="0 0 18 18" fill="none">
      <rect x="6" y="6" width="9" height="9" rx="2" stroke="currentColor" stroke-width="1.4"/>
      <path d="M3 12V3h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg> Copier le lien`, 2000);
  }).catch(() => prompt('Copiez ce lien :', url));
}

// ─── Timer ────────────────────────────────────────────────────
function tickTimer() {
  timerSeconds++;
  const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
  const s = String(timerSeconds % 60).padStart(2, '0');
  document.getElementById('room-timer').textContent = `${m}:${s}`;
}

// ─── Toast ────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 2500);
}

// ─── Utils ────────────────────────────────────────────────────
function generateCode() {
  const chars = 'abcdefghijkmnpqrstuvwxyz';
  const part  = () => Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${part()}-${part()}-${part()}`;
}

// ─── URL params: auto-join if ?meet=xxx ───────────────────────
window.addEventListener('DOMContentLoaded', () => {
  showPage('page-home');
  const params = new URLSearchParams(location.search);
  const code   = params.get('meet');
  if (code) {
    document.getElementById('join-input').value = code;
    meetingCode = code;
    openSetup('join');
  }
});

// ─── Patch signalling to handle chat inside meta ──────────────
// Override channel message handler after openSignalling so chat works
const _patchSignalling = openSignalling;
openSignalling = function() {
  _patchSignalling();
  channel.onmessage = async ({ data }) => {
    if (data.from === localId) return;
    switch (data.type) {
      case 'join':   await handlePeerJoin(data);  break;
      case 'offer':  await handleOffer(data);     break;
      case 'answer': await handleAnswer(data);    break;
      case 'ice':    await handleIce(data);       break;
      case 'leave':  handlePeerLeave(data);        break;
      case 'meta':   handleMetaMessage(data);      break;
    }
  };
};
