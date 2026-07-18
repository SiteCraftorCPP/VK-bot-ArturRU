require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { VK } = require('vk-io');
const { Store } = require('./store');
const keyboards = require('./keyboards');
const payments = require('./payments');
const yookassa = require('./yookassa');
const { findNextProfile: pickNextProfile } = require('./browse');
const { startWebhookServer } = require('./webhook-server');

const LOCK_PATH = path.join(__dirname, '..', 'data', 'bot.lock');

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });

  if (fs.existsSync(LOCK_PATH)) {
    const existingPid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    if (existingPid && isPidAlive(existingPid)) {
      throw new Error(`Бот уже запущен (PID ${existingPid}). Сначала выполните: npm run stop`);
    }
  }

  fs.writeFileSync(LOCK_PATH, String(process.pid), 'utf8');
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH) && Number(fs.readFileSync(LOCK_PATH, 'utf8').trim()) === process.pid) {
      fs.unlinkSync(LOCK_PATH);
    }
  } catch {}
}

acquireLock();

['exit', 'SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
  process.on(signal, () => {
    releaseLock();
    if (signal !== 'exit') {
      process.exit(0);
    }
  });
});

process.on('uncaughtException', (error) => {
  console.error('Критическая ошибка:', error);
  releaseLock();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Необработанное отклонение промиса:', reason);
});

const TOKEN = process.env.VK_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

if (!TOKEN) {
  throw new Error('Укажите VK_TOKEN в файле .env');
}

const vk = new VK({ token: TOKEN });
const store = new Store();
const photoSourceUrlCache = new Map();
const HISTORY_SCAN_COUNT = 40;

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

function menuKeyboard(context, userId) {
  const id = context?.senderId ?? userId;
  const user = store.getUser(id);
  return keyboards.mainMenu(isAdmin(id), user?.gender);
}

function menuKeyboardForUser(userId) {
  const user = store.getUser(userId);
  return keyboards.mainMenu(isAdmin(userId), user?.gender);
}

async function fulfillProduct(userId, product) {
  const config = payments.getPaymentConfig();
  store.ensureUser(userId);

  if (product === 'subscription') {
    const user = store.getUser(userId);
    const subscribedUntil = payments.extendUntil(user.subscribedUntil, config.subscriptionDays);
    store.updateUser(userId, { subscribedUntil });
    await sendToUser(
      userId,
      `Оплата прошла успешно ✅\nДоступ к лайкам активен до ${new Date(subscribedUntil).toLocaleDateString('ru-RU')}.`,
      menuKeyboardForUser(userId),
    );
    await fulfillPendingLike(userId);
    return;
  }

  if (product === 'boost') {
    const user = store.getUser(userId);
    const boostedUntil = payments.extendUntil(user.boostedUntil, config.boostDays);
    store.updateUser(userId, {
      boostedUntil,
      boostedAt: new Date().toISOString(),
    });
    await sendToUser(
      userId,
      `Оплата прошла успешно ✅\nАнкета поднята в топ на месяц (до ${new Date(boostedUntil).toLocaleDateString('ru-RU')}).`,
      menuKeyboardForUser(userId),
    );
  }
}

async function onYookassaWebhook(payload) {
  if (payload?.event !== 'payment.succeeded' || !payload?.object?.id) {
    return;
  }

  const paymentId = payload.object.id;
  if (store.hasSucceededYookassaPayment(paymentId)) {
    return;
  }

  const verified = await yookassa.fetchPayment(paymentId);
  if (verified.status !== 'succeeded') {
    return;
  }

  const userId = verified.metadata?.user_id;
  const product = verified.metadata?.product;
  if (!userId || !product) {
    console.error('ЮKassa: нет metadata в платеже', paymentId);
    return;
  }

  const expectedAmount = payments.getProductAmount(product);
  if (payments.formatAmount(verified.amount?.value) !== payments.formatAmount(expectedAmount)) {
    console.error('ЮKassa: сумма не совпадает', paymentId, verified.amount?.value, expectedAmount);
    return;
  }

  store.completeYookassaPayment(paymentId);
  await fulfillProduct(userId, product);
}

async function createYookassaPayment(context, product) {
  const config = payments.getPaymentConfig();
  if (!payments.isPaymentConfigured()) {
    await context.send({
      message: 'Оплата временно недоступна. Обратитесь к модератору.',
      keyboard: menuKeyboard(context, context.senderId),
    });
    return;
  }

  const userId = String(context.senderId);
  const amount = payments.getProductAmount(product, config);
  const description = payments.getProductDescription(product, config);

  try {
    const payment = await yookassa.createPayment({
      userId,
      product,
      amount,
      description,
    });

    if (!payment.confirmationUrl) {
      throw new Error('Не получена ссылка на оплату');
    }

    store.createPendingPayment({
      yookassaPaymentId: payment.id,
      userId,
      product,
      amount,
    });

    const testNote = config.testMode ? '\n\n🧪 Тестовый режим ЮKassa.' : '';
    const productText = product === 'subscription'
      ? [
          'Оплата доступа к боту 💳',
          `Стоимость: ${amount} ₽ на ${config.subscriptionDays} дней.`,
          'Платите один раз — никаких автосписаний и автопродлений.',
          'Нажмите кнопку ниже — откроется страница оплаты ЮKassa.',
        ].join('\n')
      : [
          'Поднятие анкеты в топ 🔝',
          `Стоимость: ${amount} ₽ на месяц.`,
          'Ваша анкета будет показываться первой среди анкет в вашем городе.',
          'Нажмите кнопку ниже — откроется страница оплаты ЮKassa.',
        ].join('\n');

    await context.send({
      message: `${productText}${testNote}`,
      keyboard: keyboards.paymentUrl(`Оплатить ${amount} ₽`, payment.confirmationUrl),
    });
  } catch (error) {
    console.error('Ошибка создания платежа ЮKassa:', error.message);
    await context.send({
      message: 'Не удалось создать платёж. Попробуйте позже или напишите модератору.',
      keyboard: menuKeyboard(context, context.senderId),
    });
  }
}

