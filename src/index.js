require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { VK } = require('vk-io');
const { Store } = require('./store');
const keyboards = require('./keyboards');

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

const TOKEN = process.env.VK_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

if (!TOKEN) {
  throw new Error('VK_TOKEN is required. Copy .env.example to .env and set your group token.');
}

const vk = new VK({ token: TOKEN });
const store = new Store();

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
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

function getPhotoAttachment(context) {
  const photo = (context.attachments || []).find((attachment) => attachment.type === 'photo');
  return photo ? photo.toString() : '';
}

function hasContacts(text = '') {
  return /(\+?\d[\d\s().-]{7,}|https?:\/\/|vk\.com|t\.me|@\w+)/i.test(text);
}

function isFilterCancel(text = '') {
  return ['отмена', 'cancel', 'назад', 'сброс'].includes(normalizeText(text).toLowerCase());
}

function parseAgeFilter(text = '') {
  const value = normalizeText(text);
  const rangeMatch = value.match(/^(\d{1,2})\s*[-–—]\s*(\d{1,2})$/);
  if (rangeMatch) {
    return { ageFrom: Number(rangeMatch[1]), ageTo: Number(rangeMatch[2]) };
  }

  const single = Number(value);
  if (Number.isInteger(single)) {
    return { ageFrom: single, ageTo: single };
  }

  return null;
}

function defaultFilters() {
  return { ageFrom: 18, ageTo: 80, city: '', country: '' };
}

function isProfileDataComplete(user) {
  return Boolean(
    user.gender
    && user.age
    && user.city
    && user.name
    && user.about
    && user.about.length >= 30,
  );
}

function getResumeState(user) {
  const profile = { ...user, ...user.draft };
  if (!profile.gender) return 'ask_gender';
  if (!profile.age) return 'ask_age';
  if (!profile.city) return 'ask_city';
  if (!profile.name) return 'ask_name';
  if (!profile.about) return 'ask_about';
  if (user.state === 'ask_photo') return 'ask_photo';
  if (isProfileDataComplete(user)) return 'confirm_profile';
  return 'ask_photo';
}

function recoverUserState(user) {
  if (user.profileComplete || !isProfileDataComplete(user)) {
    return user;
  }

  if (user.state === 'confirm_profile' || user.state === 'ask_photo') {
    return user;
  }

  return store.updateUser(user.id, { state: 'confirm_profile' });
}

function debugLog(hypothesisId, location, message, data = {}) {
  fetch('http://127.0.0.1:7592/ingest/4acb8ae7-3361-4208-8d2c-4ed04750a4c9', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a7623c' }, body: JSON.stringify({ sessionId: 'a7623c', runId: 'runtime', hypothesisId, location, message, data, timestamp: Date.now() }) }).catch(() => {});
}

function profileText(profile) {
  const city = profile.city ? `, ${profile.city}` : '';
  const country = profile.country ? `, ${profile.country}` : '';
  return `${profile.name}, ${profile.age}${city}${country}\n\n${profile.about}`;
}

async function sendProfile(context, title, profile, keyboard) {
  const message = `${title}\n\n${profileText(profile)}`;
  if (profile.photo) {
    await context.send({ message, attachment: profile.photo, keyboard });
    return;
  }

  await context.send({ message, keyboard });
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
    '/filters — Фильтр поиска (необязательно)',
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
      return 'Теперь пришлите фото. Можно просто аватарку любую. Вашу фотографию будут видеть другие пользователи. Или просто напишите слово "Пропустить" чтобы продолжить без фото.';
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
  store.updateUser(fresh.id, { state });

  if (state === 'ask_gender') {
    await context.send({
      message: 'Ас-саляму алейкум! 🌙 Давайте создадим анкету для серьёзного знакомства. Выберите ваш пол:',
      keyboard: keyboards.gender(),
    });
    return;
  }

  await context.send({ message: registrationQuestion(state) });
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

  await sendProfile(context, 'Ваша анкета 🕌', user, keyboards.mainMenu(isAdmin(user.id)));
}

function findNextProfile(user) {
  const wantedGender = user.gender === 'male' ? 'female' : 'male';
  const skippedIds = new Set(
    store.data.likes
      .filter((like) => like.fromId === String(user.id))
      .map((like) => like.toId),
  );

  return store
    .listProfiles()
    .filter((profile) => profile.id !== String(user.id))
    .filter((profile) => profile.profileComplete && profile.active)
    .filter((profile) => profile.gender === wantedGender)
    .filter((profile) => !skippedIds.has(profile.id))
    .filter((profile) => {
      const cityFilter = user.filters.city || user.city;
      if (cityFilter && profile.city.toLowerCase() !== cityFilter.toLowerCase()) {
        return false;
      }

      if (user.filters.country && profile.country.toLowerCase() !== user.filters.country.toLowerCase()) {
        return false;
      }

      return profile.age >= user.filters.ageFrom && profile.age <= user.filters.ageTo;
    })[0];
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
      message: 'Пока нет подходящих анкет в вашем городе 🌙 Когда появятся новые — бот покажет их здесь. При необходимости настройте поиск командой /filters.',
      keyboard: keyboards.mainMenu(isAdmin(user.id)),
    });
    return;
  }

  await sendProfile(context, 'Анкета для знакомства 💞', profile, keyboards.browse(profile.id));
}

