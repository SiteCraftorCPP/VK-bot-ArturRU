require('dotenv').config();

const { VK } = require('vk-io');
const { Store } = require('../src/store');

const vk = new VK({ token: process.env.VK_TOKEN });
const store = new Store();
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);

function bestPhotoSizeUrl(sizes) {
  if (!sizes?.length) return '';
  const best = [...sizes].sort(
    (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0),
  )[0];
  return best?.url || '';
}

function parsePhotoAttachment(photo) {
  const match = String(photo).match(/^photo(-?\d+)_(\d+)(?:_([A-Za-z0-9_-]+))?$/);
  if (!match) return null;
  return { ref: match[3] ? `${match[1]}_${match[2]}_${match[3]}` : `${match[1]}_${match[2]}` };
}

function isSendablePhoto(photo) {
  return /^photo-?\d+_\d+_[^_\s]+$/.test(String(photo));
}

async function findPhotoUrlInHistory(peerId, photoRef = '', fromId = null) {
  const { items } = await vk.api.messages.getHistory({ peer_id: Number(peerId), count: 100 });
  for (const item of items) {
    if (fromId && item.from_id !== Number(fromId)) continue;
    for (const attachment of item.attachments || []) {
      if (attachment.type !== 'photo') continue;
      const ref = `${attachment.photo.owner_id}_${attachment.photo.id}`;
      if (photoRef && ref !== photoRef) continue;
      const url = bestPhotoSizeUrl(attachment.photo?.sizes);
      if (url) return url;
    }
  }
  return '';
}

async function uploadPhotoFromUrl(url, peerId) {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const uploaded = await vk.upload.messagePhoto({ source: { value: buffer }, peer_id: Number(peerId) });
  return uploaded.toString();
}

async function fixUser(profile, viewerId) {
  if (!profile.photo || isSendablePhoto(profile.photo)) {
    console.log('skip', profile.name, profile.photo);
    return;
  }

  const photoRef = parsePhotoAttachment(profile.photo)?.ref || '';
  let sourceUrl = profile.photoUrl;

  if (!sourceUrl && !profile.isMock) {
    sourceUrl = await findPhotoUrlInHistory(profile.id, photoRef, Number(profile.id));
    if (!sourceUrl) {
      sourceUrl = await findPhotoUrlInHistory(profile.id, '', Number(profile.id));
    }
  }
  if (!sourceUrl) {
    for (const adminId of ADMIN_IDS) {
      sourceUrl = await findPhotoUrlInHistory(adminId, photoRef);
      if (sourceUrl) break;
      sourceUrl = await findPhotoUrlInHistory(adminId, '');
      if (sourceUrl) break;
    }
  }

  if (!sourceUrl) {
    console.log('no url', profile.name);
    return;
  }

  const sendable = await uploadPhotoFromUrl(sourceUrl, viewerId);
  store.updateUser(profile.id, { photo: sendable, photoUrl: sourceUrl });
  console.log('fixed', profile.name, sendable);
}

async function main() {
  const viewerId = ADMIN_IDS[0];
  if (!viewerId) {
    throw new Error('Укажите ADMIN_IDS в файле .env');
  }

  const users = store.listProfiles().filter((u) => u.profileComplete && u.photo);
  for (const user of users) {
    await fixUser(user, viewerId);
  }
}

main().catch(console.error);