function parsePayload(context) {
  const raw = context.messagePayload || context.payload;
  if (!raw) {
    return null;
  }

  if (typeof raw === 'object') {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch {
    return null;
  }
}

function normalizeText(text = '') {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeCity(text = '') {
  return normalizeText(text)
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function hasContacts(text = '') {
  return /(\+?\d[\d\s().-]{7,}|https?:\/\/|vk\.com|t\.me|@\w+)/i.test(text);
}

const ALL_CITIES = '*';

function defaultFilters() {
  return { ageFrom: 18, ageTo: 80, city: '', country: '' };
}

function isProfileDataComplete(user) {
  const profile = { ...user, ...user.draft };
  return Boolean(
    profile.gender
    && profile.age
    && profile.city
    && profile.name
    && profile.about
    && profile.about.length >= 30
    && profile.photo,
  );
}

function getResumeState(user) {
  const activeStates = [
    'ask_gender', 'ask_age', 'ask_city', 'ask_name', 'ask_about', 'ask_photo', 'confirm_profile',
  ];

  if (activeStates.includes(user.state) || user.state.startsWith('edit_')) {
    return user.state;
  }

  const profile = { ...user, ...user.draft };
  if (!profile.gender) return 'ask_gender';
  if (!profile.age) return 'ask_age';
  if (!profile.city) return 'ask_city';
  if (!profile.name) return 'ask_name';
  if (!profile.about) return 'ask_about';
  if (!profile.photo) return 'ask_photo';
  if (isProfileDataComplete(user)) return 'confirm_profile';
  return 'ask_photo';
}

function recoverUserState(user) {
  if (user.profileComplete) {
    return user;
  }

  if (!user.profileComplete && user.state === 'ask_photo' && user.draft?.photo) {
    return store.updateUser(user.id, { state: 'confirm_profile' });
  }

  const preservedStates = [
    'ask_gender', 'ask_age', 'ask_city', 'ask_name', 'ask_about', 'ask_photo', 'confirm_profile',
  ];

  if (
    preservedStates.includes(user.state)
    || user.state.startsWith('edit_')
    || user.state.startsWith('filter_')
    || user.state.startsWith('admin_')
  ) {
    return user;
  }

  if (isProfileDataComplete(user)) {
    return store.updateUser(user.id, { state: 'confirm_profile' });
  }

  return user;
}

function pickPhotoFromContext(context) {
  if (typeof context.hasAttachments === 'function' && context.hasAttachments('photo')) {
    const photos = context.getAttachments('photo');
    if (photos.length) {
      return photos[0].toString();
    }
  }

  if (typeof context.hasAttachments === 'function' && context.hasAttachments('doc')) {
    const doc = context.getAttachments('doc')[0];
    const ext = String(doc?.ext || doc?.payload?.ext || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'bmp'].includes(ext)) {
      return doc.toString();
    }
  }

  const attachment = (context.attachments || []).find((item) => item.type === 'photo');
  return attachment ? attachment.toString() : '';
}

function photoUrlFromAttachment(context) {
  const attachment = context.getAttachments?.('photo')?.[0];
  if (!attachment) {
    return '';
  }

  if (attachment.sizes?.length) {
    return bestPhotoSizeUrl(attachment.sizes);
  }
  if (attachment.largeSizeUrl) {
    return attachment.largeSizeUrl;
  }
  if (attachment.mediumSizeUrl) {
    return attachment.mediumSizeUrl;
  }

  return '';
}

async function ensureAttachmentsLoaded(context) {
  if (context.attachments?.length > 0 || photoUrlFromAttachment(context)) {
    return;
  }

  if (typeof context.loadMessagePayload !== 'function') {
    return;
  }

  try {
    await context.loadMessagePayload({ force: Boolean(context.$filled) });
  } catch {
    if (!context.id) {
      return;
    }

    try {
      const { items } = await vk.api.messages.getById({ message_ids: context.id });
      const [message] = items;
      if (message?.attachments?.length && typeof context.applyPayload === 'function') {
        context.applyPayload({
          out: Number(context.isOutbox),
          ...message,
        });
      }
    } catch {}
  }
}

async function getPhotoAttachment(context) {
  await ensureAttachmentsLoaded(context);

  const photo = pickPhotoFromContext(context);
  if (photo) {
    return photo;
  }

  if (typeof context.loadMessagePayload === 'function') {
    try {
      await context.loadMessagePayload({ force: true });
    } catch {}
  }

  return pickPhotoFromContext(context) || '';
}

function parsePhotoAttachment(photo) {
  const match = String(photo).match(/^photo(-?\d+)_(\d+)(?:_([A-Za-z0-9_-]+))?$/);
  if (!match) {
    return null;
  }

  return {
    ref: match[3] ? `${match[1]}_${match[2]}_${match[3]}` : `${match[1]}_${match[2]}`,
    ownerId: Number(match[1]),
  };
}

function isSendablePhoto(photo) {
  return /^photo-?\d+_\d+_[^_\s]+$/.test(String(photo));
}

function bestPhotoSizeUrl(sizes) {
  if (!sizes?.length) {
    return '';
  }

  const best = [...sizes].sort(
    (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0),
  )[0];
  return best?.url || '';
}

async function getPhotoUrlFromContext(context) {
  await ensureAttachmentsLoaded(context);

  const directUrl = photoUrlFromAttachment(context);
  if (directUrl) {
    return directUrl;
  }

  if (!context.id) {
    return '';
  }

  try {
    const { items } = await vk.api.messages.getById({ message_ids: context.id });
    const photo = items[0]?.attachments?.find((item) => item.type === 'photo');
    return bestPhotoSizeUrl(photo?.photo?.sizes);
  } catch (error) {
    console.error('getPhotoUrlFromContext:', error.message);
    return '';
  }
}

async function findPhotoUrlInHistory(peerId, photoRef = '', fromId = null) {
  const cacheKey = `${peerId}:${fromId || 0}:${photoRef || '*'}`;
  if (photoSourceUrlCache.has(cacheKey)) {
    return photoSourceUrlCache.get(cacheKey);
  }

  try {
    const { items } = await vk.api.messages.getHistory({
      peer_id: Number(peerId),
      count: HISTORY_SCAN_COUNT,
    });

    for (const item of items) {
      if (fromId && item.from_id !== Number(fromId)) {
        continue;
      }

      for (const attachment of item.attachments || []) {
        if (attachment.type !== 'photo') {
          continue;
        }

        const ref = `${attachment.photo.owner_id}_${attachment.photo.id}`;
        if (photoRef && ref !== photoRef) {
          continue;
        }

        const url = bestPhotoSizeUrl(attachment.photo?.sizes);
        if (url) {
          photoSourceUrlCache.set(cacheKey, url);
          return url;
        }
      }
    }
  } catch (error) {
    console.error('findPhotoUrlInHistory:', error.message);
  }

  photoSourceUrlCache.set(cacheKey, '');
  return '';
}

async function resolvePhotoSourceUrl(profile) {
  if (profile?.photoUrl) {
    return profile.photoUrl;
  }

  if (!profile?.photo) {
    return '';
  }

  const cacheKey = `profile:${profile.id}`;
  if (photoSourceUrlCache.has(cacheKey)) {
    return photoSourceUrlCache.get(cacheKey);
  }

  const parsed = parsePhotoAttachment(profile.photo);
  const photoRef = parsed?.ref || '';
  let sourceUrl = '';

  if (!profile.isMock) {
    sourceUrl = await findPhotoUrlInHistory(profile.id, photoRef, Number(profile.id));
    if (!sourceUrl) {
      sourceUrl = await findPhotoUrlInHistory(profile.id, '', Number(profile.id));
    }
  }

  if (!sourceUrl) {
    for (const adminId of ADMIN_IDS) {
      sourceUrl = await findPhotoUrlInHistory(adminId, photoRef);
      if (sourceUrl) {
        break;
      }
      sourceUrl = await findPhotoUrlInHistory(adminId, '');
      if (sourceUrl) {
        break;
      }
    }
  }

  photoSourceUrlCache.set(cacheKey, sourceUrl || '');
  if (sourceUrl && profile?.id) {
    store.updateUser(profile.id, { photoUrl: sourceUrl });
  }

  return sourceUrl;
}

async function uploadPhotoFromUrl(url, peerId) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Photo download failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const uploaded = await vk.upload.messagePhoto({
    source: { value: buffer },
    peer_id: Number(peerId),
  });

  return uploaded.toString();
}

async function uploadPhotoForPeer(profile, peerId) {
  const freshProfile = profile?.id ? store.getUser(profile.id) : profile;
  const existing = freshProfile?.photo || profile?.photo || '';
  if (existing && isSendablePhoto(existing)) {
    return existing;
  }

  const sourceUrl = await resolvePhotoSourceUrl(freshProfile || profile);
  if (!sourceUrl) {
    return '';
  }

  const uploadPeerId = Number(peerId) || Number(ADMIN_IDS[0]) || Number(profile?.id);
  const sendable = await uploadPhotoFromUrl(sourceUrl, uploadPeerId);
  if (profile?.id) {
    store.updateUser(profile.id, { photo: sendable, photoUrl: sourceUrl });
  }
  return sendable;
}

async function resolveProfilePhoto(profile, peerId) {
  const freshProfile = profile?.id ? store.getUser(profile.id) : profile;
  const photo = freshProfile?.photo || profile?.photo || '';
  if (!photo) {
    return '';
  }

  if (isSendablePhoto(photo)) {
    return photo;
  }

  try {
    return await uploadPhotoForPeer(freshProfile || profile, peerId);
  } catch (error) {
    console.error('resolveProfilePhoto:', error.message);
    return '';
  }
}

async function persistIncomingPhoto(context, photo) {
  if (!photo) {
    return { photo: '', photoUrl: '' };
  }

  await ensureAttachmentsLoaded(context);
  let photoUrl = photoUrlFromAttachment(context);
  if (!photoUrl) {
    photoUrl = await getPhotoUrlFromContext(context);
  }

  if (!photoUrl) {
    return { photo, photoUrl: '' };
  }

  const peerId = context.peerId || context.senderId;
  try {
    const sendable = await uploadPhotoFromUrl(photoUrl, peerId);
    return { photo: sendable, photoUrl };
  } catch (error) {
    console.error('persistIncomingPhoto:', error.message);
    return { photo, photoUrl };
  }
}

function profileText(profile) {
  const city = profile.city ? `, ${profile.city}` : '';
  const country = profile.country ? `, ${profile.country}` : '';
  return `${profile.name}, ${profile.age}${city}${country}\n\n${profile.about}`;
}

async function sendProfile(context, title, profile, keyboard) {
  const message = `${title}\n\n${profileText(profile)}`;
  const peerId = context.peerId || context.senderId;
  const photo = await resolveProfilePhoto(profile, peerId);

  if (photo) {
    await context.send({ message, attachment: photo, keyboard });
    return;
  }

  await context.send({ message, keyboard });
}

async function sendProfileToUser(userId, title, profile, keyboard) {
  const message = `${title}\n\n${profileText(profile)}`;
  const photo = await resolveProfilePhoto(profile, userId);
  await sendToUser(userId, message, keyboard, photo);
}

async function sendToUser(userId, message, keyboard, attachment = '') {
  const params = {
    user_id: Number(userId),
    random_id: Date.now() + Math.floor(Math.random() * 100000),
    message,
  };

  if (keyboard) {
    params.keyboard = keyboard.toString();
  }

  if (attachment) {
    params.attachment = attachment;
  }

  await vk.api.messages.send(params);
}

function commandsText(userId) {
  const lines = [
    'Команды бота 🕌',
    '/my_profile — Моя анкета',
    '/browse_profiles — Смотреть анкеты',
    '/filters — Фильтр поиска',
    '/edit_profile — Изменить анкету',
    '/all_likes — Лайки',
    '/chanel — Наш канал',
    '/moderator — Модератор',
    '/pay_for_bot — Оплатить бот',
    '/delete — Удалить анкету',
    '/restore — Восстановить анкету',
  ];

  if (isAdmin(userId)) {
    lines.push('/admin — Админ-панель');
  }

  return lines.join('\n');
}

function registrationQuestion(state) {
  switch (state) {
    case 'ask_age':
      return 'Сколько вам лет? (Введите число между 18 и 80). Ответив на данный вопрос вы подтверждаете что вам больше 18 лет!';
    case 'ask_city':
      return 'Введите название вашего города без лишних букв и пробелов. Не указывайте страну или регион. Для лучшего поиска используйте ближайший крупный город.';
    case 'ask_name':
      return 'Как вас зовут?';
    case 'ask_about':
      return [
        'Остался последний шаг. Пожалуйста, расскажите немного о себе — это поможет другим лучше понять вас.',
        'Пишите в свободной форме, а не просто "да" или "нет".',
        '',
        'Укажите:',
        '- Ваш рост, вес.',
        '- Национальность.',
        '- Как давно вы приняли Ислам.',
        '- Совершаете намаз.',
        '- Держите пост.',
        '- Умеете ли вы читать Коран и сколько сур знаете.',
        '- Ваш характер, хобби и интересы.',
        '- Есть ли у вас дети.',
        '- Пожелания к будущему партнёру (если есть).',
        '❗️ Личные контакты запрещены',
      ].join('\n');
    case 'ask_photo':
      return 'Теперь пришлите фото. Можно просто аватарку любую. Вашу фотографию будут видеть другие пользователи.';
    default:
      return '';
  }
}

async function resetRegistration(context, user) {
  store.updateUser(user.id, {
    state: 'ask_gender',
    draft: {},
    profileComplete: false,
    gender: null,
    age: null,
    city: '',
    country: '',
    name: '',
    about: '',
    photo: '',
    filters: defaultFilters(),
  });
  await context.send({
    message: 'Ас-саляму алейкум! 🌙 Давайте создадим анкету для серьёзного знакомства. Выберите ваш пол:',
    keyboard: keyboards.gender(),
  });
}

async function resumeRegistration(context, user) {
  const fresh = recoverUserState(store.getUser(user.id));

  if (fresh.profileComplete) {
    await showMyProfile(context, fresh);
    return;
  }

  if (fresh.state === 'confirm_profile') {
    await previewProfile(context, fresh);
    return;
  }

  const state = getResumeState(fresh);
  if (state !== fresh.state) {
    store.updateUser(fresh.id, { state });
  }

  if (state === 'ask_gender') {
    await context.send({
      message: 'Ас-саляму алейкум! 🌙 Давайте создадим анкету для серьёзного знакомства. Выберите ваш пол:',
      keyboard: keyboards.gender(),
    });
    return;
  }

  const question = registrationQuestion(state.replace(/^edit_/, 'ask_'));
  await context.send({ message: question });
}

async function previewProfile(context, user) {
  const profile = { ...user, ...user.draft };
  await sendProfile(context, 'Так выглядит твоя анкета:', profile, undefined);
  await context.send({
    message: 'Все правильно? Пожалуйста, ответьте сообщением, или кнопками внизу:\n"Да" — если всё верно\n"Изменить анкету" — если хотите внести изменения в анкету',
    keyboard: keyboards.confirmProfile(),
  });
}

function requireCompletedProfile(user) {
  return user && user.profileComplete && user.active;
}

async function showMyProfile(context, user) {
  if (!user.profileComplete) {
    await resumeRegistration(context, user);
    return;
  }

  await sendProfile(context, 'Ваша анкета 🕌', user, menuKeyboard(context, user.id));
}

function findNextProfile(user) {
  return pickNextProfile(
    user,
    store.listProfiles(),
    store.data.likes,
    (profile) => store.isBoosted(profile),
  );
}

async function browseProfiles(context, user) {
  if (!requireCompletedProfile(user)) {
    await context.send({ message: 'Сначала нужно заполнить активную анкету 🌙' });
    await resumeRegistration(context, user);
    return;
  }

  const profile = findNextProfile(user);
  if (!profile) {
    await context.send({
      message: 'Пока нет подходящих анкет в вашем городе 🌙 Когда появятся новые — бот покажет их здесь.',
      keyboard: menuKeyboard(context, user.id),
    });
    return;
  }

  await sendProfile(context, 'Анкета для знакомства 💞', profile, keyboards.browse(profile.id));
}

async function notifyLike(fromUser, toUser) {
  if (toUser.isMock) {
    return;
  }

  await sendProfileToUser(toUser.id, 'У вас симпатия ❤️', fromUser, keyboards.incomingLike(fromUser.id));
}

async function sendMatch(firstUser, secondUser) {
  if (!firstUser.isMock) {
    await sendToUser(
      firstUser.id,
      `У вас взаимная симпатия 🌙\nПрофиль партнёра: https://vk.com/id${secondUser.id}`,
      keyboards.mainMenu(isAdmin(firstUser.id), firstUser.gender),
    );
  }

  if (!secondUser.isMock) {
    await sendToUser(
      secondUser.id,
      `У вас взаимная симпатия 🌙\nПрофиль партнёра: https://vk.com/id${firstUser.id}`,
      keyboards.mainMenu(isAdmin(secondUser.id), secondUser.gender),
    );
  }
}

async function executeLike(user, profileId) {
  const target = store.getUser(profileId);
  if (!target || !target.profileComplete || !target.active) {
    return { ok: false, reason: 'unavailable' };
  }

  store.addLike(user.id, target.id, 'pending');
  const reverseLike = store.getLike(target.id, user.id);

  if (reverseLike && reverseLike.status === 'pending') {
    store.addLike(user.id, target.id, 'matched');
    store.addLike(target.id, user.id, 'matched');
    await sendMatch(user, target);
    return { ok: true, matched: true };
  }

  await notifyLike(user, target);
  return { ok: true, matched: false };
}

async function fulfillPendingLike(userId) {
  const user = store.getUser(userId);
  if (!user?.pendingLikeTarget) {
    return;
  }

  const targetId = user.pendingLikeTarget;
  store.updateUser(userId, { pendingLikeTarget: null });
  await executeLike(user, targetId);
}

async function handleLike(context, user, profileId, isBackLike = false) {
  const target = store.getUser(profileId);
  if (!target || !target.profileComplete || !target.active) {
    await context.send({ message: 'Эта анкета уже недоступна.' });
    return;
  }

  if (user.gender === 'male' && !store.isSubscribed(user)) {
    store.updateUser(user.id, { pendingLikeTarget: target.id });
    await createYookassaPayment(context, 'subscription');
    return;
  }

  const result = await executeLike(user, profileId);
  if (!result.ok) {
    await context.send({ message: 'Эта анкета уже недоступна.' });
    return;
  }

  if (result.matched) {
    return;
  }

  await context.send({
    message: isBackLike ? 'Симпатия отправлена ❤️' : 'Симпатия отправлена ❤️ Показываю следующую анкету.',
  });

  if (!isBackLike) {
    await browseProfiles(context, user);
  }
}

async function showFilters(context, user) {
  await context.send({
    message: 'Фильтр по возрасту:',
    keyboard: keyboards.filterAge(user),
  });

  await context.send({
    message: 'Фильтр по городу:',
    keyboard: keyboards.filterCity(user),
  });

  await context.send({
    message: 'Фильтр по стране:',
    keyboard: keyboards.filterCountry(user),
  });

  await context.send({
    message: 'Выберите параметры поиска и нажмите «Смотреть анкеты 💞».',
    keyboard: keyboards.filtersActions(),
  });
}

async function showIncomingLikes(context, user) {
  const likes = store.getIncomingLikes(user.id);
  if (!likes.length) {
    await context.send({ message: 'Пока новых лайков нет 🌙', keyboard: menuKeyboard(context, user.id) });
    return;
  }

  const fromUser = store.getUser(likes[0].fromId);
  if (!fromUser) {
    await context.send({ message: 'Лайк больше недоступен.' });
    return;
  }

  await sendProfile(context, 'Вам поставили лайк ❤️', fromUser, keyboards.incomingLike(fromUser.id));
}

async function showPay(context) {
  await createYookassaPayment(context, 'subscription');
}

async function showBoostTop(context) {
  await createYookassaPayment(context, 'boost');
}

async function showChannel(context) {
  const url = store.data.settings.channelUrl;
  await context.send({
    message: url ? `Наш канал 🌙\n${url}` : 'Ссылка на канал пока не настроена.',
    keyboard: menuKeyboard(context, context.senderId),
  });
}

async function showModerator(context) {
  const url = store.data.settings.moderatorUrl;
  await context.send({
    message: url ? `Связь с модератором 🤝\n${url}` : 'Ссылка на модератора пока не настроена.',
    keyboard: menuKeyboard(context, context.senderId),
  });
}

function adminUsersCounts() {
  return {
    male: store.listAdminPanelUsers('male').length,
    female: store.listAdminPanelUsers('female').length,
  };
}

async function showAdminUsersMenu(context) {
  const counts = adminUsersCounts();
  await context.send({
    message: 'Список пользователей',
    keyboard: keyboards.adminUsersMenu(counts.male, counts.female),
  });
}

async function showAdminUserPage(context, gender, page, mode = 'gender') {
  const users = store.listAdminPanelUsers(gender);
  const sectionTitle = gender === 'male' ? '👨 Парни' : '🧕 Девушки';

  if (!users.length) {
    const counts = adminUsersCounts();
    await context.send({
      message: `${sectionTitle}:\nПока никого нет.`,
      keyboard: keyboards.adminUsersMenu(counts.male, counts.female),
    });
    return;
  }

  const safePage = Math.max(0, Math.min(Number(page) || 0, users.length - 1));
  await sendAdminUserCard(context, users[safePage], {
    titlePrefix: sectionTitle,
    page: safePage,
    total: users.length,
    mode,
  });
}

function getAdminSearchUsers(adminUser) {
  const ids = adminUser.draft?.adminSearch?.ids || [];
  return ids.map((id) => store.getUser(id)).filter(Boolean);
}

async function showAdminSearchPage(context, adminUser, page) {
  const users = getAdminSearchUsers(adminUser);
  const query = adminUser.draft?.adminSearch?.query || '';

  if (!users.length) {
    await showAdminUsersMenu(context);
    return;
  }

  const safePage = Math.max(0, Math.min(Number(page) || 0, users.length - 1));
  const totalNote = users.length >= 100 ? '\n(показаны первые 100 совпадений)' : '';

  await sendAdminUserCard(context, users[safePage], {
    titlePrefix: `🔍 Поиск: «${query}»${totalNote}`,
    page: safePage,
    total: users.length,
    mode: 'search',
  });
}

async function sendAdminUserCard(context, profile, { titlePrefix, page, total, mode }) {
  const badges = [
    profile.blocked ? '🚫 заблокирован' : null,
    !profile.active ? '👁 скрыта из выдачи' : null,
    store.isSubscribed(profile) ? '💳 оплачен' : null,
  ].filter(Boolean);

  const title = [
    titlePrefix,
    `${page + 1} из ${total}`,
    badges.length ? badges.join(' · ') : null,
    `ID: ${profile.id}`,
  ].filter(Boolean).join('\n');

  await sendProfile(
    context,
    title,
    profile,
    keyboards.adminUserProfile(
      profile.id,
      profile.gender,
      page,
      total,
      Boolean(profile.blocked),
      mode,
      Boolean(profile.isMock),
    ),
  );
}

async function refreshAdminUserView(context, adminUser, payload) {
  if (payload?.mode === 'search') {
    await showAdminSearchPage(context, adminUser, payload.page);
    return;
  }
  await showAdminUserPage(context, payload.gender, payload.page, 'gender');
}

async function showUserMenu(context, user) {
  if (user.state.startsWith('admin_')) {
    store.updateUser(user.id, { state: 'ready', draft: {} });
  } else {
    store.updateUser(user.id, { state: 'ready' });
  }

  await context.send({
    message: 'Главное меню 🕌',
    keyboard: menuKeyboard(context, user.id),
  });
}

async function handleCommand(context, user, command) {
  switch (command) {
    case '/start':
      await resetRegistration(context, user);
      return true;
    case '/my_profile':
      await showMyProfile(context, user);
      return true;
    case '/browse_profiles':
      store.updateUser(user.id, { state: 'ready' });
      await browseProfiles(context, store.getUser(user.id));
      return true;
    case '/filters':
      await showFilters(context, user);
      return true;
    case '/edit_profile':
      await context.send({ message: 'Что хотите изменить?', keyboard: keyboards.editProfile() });
      return true;
    case '/all_likes':
      await showIncomingLikes(context, user);
      return true;
    case '/chanel':
    case '/channel':
      await showChannel(context);
      return true;
    case '/moderator':
      await showModerator(context);
      return true;
    case '/pay_for_bot':
      await showPay(context);
      return true;
    case '/delete':
      await context.send({ message: 'Удалить анкету из выдачи? Её можно будет восстановить командой /restore.', keyboard: keyboards.deleteConfirm() });
      return true;
    case '/restore':
      store.updateUser(user.id, { active: true });
      await context.send({ message: 'Анкета восстановлена и снова участвует в выдаче ✅', keyboard: menuKeyboard(context, user.id) });
      return true;
    case '/admin':
      if (isAdmin(user.id)) {
        await context.send({ message: 'Админ-панель ⚙️', keyboard: keyboards.admin() });
      } else {
        await context.send({ message: 'Команда /admin доступна только администраторам.' });
      }
      return true;
    default:
      return false;
  }
}

async function handleRegistrationState(context, user, text, payload) {
  if (user.state === 'ask_gender') {
    const selectedGender = payload?.action === 'set_gender' ? payload.gender : null;
    if (!selectedGender) {
      await context.send({ message: 'Пожалуйста, выберите пол кнопкой ниже.', keyboard: keyboards.gender() });
      return true;
    }

    store.updateDraft(user.id, { gender: selectedGender });
    store.updateUser(user.id, { state: 'ask_age' });
    await context.send({ message: registrationQuestion('ask_age') });
    return true;
  }

  if (user.state === 'ask_age') {
    const age = Number(text);
    if (!Number.isInteger(age) || age < 18 || age > 80) {
      await context.send({ message: 'Введите число от 18 до 80.' });
      return true;
    }

    store.updateDraft(user.id, { age });
    store.updateUser(user.id, { state: 'ask_city' });
    await context.send({ message: registrationQuestion('ask_city') });
    return true;
  }

  if (user.state === 'ask_city') {
    const city = normalizeCity(text);
    if (city.length < 2) {
      await context.send({ message: 'Введите корректное название города.' });
      return true;
    }

    store.updateDraft(user.id, { city });
    store.updateUser(user.id, { state: 'ask_name' });
    await context.send({ message: registrationQuestion('ask_name') });
    return true;
  }

  if (user.state === 'ask_name') {
    const name = normalizeText(text);
    if (name.length < 2 || name.length > 40) {
      await context.send({ message: 'Введите имя от 2 до 40 символов.' });
      return true;
    }

    store.updateDraft(user.id, { name });
    store.updateUser(user.id, { state: 'ask_about' });
    await context.send({ message: registrationQuestion('ask_about') });
    return true;
  }

  if (user.state === 'ask_about') {
    const about = normalizeText(text);
    if (about.length < 30) {
      await context.send({ message: 'Расскажите немного подробнее о себе, минимум 30 символов.' });
      return true;
    }

    if (hasContacts(about)) {
      await context.send({ message: 'Личные контакты запрещены. Уберите телефон, ссылки или @ник и отправьте описание снова.' });
      return true;
    }

    store.updateDraft(user.id, { about });
    store.updateUser(user.id, { state: 'ask_photo' });
    await context.send({ message: registrationQuestion('ask_photo') });
    return true;
  }

  if (user.state === 'ask_photo') {
    const saved = await persistIncomingPhoto(context, await getPhotoAttachment(context));
    if (!saved.photo) {
      await context.send({ message: 'Пришлите фото — без него анкета не будет опубликована.' });
      return true;
    }

    store.updateDraft(user.id, saved);
    store.updateUser(user.id, { state: 'confirm_profile' });
    await previewProfile(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'confirm_profile') {
    if (payload?.action === 'confirm_profile' || text.toLowerCase() === 'да') {
      const profile = { ...user, ...user.draft };
      if (!profile.photo) {
        store.updateUser(user.id, { state: 'ask_photo' });
        await context.send({ message: registrationQuestion('ask_photo') });
        return true;
      }

      const completed = store.completeProfile(user.id);
      await browseProfiles(context, completed);
      return true;
    }

    if (payload?.action === 'edit_profile' || text.toLowerCase().includes('изменить')) {
      await context.send({ message: 'Что хотите изменить?', keyboard: keyboards.editProfile() });
      return true;
    }

    const editFieldByText = {
      пол: 'gender',
      возраст: 'age',
      город: 'city',
      имя: 'name',
      описание: 'about',
      фото: 'photo',
    };
    const editField = editFieldByText[text.toLowerCase()];
    if (editField) {
      await handleEditField(context, user, editField);
      return true;
    }

    if (payload?.action) {
      return false;
    }

    await context.send({ message: 'Ответьте "Да" или нажмите "Изменить анкету".', keyboard: keyboards.confirmProfile() });
    return true;
  }

  return false;
}

async function handleEditField(context, user, field) {
  const stateByField = {
    age: 'edit_age',
    city: 'edit_city',
    name: 'edit_name',
    about: 'edit_about',
    photo: 'edit_photo',
  };

  if (field === 'gender') {
    store.updateUser(user.id, { state: 'edit_gender' });
    await context.send({ message: 'Выберите пол:', keyboard: keyboards.gender() });
    return;
  }

  store.updateUser(user.id, { state: stateByField[field] || 'ready' });
  const question = registrationQuestion(stateByField[field]?.replace('edit_', 'ask_')) || 'Отправьте новое значение.';
  await context.send({ message: question });
}

async function finishAfterEdit(context, user) {
  const fresh = store.getUser(user.id);
  if (!fresh.profileComplete && isProfileDataComplete({ ...fresh, ...fresh.draft })) {
    store.updateUser(fresh.id, { state: 'confirm_profile' });
    await previewProfile(context, store.getUser(fresh.id));
    return;
  }

  await showMyProfile(context, fresh);
}

async function handleEditState(context, user, text, payload) {
  const saveEdit = (patch) => {
    if (!user.profileComplete) {
      store.updateDraft(user.id, patch);
    } else {
      store.updateUser(user.id, { ...patch, state: 'ready' });
    }
  };

  if (user.state === 'edit_gender') {
    const gender = payload?.action === 'set_gender' ? payload.gender : null;
    if (!gender) {
      await context.send({ message: 'Выберите пол кнопкой.', keyboard: keyboards.gender() });
      return true;
    }

    saveEdit({ gender });
    await finishAfterEdit(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_age') {
    const age = Number(text);
    if (!Number.isInteger(age) || age < 18 || age > 80) {
      await context.send({ message: 'Введите число от 18 до 80.' });
      return true;
    }

    saveEdit({ age });
    await finishAfterEdit(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_city') {
    const city = normalizeCity(text);
    if (city.length < 2) {
      await context.send({ message: 'Введите корректное название города.' });
      return true;
    }

    saveEdit({ city });
    await finishAfterEdit(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_name') {
    const name = normalizeText(text);
    if (name.length < 2 || name.length > 40) {
      await context.send({ message: 'Введите имя от 2 до 40 символов.' });
      return true;
    }

    saveEdit({ name });
    await finishAfterEdit(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_about') {
    const about = normalizeText(text);
    if (about.length < 30 || hasContacts(about)) {
      await context.send({ message: 'Описание должно быть подробнее 30 символов и без личных контактов.' });
      return true;
    }

    saveEdit({ about });
    await finishAfterEdit(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_photo') {
    const saved = await persistIncomingPhoto(context, await getPhotoAttachment(context));
    if (!saved.photo) {
      await context.send({ message: 'Пришлите фото — без него анкета не будет опубликована.' });
      return true;
    }

    saveEdit(saved);
    await finishAfterEdit(context, store.getUser(user.id));
    return true;
  }

  return false;
}

async function finishAdminEdit(context, adminUser) {
  const fresh = store.getUser(adminUser.id);
  const returnTo = fresh.draft?.adminEdit?.returnTo;
  const draft = { ...(fresh.draft || {}) };
  delete draft.adminEdit;
  store.updateUser(adminUser.id, { state: 'ready', draft });
  await context.send({ message: 'Анкета обновлена ✅' });
  if (returnTo) {
    await refreshAdminUserView(context, store.getUser(adminUser.id), returnTo);
  }
}

function getAdminEditTarget(adminUser) {
  const profileId = adminUser.draft?.adminEdit?.profileId;
  if (!profileId) {
    return null;
  }
  const target = store.getUser(profileId);
  if (!target?.isMock) {
    return null;
  }
  return target;
}

async function handleAdminEditField(context, adminUser, field) {
  const target = getAdminEditTarget(adminUser);
  if (!target) {
    await context.send({ message: 'Эту анкету нельзя редактировать.', keyboard: keyboards.admin() });
    store.updateUser(adminUser.id, { state: 'ready', draft: {} });
    return;
  }

  const stateByField = {
    gender: 'admin_edit_gender',
    age: 'admin_edit_age',
    city: 'admin_edit_city',
    name: 'admin_edit_name',
    about: 'admin_edit_about',
    photo: 'admin_edit_photo',
  };

  if (field === 'gender') {
    store.updateUser(adminUser.id, { state: 'admin_edit_gender' });
    await context.send({ message: 'Выберите пол:', keyboard: keyboards.adminEditGender() });
    return;
  }

  store.updateUser(adminUser.id, { state: stateByField[field] || 'ready' });
  const question = registrationQuestion(`ask_${field}`) || 'Отправьте новое значение.';
  await context.send({ message: question });
}

async function handleAdminEditPhoto(context, adminUser) {
  const target = getAdminEditTarget(adminUser);
  if (!target) {
    await context.send({ message: 'Эту анкету нельзя редактировать.', keyboard: keyboards.admin() });
    store.updateUser(adminUser.id, { state: 'ready', draft: {} });
    return true;
  }

  const saved = await persistIncomingPhoto(context, await getPhotoAttachment(context));
  if (!saved.photo) {
    await context.send({ message: 'Фото обязательно — пришлите изображение.' });
    return true;
  }

  store.updateUser(target.id, saved);
  await finishAdminEdit(context, adminUser);
  return true;
}

async function handleAdminEditState(context, adminUser, text) {
  const target = getAdminEditTarget(adminUser);
  if (!target) {
    await context.send({ message: 'Эту анкету нельзя редактировать.', keyboard: keyboards.admin() });
    store.updateUser(adminUser.id, { state: 'ready', draft: {} });
    return true;
  }

  if (adminUser.state === 'admin_edit_age') {
    const age = Number(text);
    if (!Number.isInteger(age) || age < 18 || age > 80) {
      await context.send({ message: 'Введите число от 18 до 80.' });
      return true;
    }
    store.updateUser(target.id, { age });
    await finishAdminEdit(context, adminUser);
    return true;
  }

  if (adminUser.state === 'admin_edit_city') {
    const city = normalizeCity(text);
    if (city.length < 2) {
      await context.send({ message: 'Введите корректное название города.' });
      return true;
    }
    store.updateUser(target.id, { city });
    await finishAdminEdit(context, adminUser);
    return true;
  }

  if (adminUser.state === 'admin_edit_name') {
    const name = normalizeText(text);
    if (name.length < 2 || name.length > 40) {
      await context.send({ message: 'Введите имя от 2 до 40 символов.' });
      return true;
    }
    store.updateUser(target.id, { name });
    await finishAdminEdit(context, adminUser);
    return true;
  }

  if (adminUser.state === 'admin_edit_about') {
    const about = normalizeText(text);
    if (about.length < 30 || hasContacts(about)) {
      await context.send({ message: 'Описание должно быть подробнее 30 символов и без личных контактов.' });
      return true;
    }
    store.updateUser(target.id, { about });
    await finishAdminEdit(context, adminUser);
    return true;
  }

  return false;
}

async function handleAdminAddPhoto(context, user) {
  const draft = user.draft || {};
  const saved = await persistIncomingPhoto(context, await getPhotoAttachment(context));
  if (!saved.photo) {
    await context.send({ message: 'Фото обязательно — пришлите изображение.' });
    return true;
  }

  const profile = {
    ...draft.adminProfile,
    ...saved,
  };

  if (!profile.gender || !profile.age || !profile.city || !profile.name || !profile.about) {
    await context.send({ message: 'Не хватает данных анкеты. Начните добавление заново.', keyboard: keyboards.admin() });
    store.updateUser(user.id, { state: 'ready', draft: {} });
    return true;
  }

  store.createMockProfile(profile);
  store.updateUser(user.id, { state: 'ready', draft: {} });
  await context.send({ message: 'Анкета добавлена в выдачу ✅', keyboard: keyboards.admin() });
  return true;
}

async function handleAdminState(context, user, text, payload) {
  if (payload?.action) {
    return false;
  }

  if (user.state === 'admin_add_photo') {
    return handleAdminAddPhoto(context, user);
  }

  if (user.state === 'admin_edit_photo') {
    return handleAdminEditPhoto(context, user);
  }

  if (user.state.startsWith('admin_edit_')) {
    if (!text) {
      return false;
    }
    return handleAdminEditState(context, user, text);
  }

  if (user.state === 'admin_search_user') {
    if (['отмена', 'cancel', 'назад'].includes(text.toLowerCase())) {
      store.updateUser(user.id, { state: 'ready', draft: {} });
      await showAdminUsersMenu(context);
      return true;
    }

    const results = store.searchAdminPanelUsers(text);
    if (!results.length) {
      await context.send({
        message: 'Никого не найдено. Попробуйте другой запрос или напишите «отмена».',
        keyboard: keyboards.adminSearchPrompt(),
      });
      return true;
    }

    store.updateDraft(user.id, {
      adminSearch: {
        query: normalizeText(text),
        ids: results.map((item) => item.id),
      },
    });
    store.updateUser(user.id, { state: 'ready' });
    await showAdminSearchPage(context, store.getUser(user.id), 0);
    return true;
  }

  if (!text) {
    return false;
  }

  if (user.state === 'admin_set_moderator') {
    store.updateSettings({ moderatorUrl: normalizeText(text) });
    store.updateUser(user.id, { state: 'ready' });
    await context.send({ message: 'Ссылка модератора сохранена ✅', keyboard: keyboards.admin() });
    return true;
  }

  if (user.state === 'admin_set_channel') {
    store.updateSettings({ channelUrl: normalizeText(text) });
    store.updateUser(user.id, { state: 'ready' });
    await context.send({ message: 'Ссылка канала сохранена ✅', keyboard: keyboards.admin() });
    return true;
  }

  if (!user.state.startsWith('admin_add_')) {
    return false;
  }

  const draft = user.draft || {};
  if (user.state === 'admin_add_age') {
    const age = Number(text);
    if (!Number.isInteger(age) || age < 18 || age > 80) {
      await context.send({ message: 'Введите возраст 18-80.' });
      return true;
    }

    store.updateDraft(user.id, { adminProfile: { ...draft.adminProfile, age } });
    store.updateUser(user.id, { state: 'admin_add_city' });
    await context.send({ message: 'Город анкеты:' });
    return true;
  }

  if (user.state === 'admin_add_city') {
    store.updateDraft(user.id, { adminProfile: { ...draft.adminProfile, city: normalizeCity(text) } });
    store.updateUser(user.id, { state: 'admin_add_name' });
    await context.send({ message: 'Имя анкеты:' });
    return true;
  }

  if (user.state === 'admin_add_name') {
    store.updateDraft(user.id, { adminProfile: { ...draft.adminProfile, name: normalizeText(text) } });
    store.updateUser(user.id, { state: 'admin_add_about' });
    await context.send({ message: 'Описание анкеты:' });
    return true;
  }

  if (user.state === 'admin_add_about') {
    store.updateDraft(user.id, { adminProfile: { ...draft.adminProfile, about: normalizeText(text) } });
    store.updateUser(user.id, { state: 'admin_add_photo' });
    await context.send({ message: 'Пришлите фото для анкеты:' });
    return true;
  }

  return false;
}

async function handlePayload(context, user, payload) {
  if (!payload?.action) {
    return false;
  }

  switch (payload.action) {
    case 'start_bot':
      await resumeRegistration(context, store.getUser(user.id));
      return true;
    case 'menu':
      await showUserMenu(context, store.getUser(user.id));
      return true;
    case 'my_profile':
      await showMyProfile(context, user);
      return true;
    case 'browse':
      store.updateUser(user.id, { state: 'ready' });
      await browseProfiles(context, store.getUser(user.id));
      return true;
    case 'filters':
      await showFilters(context, user);
      return true;
    case 'all_likes':
      await showIncomingLikes(context, user);
      return true;
    case 'edit_profile':
      await context.send({ message: 'Что хотите изменить?', keyboard: keyboards.editProfile() });
      return true;
    case 'edit_field':
      await handleEditField(context, user, payload.field);
      return true;
    case 'like':
      await handleLike(context, user, payload.profileId);
      return true;
    case 'skip':
      store.rejectProfile(user.id, payload.profileId);
      await browseProfiles(context, store.getUser(user.id));
      return true;
    case 'like_back':
      await handleLike(context, user, payload.profileId, true);
      return true;
    case 'reject_like':
      store.rejectProfile(user.id, payload.profileId);
      await context.send({ message: 'Анкета пропущена.', keyboard: menuKeyboard(context, user.id) });
      return true;
    case 'pay':
      await showPay(context);
      return true;
    case 'boost_top':
      await showBoostTop(context);
      return true;
    case 'channel':
      await showChannel(context);
      return true;
    case 'moderator':
      await showModerator(context);
      return true;
    case 'filter_age_set': {
      const preset = keyboards.getAgePresetById(payload.preset);
      if (!preset) {
        return true;
      }
      store.updateUser(user.id, {
        filters: { ...user.filters, ageFrom: preset.ageFrom, ageTo: preset.ageTo },
        state: 'ready',
      });
      await showFilters(context, store.getUser(user.id));
      return true;
    }
    case 'filter_age_default': {
      const range = keyboards.getDefaultAgeRange(user);
      store.updateUser(user.id, {
        filters: { ...user.filters, ageFrom: range.ageFrom, ageTo: range.ageTo },
        state: 'ready',
      });
      await showFilters(context, store.getUser(user.id));
      return true;
    }
    case 'filter_city_my':
      store.updateUser(user.id, { filters: { ...user.filters, city: '' }, state: 'ready' });
      await showFilters(context, store.getUser(user.id));
      return true;
    case 'filter_city_all':
      store.updateUser(user.id, { filters: { ...user.filters, city: ALL_CITIES }, state: 'ready' });
      await showFilters(context, store.getUser(user.id));
      return true;
    case 'filter_country_ru':
      store.updateUser(user.id, { filters: { ...user.filters, country: 'RU' }, state: 'ready' });
      await showFilters(context, store.getUser(user.id));
      return true;
    case 'filter_country_all':
      store.updateUser(user.id, { filters: { ...user.filters, country: '' }, state: 'ready' });
      await showFilters(context, store.getUser(user.id));
      return true;
    case 'filter_reset':
      store.updateUser(user.id, { filters: defaultFilters(), state: 'ready' });
      await showFilters(context, store.getUser(user.id));
      return true;
    case 'delete_confirm':
      store.updateUser(user.id, { active: false });
      await context.send({ message: 'Анкета скрыта из выдачи. Восстановить можно командой /restore.', keyboard: menuKeyboard(context, user.id) });
      return true;
    case 'admin':
      if (isAdmin(user.id)) {
        await context.send({ message: 'Админ-панель ⚙️', keyboard: keyboards.admin() });
      } else {
        await context.send({ message: 'Админ-панель доступна только администраторам.' });
      }
      return true;
    case 'admin_stats': {
      if (!isAdmin(user.id)) return true;
      const stats = store.getStats();
      await context.send({
        message: [
          'Статистика 📊',
          `Всего анкет: ${stats.total}`,
          `Реальные пользователи: ${stats.real}`,
          `Добавленные анкеты: ${stats.mock}`,
          `Парни: ${stats.men}`,
          `Девушки: ${stats.women}`,
          `Активные: ${stats.active}`,
          `Оплатившие: ${stats.paid}`,
          `Лайки: ${stats.likes}`,
        ].join('\n'),
        keyboard: keyboards.admin(),
      });
      return true;
    }
    case 'admin_users':
      if (!isAdmin(context.senderId)) return true;
      store.updateUser(user.id, { state: 'ready', draft: {} });
      await showAdminUsersMenu(context);
      return true;
    case 'admin_search':
      if (!isAdmin(context.senderId)) return true;
      store.updateUser(user.id, { state: 'admin_search_user', draft: {} });
      await context.send({
        message: 'Введите для поиска: имя, город, ID или возраст.',
        keyboard: keyboards.adminSearchPrompt(),
      });
      return true;
    case 'admin_search_page':
      if (!isAdmin(context.senderId)) return true;
      await showAdminSearchPage(context, store.getUser(user.id), payload.page);
      return true;
    case 'admin_users_gender':
      if (!isAdmin(context.senderId)) return true;
      await showAdminUserPage(context, payload.gender, payload.page);
      return true;
    case 'admin_user_edit': {
      if (!isAdmin(context.senderId)) return true;
      const editTarget = store.getUser(payload.profileId);
      if (!editTarget?.isMock) {
        await context.send({ message: 'Редактировать можно только анкеты, добавленные через админку.' });
        await refreshAdminUserView(context, store.getUser(user.id), payload);
        return true;
      }
      store.updateDraft(user.id, {
        adminEdit: {
          profileId: editTarget.id,
          returnTo: {
            gender: payload.gender,
            page: payload.page,
            mode: payload.mode || 'gender',
          },
        },
      });
      store.updateUser(user.id, { state: 'ready' });
      await context.send({ message: 'Что изменить?', keyboard: keyboards.adminEditProfile() });
      return true;
    }
    case 'admin_edit_field':
      if (!isAdmin(context.senderId)) return true;
      await handleAdminEditField(context, store.getUser(user.id), payload.field);
      return true;
    case 'admin_edit_set_gender': {
      if (!isAdmin(context.senderId)) return true;
      const target = getAdminEditTarget(store.getUser(user.id));
      if (!target) {
        await context.send({ message: 'Эту анкету нельзя редактировать.', keyboard: keyboards.admin() });
        return true;
      }
      if (!payload.gender) {
        await context.send({ message: 'Выберите пол кнопкой.', keyboard: keyboards.adminEditGender() });
        return true;
      }
      store.updateUser(target.id, { gender: payload.gender });
      await finishAdminEdit(context, store.getUser(user.id));
      return true;
    }
    case 'admin_edit_done': {
      if (!isAdmin(context.senderId)) return true;
      const adminUser = store.getUser(user.id);
      const returnTo = adminUser.draft?.adminEdit?.returnTo;
      const draft = { ...(adminUser.draft || {}) };
      delete draft.adminEdit;
      store.updateUser(user.id, { state: 'ready', draft });
      if (returnTo) {
        await refreshAdminUserView(context, store.getUser(user.id), returnTo);
      } else {
        await showAdminUsersMenu(context);
      }
      return true;
    }
    case 'admin_user_block': {
      if (!isAdmin(context.senderId)) return true;
      if (String(payload.profileId) === String(context.senderId)) {
        await context.send({ message: 'Нельзя заблокировать свой аккаунт.' });
        await refreshAdminUserView(context, store.getUser(user.id), payload);
        return true;
      }
      const target = store.getUser(payload.profileId);
      if (!target) {
        await context.send({ message: 'Пользователь не найден.', keyboard: keyboards.admin() });
        return true;
      }
      store.blockUser(target.id);
      await context.send({ message: `Пользователь ${target.name || target.id} заблокирован 🚫` });
      await refreshAdminUserView(context, store.getUser(user.id), payload);
      return true;
    }
    case 'admin_user_unblock': {
      if (!isAdmin(context.senderId)) return true;
      const target = store.getUser(payload.profileId);
      if (!target) {
        await context.send({ message: 'Пользователь не найден.', keyboard: keyboards.admin() });
        return true;
      }
      store.unblockUser(target.id);
      await context.send({ message: `Пользователь ${target.name || target.id} разблокирован ✅` });
      await refreshAdminUserView(context, store.getUser(user.id), payload);
      return true;
    }
    case 'admin_user_delete': {
      if (!isAdmin(context.senderId)) return true;
      if (String(payload.profileId) === String(context.senderId)) {
        await context.send({ message: 'Нельзя удалить свой аккаунт.' });
        await refreshAdminUserView(context, store.getUser(user.id), payload);
        return true;
      }
      const target = store.getUser(payload.profileId);
      if (!target) {
        await context.send({ message: 'Пользователь не найден.', keyboard: keyboards.admin() });
        return true;
      }
      await context.send({
        message: `Удалить анкету ${target.name || target.id}? Это действие необратимо.`,
        keyboard: keyboards.adminUserDeleteConfirm(payload.profileId, payload.gender, payload.page, payload.mode || 'gender'),
      });
      return true;
    }
    case 'admin_user_delete_confirm': {
      if (!isAdmin(context.senderId)) return true;
      const target = store.getUser(payload.profileId);
      if (!target) {
        await context.send({ message: 'Пользователь не найден.', keyboard: keyboards.admin() });
        return true;
      }
      const name = target.name || target.id;
      const adminUser = store.getUser(user.id);
      if (payload.mode === 'search' && adminUser.draft?.adminSearch?.ids) {
        const ids = adminUser.draft.adminSearch.ids.filter((id) => id !== target.id);
        store.updateDraft(user.id, { adminSearch: { ...adminUser.draft.adminSearch, ids } });
      }
      store.deleteUser(target.id);
      await context.send({ message: `Анкета ${name} удалена 🗑` });
      if (payload.mode === 'search') {
        const fresh = store.getUser(user.id);
        const remaining = getAdminSearchUsers(fresh);
        if (!remaining.length) {
          await showAdminUsersMenu(context);
        } else {
          const nextPage = Math.min(payload.page, remaining.length - 1);
          await showAdminSearchPage(context, fresh, nextPage);
        }
      } else {
        await showAdminUserPage(context, payload.gender, payload.page);
      }
      return true;
    }
    case 'admin_add':
      if (!isAdmin(user.id)) return true;
      store.updateUser(user.id, {
        state: 'admin_add_age',
        draft: { adminProfile: { gender: payload.gender, country: '' } },
      });
      await context.send({ message: 'Возраст новой анкеты:' });
      return true;
    case 'admin_moderator':
      if (!isAdmin(user.id)) return true;
      store.updateUser(user.id, { state: 'admin_set_moderator' });
      await context.send({ message: 'Отправьте ссылку на модератора:' });
      return true;
    case 'admin_channel':
      if (!isAdmin(user.id)) return true;
      store.updateUser(user.id, { state: 'admin_set_channel' });
      await context.send({ message: 'Отправьте ссылку на канал:' });
      return true;
    default:
      return false;
  }
}

async function handleFilterState(context, user, text) {
  return false;
}

vk.updates.on('message_new', async (context) => {
  if (context.isOutbox) {
    return;
  }

  const user = recoverUserState(store.ensureUser(context.senderId));

  if (user.blocked && !isAdmin(context.senderId)) {
    await context.send({ message: 'Доступ к боту заблокирован администратором.' });
    return;
  }

  const text = normalizeText(context.text || '');
  const payload = parsePayload(context);
  const command = text.toLowerCase().split(' ')[0];

  try {
    if (command.startsWith('/') && (await handleCommand(context, user, command))) {
      return;
    }

    const startWords = ['начать', 'start', 'привет', 'здравствуйте', 'меню'];
    if (!user.profileComplete && startWords.includes(text.toLowerCase())) {
      await resumeRegistration(context, store.getUser(user.id));
      return;
    }

    if (await handleRegistrationState(context, store.getUser(user.id), text, payload)) {
      return;
    }

    if (await handleEditState(context, store.getUser(user.id), text, payload)) {
      return;
    }

    if (store.getUser(user.id).state.startsWith('admin_')) {
      if (await handleAdminState(context, store.getUser(user.id), text, payload)) {
        return;
      }
    }

    if (await handleFilterState(context, store.getUser(user.id), text)) {
      return;
    }

    if (await handlePayload(context, store.getUser(user.id), payload)) {
      return;
    }

    if (!user.profileComplete) {
      if (!text && !payload?.action) {
        await context.send({
          message: 'Ас-саляму алейкум! 🌙 Добро пожаловать в бот знакомств для мусульман.',
          keyboard: keyboards.welcome(),
        });
        return;
      }
      await resumeRegistration(context, user);
      return;
    }

    await context.send({
      message: commandsText(user.id),
      keyboard: menuKeyboard(context, user.id),
    });
  } catch (error) {
    console.error(error);
    await context.send({ message: 'Произошла ошибка. Попробуйте ещё раз или напишите модератору.' });
  }
});

const paymentConfig = payments.getPaymentConfig();
if (payments.isPaymentConfigured()) {
  startWebhookServer({
    port: paymentConfig.webhookPort,
    path: paymentConfig.webhookPath,
    onEvent: onYookassaWebhook,
  });
}

vk.updates.startPolling()
  .then(() => {
    const paymentStatus = payments.isPaymentConfigured()
      ? `ЮKassa (${paymentConfig.testMode ? 'тест' : 'боевой'}, подписка ${paymentConfig.subscriptionAmountRub} ₽, топ ${paymentConfig.boostAmountRub} ₽)`
      : 'ЮKassa не настроена';
    console.log(`Бот запущен. Админы: ${ADMIN_IDS.join(', ') || 'не заданы'}. ${paymentStatus}.`);
  })
  .catch((error) => {
    console.error('Не удалось запустить бота:', error);
    process.exit(1);
  });