async function notifyLike(fromUser, toUser) {
  if (toUser.isMock) {
    return;
  }

  await sendToUser(
    toUser.id,
    `У вас симпатия ❤️\n\n${profileText(fromUser)}`,
    keyboards.incomingLike(fromUser.id),
    fromUser.photo,
  );
}

async function sendMatch(firstUser, secondUser) {
  if (!firstUser.isMock) {
    await sendToUser(
      firstUser.id,
      `У вас взаимная симпатия 🌙\nПрофиль партнёра: https://vk.com/id${secondUser.id}`,
      keyboards.mainMenu(isAdmin(firstUser.id)),
    );
  }

  if (!secondUser.isMock) {
    await sendToUser(
      secondUser.id,
      `У вас взаимная симпатия 🌙\nПрофиль партнёра: https://vk.com/id${firstUser.id}`,
      keyboards.mainMenu(isAdmin(secondUser.id)),
    );
  }
}

async function handleLike(context, user, profileId, isBackLike = false) {
  const target = store.getUser(profileId);
  if (!target || !target.profileComplete || !target.active) {
    await context.send({ message: 'Эта анкета уже недоступна.' });
    return;
  }

  if (user.gender === 'male' && !store.isSubscribed(user)) {
    store.updateUser(user.id, { pendingLikeTarget: target.id });
    await context.send({
      message: [
        'Только мужчинам.',
        'Чтобы ставить лайки, оплатите доступ к боту.',
        'Нажмите «Заплатить».',
        'Платите один раз — никаких автосписаний и подписок. Доступ действует 30 дней, затем вы сами решаете, продлевать или нет.',
      ].join('\n'),
      keyboard: keyboards.pay(),
    });
    return;
  }

  store.addLike(user.id, target.id, 'pending');
  const reverseLike = store.getLike(target.id, user.id);

  if (reverseLike && reverseLike.status === 'pending') {
    store.addLike(user.id, target.id, 'matched');
    store.addLike(target.id, user.id, 'matched');
    await sendMatch(user, target);
    return;
  }

  await notifyLike(user, target);
  await context.send({
    message: isBackLike ? 'Симпатия отправлена ❤️' : 'Симпатия отправлена ❤️ Показываю следующую анкету.',
  });

  if (!isBackLike) {
    await browseProfiles(context, user);
  }
}

async function showFilters(context, user) {
  await context.send({
    message: [
      'Фильтр поиска 🔎',
      '',
      'По умолчанию бот уже ищет анкеты в вашем городе, возраст 18-80.',
      'Менять фильтры нужно только при желании.',
      '',
      'Фильтр по возрасту:',
      `${user.filters.ageFrom}-${user.filters.ageTo}`,
      'Фильтр по городу:',
      user.filters.city || user.city || 'ваш город',
      'Фильтр по стране:',
      user.filters.country || 'любая',
    ].join('\n'),
    keyboard: keyboards.filters(),
  });
}

async function showIncomingLikes(context, user) {
  const likes = store.getIncomingLikes(user.id);
  if (!likes.length) {
    await context.send({ message: 'Пока новых лайков нет 🌙', keyboard: keyboards.mainMenu(isAdmin(user.id)) });
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
  await context.send({
    message: [
      'Оплата доступа к боту 💳',
      'Стоимость: 600 ₽.',
      'Платёжная система будет подключена на последнем этапе, поэтому сейчас кнопка только подготовлена.',
    ].join('\n'),
    keyboard: keyboards.pay(),
  });
}

async function showChannel(context) {
  const url = store.data.settings.channelUrl;
  await context.send({
    message: url ? `Наш канал 🌙\n${url}` : 'Ссылка на канал пока не настроена.',
    keyboard: keyboards.mainMenu(isAdmin(context.senderId)),
  });
}

async function showModerator(context) {
  const url = store.data.settings.moderatorUrl;
  await context.send({
    message: url ? `Связь с модератором 🤝\n${url}` : 'Ссылка на модератора пока не настроена.',
    keyboard: keyboards.mainMenu(isAdmin(context.senderId)),
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
      await context.send({ message: 'Анкета восстановлена и снова участвует в выдаче ✅', keyboard: keyboards.mainMenu(isAdmin(user.id)) });
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
    const photo = getPhotoAttachment(context);
    if (!photo && text.toLowerCase() !== 'пропустить') {
      await context.send({ message: 'Пришлите фото или напишите "Пропустить".' });
      return true;
    }

    store.updateDraft(user.id, { photo });
    store.updateUser(user.id, { state: 'confirm_profile' });
    await previewProfile(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'confirm_profile') {
    if (payload?.action === 'confirm_profile' || text.toLowerCase() === 'да') {
      const completed = store.completeProfile(user.id);
      await browseProfiles(context, completed);
      return true;
    }

    if (payload?.action === 'edit_profile' || text.toLowerCase().includes('изменить')) {
      await context.send({ message: 'Что хотите изменить?', keyboard: keyboards.editProfile() });
      return true;
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
  await context.send({ message: registrationQuestion(stateByField[field]?.replace('edit_', 'ask_')) || 'Отправьте новое значение.' });
}

async function handleEditState(context, user, text, payload) {
  if (user.state === 'edit_gender') {
    const gender = payload?.action === 'set_gender' ? payload.gender : null;
    if (!gender) {
      await context.send({ message: 'Выберите пол кнопкой.', keyboard: keyboards.gender() });
      return true;
    }

    store.updateUser(user.id, { gender, state: 'ready' });
    await showMyProfile(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_age') {
    const age = Number(text);
    if (!Number.isInteger(age) || age < 18 || age > 80) {
      await context.send({ message: 'Введите число от 18 до 80.' });
      return true;
    }

    store.updateUser(user.id, { age, state: 'ready' });
    await showMyProfile(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_city') {
    const city = normalizeCity(text);
    if (city.length < 2) {
      await context.send({ message: 'Введите корректное название города.' });
      return true;
    }

    store.updateUser(user.id, { city, state: 'ready' });
    await showMyProfile(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_name') {
    const name = normalizeText(text);
    if (name.length < 2 || name.length > 40) {
      await context.send({ message: 'Введите имя от 2 до 40 символов.' });
      return true;
    }

    store.updateUser(user.id, { name, state: 'ready' });
    await showMyProfile(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_about') {
    const about = normalizeText(text);
    if (about.length < 30 || hasContacts(about)) {
      await context.send({ message: 'Описание должно быть подробнее 30 символов и без личных контактов.' });
      return true;
    }

    store.updateUser(user.id, { about, state: 'ready' });
    await showMyProfile(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'edit_photo') {
    const photo = getPhotoAttachment(context);
    if (!photo && text.toLowerCase() !== 'пропустить') {
      await context.send({ message: 'Пришлите фото или напишите "Пропустить".' });
      return true;
    }

    store.updateUser(user.id, { photo, state: 'ready' });
    await showMyProfile(context, store.getUser(user.id));
    return true;
  }

  return false;
}

async function handleAdminState(context, user, text) {
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
    await context.send({ message: 'Пришлите фото для анкеты (или напишите "Пропустить"):' });
    return true;
  }

  if (user.state === 'admin_add_photo') {
    const photo = getPhotoAttachment(context);
    if (!photo && text.toLowerCase() !== 'пропустить') {
      await context.send({ message: 'Пришлите фото или напишите "Пропустить".' });
      return true;
    }

    const profile = {
      ...draft.adminProfile,
      photo: photo || '',
    };
    store.createMockProfile(profile);
    store.updateUser(user.id, { state: 'ready', draft: {} });
    await context.send({ message: 'Анкета добавлена в выдачу ✅', keyboard: keyboards.admin() });
    return true;
  }

  return false;
}

async function handlePayload(context, user, payload) {
  if (!payload?.action) {
    return false;
  }

  switch (payload.action) {
    case 'menu':
      store.updateUser(user.id, { state: 'ready' });
      await context.send({ message: commandsText(user.id), keyboard: keyboards.mainMenu(isAdmin(user.id)) });
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
      await context.send({ message: 'Анкета пропущена.', keyboard: keyboards.mainMenu(isAdmin(user.id)) });
      return true;
    case 'pay':
      await showPay(context);
      return true;
    case 'pay_click':
      await context.send({
        message: 'Оплата пока не подключена. Кнопка подготовлена для последнего этапа 💳',
        keyboard: keyboards.mainMenu(isAdmin(user.id)),
      });
      return true;
    case 'channel':
      await showChannel(context);
      return true;
    case 'moderator':
      await showModerator(context);
      return true;
    case 'filter_age':
      store.updateUser(user.id, { state: 'filter_age' });
      await context.send({
        message: 'Фильтр по возрасту (необязательно). По умолчанию: 18-80.\nВведите диапазон, например 18-35 или 25, либо «отмена».',
      });
      return true;
    case 'filter_city':
      store.updateUser(user.id, { state: 'filter_city' });
      await context.send({
        message: 'Фильтр по городу (необязательно). По умолчанию используется ваш город.\nВведите город или «отмена» / «сброс».',
      });
      return true;
    case 'filter_country':
      store.updateUser(user.id, { state: 'filter_country' });
      await context.send({
        message: 'Фильтр по стране (необязательно). По умолчанию: любая.\nВведите страну или «отмена» / «сброс».',
      });
      return true;
    case 'filter_reset':
      store.updateUser(user.id, { filters: defaultFilters(), state: 'ready' });
      await showFilters(context, store.getUser(user.id));
      return true;
    case 'delete_confirm':
      store.updateUser(user.id, { active: false });
      await context.send({ message: 'Анкета скрыта из выдачи. Восстановить можно командой /restore.', keyboard: keyboards.mainMenu(isAdmin(user.id)) });
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
          `Анкеты админа: ${stats.mock}`,
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
    case 'admin_users': {
      if (!isAdmin(user.id)) return true;
      const allUsers = store.listProfiles().filter(p => !p.isMock); // Исключаем тестовые анкеты для чистоты
      const guys = allUsers.filter(p => p.gender === 'male');
      const girls = allUsers.filter(p => p.gender === 'female');
      
      const formatUser = (p) => `- ${p.name || 'без имени'}, ${p.age || '-'}, ${p.city || '-'}${store.isSubscribed(p) ? ' 💳' : ''}`;
      
      let message = 'Список пользователей (последние зарегистрированные):\n\n';
      message += '👨 Парни:\n';
      message += guys.slice(-15).map(formatUser).join('\n') || 'Нет парней';
      message += '\n\n🧕 Девушки:\n';
      message += girls.slice(-15).map(formatUser).join('\n') || 'Нет девушек';

      await context.send({ message, keyboard: keyboards.admin() });
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
  if (user.state === 'filter_age') {
    if (isFilterCancel(text)) {
      store.updateUser(user.id, { state: 'ready' });
      await showFilters(context, store.getUser(user.id));
      return true;
    }

    const parsed = parseAgeFilter(text);
    if (!parsed) {
      await context.send({
        message: 'Не понял возраст. Примеры: 18-35, 25. Или напишите «отмена».',
      });
      return true;
    }

    const { ageFrom, ageTo } = parsed;
    if (ageFrom < 18 || ageTo > 80 || ageFrom > ageTo) {
      await context.send({ message: 'Возраст должен быть от 18 до 80, и «от» не больше «до».' });
      return true;
    }

    store.updateUser(user.id, { filters: { ...user.filters, ageFrom, ageTo }, state: 'ready' });
    await showFilters(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'filter_city') {
    if (isFilterCancel(text)) {
      store.updateUser(user.id, { filters: { ...user.filters, city: '' }, state: 'ready' });
      await showFilters(context, store.getUser(user.id));
      return true;
    }

    store.updateUser(user.id, { filters: { ...user.filters, city: normalizeCity(text) }, state: 'ready' });
    await showFilters(context, store.getUser(user.id));
    return true;
  }

  if (user.state === 'filter_country') {
    if (isFilterCancel(text)) {
      store.updateUser(user.id, { filters: { ...user.filters, country: '' }, state: 'ready' });
      await showFilters(context, store.getUser(user.id));
      return true;
    }

    store.updateUser(user.id, { filters: { ...user.filters, country: normalizeText(text) }, state: 'ready' });
    await showFilters(context, store.getUser(user.id));
    return true;
  }

  return false;
}

vk.updates.on('message_new', async (context) => {
  if (context.isOutbox) {
    return;
  }

  const user = recoverUserState(store.ensureUser(context.senderId));
  const text = normalizeText(context.text || '');
  const payload = parsePayload(context);
  const command = text.toLowerCase().split(' ')[0];

  try {
    // #region agent log
    debugLog('H1,H2', 'src/index.js:message_new', 'message received', {
      userIdTail: String(user.id).slice(-4),
      state: user.state,
      profileComplete: user.profileComplete,
      command,
      payloadAction: payload?.action || null,
    });
    // #endregion
    if (command.startsWith('/') && (await handleCommand(context, user, command))) {
      return;
    }

    if (await handleRegistrationState(context, store.getUser(user.id), text, payload)) {
      return;
    }

    if (await handleEditState(context, store.getUser(user.id), text, payload)) {
      return;
    }

    if (await handleAdminState(context, store.getUser(user.id), text)) {
      return;
    }

    if (await handleFilterState(context, store.getUser(user.id), text)) {
      return;
    }

    if (await handlePayload(context, store.getUser(user.id), payload)) {
      return;
    }

    if (!user.profileComplete) {
      await resumeRegistration(context, user);
      return;
    }

    await context.send({
      message: commandsText(user.id),
      keyboard: keyboards.mainMenu(isAdmin(user.id)),
    });
  } catch (error) {
    // #region agent log
    debugLog('H5', 'src/index.js:message_new', 'handler error', {
      userIdTail: String(user.id).slice(-4),
      errorName: error.name,
      errorMessage: error.message,
    });
    // #endregion
    console.error(error);
    await context.send({ message: 'Произошла ошибка. Попробуйте ещё раз или напишите модератору.' });
  }
});

vk.updates.startPolling()
  .then(() => {
    // #region agent log
    debugLog('H1', 'src/index.js:startPolling', 'bot started', { adminCount: ADMIN_IDS.length });
    // #endregion
    console.log('VK dating bot started');
  })
  .catch((error) => {
    console.error('Failed to start VK bot:', error);
    process.exit(1);
  });
