const { Keyboard } = require('vk-io');

function payload(action, data = {}) {
  return { action, ...data };
}

function mainMenu(isAdmin = false, gender = null) {
  const keyboard = Keyboard.builder();

  if (isAdmin) {
    keyboard
      .textButton({ label: 'Админ-панель ⚙️', payload: payload('admin'), color: Keyboard.NEGATIVE_COLOR })
      .row();
  }

  keyboard
    .textButton({ label: 'Моя анкета 🕌', payload: payload('my_profile'), color: Keyboard.POSITIVE_COLOR })
    .textButton({ label: 'Смотреть анкеты 💞', payload: payload('browse'), color: Keyboard.PRIMARY_COLOR })
    .row()
    .textButton({ label: 'Фильтр поиска 🔎', payload: payload('filters'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Лайки ❤️', payload: payload('all_likes'), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Изменить анкету ✏️', payload: payload('edit_profile'), color: Keyboard.SECONDARY_COLOR });

  if (gender === 'male') {
    keyboard.textButton({ label: 'Оплатить бот 💳', payload: payload('pay'), color: Keyboard.SECONDARY_COLOR });
  } else {
    keyboard.textButton({ label: 'Поднять в топ 🔝', payload: payload('boost_top'), color: Keyboard.SECONDARY_COLOR });
  }

  if (gender === 'male') {
    keyboard
      .row()
      .textButton({ label: 'Поднять в топ 🔝', payload: payload('boost_top'), color: Keyboard.SECONDARY_COLOR });
  }

  keyboard
    .row()
    .textButton({ label: 'Наш канал 🌙', payload: payload('channel'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Модератор 🤝', payload: payload('moderator'), color: Keyboard.SECONDARY_COLOR });

  return keyboard;
}

function welcome() {
  return Keyboard.builder()
    .textButton({ label: '▶️ Начать знакомства', payload: payload('start_bot'), color: Keyboard.POSITIVE_COLOR });
}

function gender() {
  return Keyboard.builder()
    .textButton({ label: 'Парень 👳‍♂️', payload: payload('set_gender', { gender: 'male' }), color: Keyboard.PRIMARY_COLOR })
    .textButton({ label: 'Девушка 🧕', payload: payload('set_gender', { gender: 'female' }), color: Keyboard.POSITIVE_COLOR })
    .oneTime();
}

function confirmProfile() {
  return Keyboard.builder()
    .textButton({ label: 'Изменить анкету ✏️', payload: payload('edit_profile'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Да ✅', payload: payload('confirm_profile'), color: Keyboard.POSITIVE_COLOR })
    .oneTime();
}

function editProfile() {
  return Keyboard.builder()
    .textButton({ label: 'Пол', payload: payload('edit_field', { field: 'gender' }), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Возраст', payload: payload('edit_field', { field: 'age' }), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Город', payload: payload('edit_field', { field: 'city' }), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Имя', payload: payload('edit_field', { field: 'name' }), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Описание', payload: payload('edit_field', { field: 'about' }), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Фото', payload: payload('edit_field', { field: 'photo' }), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Готово ✅', payload: payload('my_profile'), color: Keyboard.POSITIVE_COLOR });
}

function browse(profileId) {
  return Keyboard.builder()
    .textButton({ label: '❤️', payload: payload('like', { profileId }), color: Keyboard.POSITIVE_COLOR })
    .textButton({ label: '👎', payload: payload('skip', { profileId }), color: Keyboard.NEGATIVE_COLOR })
    .row()
    .textButton({ label: 'Меню 🕌', payload: payload('menu'), color: Keyboard.SECONDARY_COLOR });
}

function incomingLike(profileId) {
  return Keyboard.builder()
    .textButton({ label: '❤️ Ответить', payload: payload('like_back', { profileId }), color: Keyboard.POSITIVE_COLOR })
    .textButton({ label: '👎 Пропустить', payload: payload('reject_like', { profileId }), color: Keyboard.NEGATIVE_COLOR });
}

function paymentUrl(label, url) {
  return Keyboard.builder()
    .urlButton({ label, url })
    .row()
    .textButton({ label: 'Меню 🕌', payload: payload('menu'), color: Keyboard.SECONDARY_COLOR });
}

function labelWithCheck(label, selected) {
  return selected ? `${label} ✅` : label;
}

const AGE_PRESET_ROWS = [
  [
    { id: '18-25', ageFrom: 18, ageTo: 25, label: '18-25' },
    { id: '18-33', ageFrom: 18, ageTo: 33, label: '18-33' },
  ],
  [
    { id: '25-35', ageFrom: 25, ageTo: 35, label: '25-35' },
    { id: '25-39', ageFrom: 25, ageTo: 39, label: '25-39' },
  ],
  [
    { id: '35-45', ageFrom: 35, ageTo: 45, label: '35-45' },
    { id: '35-49', ageFrom: 35, ageTo: 49, label: '35-49' },
  ],
  [
    { id: '45-55', ageFrom: 45, ageTo: 55, label: '45-55' },
    { id: '49+', ageFrom: 49, ageTo: 80, label: '>49' },
  ],
];

function getDefaultAgeRange(user) {
  const age = user.age || 25;
  return {
    ageFrom: Math.max(18, age - 15),
    ageTo: Math.min(80, age + 15),
  };
}

function isAgeRangeSelected(filters, ageFrom, ageTo) {
  return filters.ageFrom === ageFrom && filters.ageTo === ageTo;
}

function filterAge(user) {
  const keyboard = Keyboard.builder();
  const defaultRange = getDefaultAgeRange(user);
  const isDefaultSelected = isAgeRangeSelected(user.filters, defaultRange.ageFrom, defaultRange.ageTo);

  AGE_PRESET_ROWS.forEach((row, rowIndex) => {
    if (rowIndex > 0) {
      keyboard.row();
    }
    row.forEach((preset) => {
      const selected = isAgeRangeSelected(user.filters, preset.ageFrom, preset.ageTo);
      keyboard.textButton({
        label: labelWithCheck(preset.label, selected),
        payload: payload('filter_age_set', { preset: preset.id }),
        color: Keyboard.SECONDARY_COLOR,
      });
    });
  });

  keyboard
    .row()
    .textButton({
      label: labelWithCheck('По умолчанию +-15', isDefaultSelected),
      payload: payload('filter_age_default'),
      color: Keyboard.SECONDARY_COLOR,
    });

  return keyboard;
}

function filterCity(user) {
  const myCity = user.city || 'Мой город';
  const isAll = user.filters.city === '*';

  return Keyboard.builder()
    .textButton({
      label: labelWithCheck(myCity, !isAll),
      payload: payload('filter_city_my'),
      color: Keyboard.SECONDARY_COLOR,
    })
    .textButton({
      label: labelWithCheck('Все города', isAll),
      payload: payload('filter_city_all'),
      color: Keyboard.SECONDARY_COLOR,
    });
}

function filterCountry(user) {
  const isRu = String(user.filters.country || '').toUpperCase() === 'RU';
  const isAll = !user.filters.country;

  return Keyboard.builder()
    .textButton({
      label: labelWithCheck('🇷🇺 RU', isRu),
      payload: payload('filter_country_ru'),
      color: Keyboard.SECONDARY_COLOR,
    })
    .textButton({
      label: labelWithCheck('Все страны', isAll),
      payload: payload('filter_country_all'),
      color: Keyboard.SECONDARY_COLOR,
    });
}

function filtersActions() {
  return Keyboard.builder()
    .textButton({ label: 'Сбросить', payload: payload('filter_reset'), color: Keyboard.NEGATIVE_COLOR })
    .textButton({ label: 'Смотреть анкеты 💞', payload: payload('browse'), color: Keyboard.PRIMARY_COLOR });
}

function getAgePresetById(id) {
  for (const row of AGE_PRESET_ROWS) {
    const preset = row.find((item) => item.id === id);
    if (preset) {
      return preset;
    }
  }
  return null;
}

function deleteConfirm() {
  return Keyboard.builder()
    .textButton({ label: 'Да, удалить', payload: payload('delete_confirm'), color: Keyboard.NEGATIVE_COLOR })
    .textButton({ label: 'Нет', payload: payload('menu'), color: Keyboard.SECONDARY_COLOR })
    .oneTime();
}

function admin() {
  return Keyboard.builder()
    .textButton({ label: 'Статистика 📊', payload: payload('admin_stats'), color: Keyboard.PRIMARY_COLOR })
    .textButton({ label: 'Пользователи 👥', payload: payload('admin_users'), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Добавить парня', payload: payload('admin_add', { gender: 'male' }), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Добавить девушку', payload: payload('admin_add', { gender: 'female' }), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Ссылка модератора', payload: payload('admin_moderator'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Ссылка на канал', payload: payload('admin_channel'), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Меню 🕌', payload: payload('menu'), color: Keyboard.SECONDARY_COLOR });
}

function adminUsersMenu(maleCount, femaleCount) {
  return Keyboard.builder()
    .textButton({
      label: `👨 Парни (${maleCount})`,
      payload: payload('admin_users_gender', { gender: 'male', page: 0 }),
      color: Keyboard.PRIMARY_COLOR,
    })
    .textButton({
      label: `🧕 Девушки (${femaleCount})`,
      payload: payload('admin_users_gender', { gender: 'female', page: 0 }),
      color: Keyboard.POSITIVE_COLOR,
    })
    .row()
    .textButton({ label: '🔍 Поиск', payload: payload('admin_search'), color: Keyboard.PRIMARY_COLOR })
    .row()
    .textButton({ label: '← Админ-панель', payload: payload('admin'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Меню 🕌', payload: payload('menu'), color: Keyboard.SECONDARY_COLOR });
}

function adminSearchPrompt() {
  return Keyboard.builder()
    .textButton({ label: '← Отмена', payload: payload('admin_users'), color: Keyboard.SECONDARY_COLOR });
}

function adminEditProfile() {
  return Keyboard.builder()
    .textButton({ label: 'Пол', payload: payload('admin_edit_field', { field: 'gender' }), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Возраст', payload: payload('admin_edit_field', { field: 'age' }), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Город', payload: payload('admin_edit_field', { field: 'city' }), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Имя', payload: payload('admin_edit_field', { field: 'name' }), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Описание', payload: payload('admin_edit_field', { field: 'about' }), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Фото', payload: payload('admin_edit_field', { field: 'photo' }), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Готово ✅', payload: payload('admin_edit_done'), color: Keyboard.POSITIVE_COLOR });
}

function adminEditGender() {
  return Keyboard.builder()
    .textButton({ label: 'Парень 👳‍♂️', payload: payload('admin_edit_set_gender', { gender: 'male' }), color: Keyboard.PRIMARY_COLOR })
    .textButton({ label: 'Девушка 🧕', payload: payload('admin_edit_set_gender', { gender: 'female' }), color: Keyboard.POSITIVE_COLOR })
    .oneTime();
}

function adminUserProfile(profileId, gender, page, total, isBlocked, mode = 'gender', canEdit = false) {
  const keyboard = Keyboard.builder();
  const listMode = mode === 'search' ? 'search' : 'gender';
  const prevAction = listMode === 'search' ? 'admin_search_page' : 'admin_users_gender';
  const prevPayload = listMode === 'search'
    ? { page: page - 1 }
    : { gender, page: page - 1 };
  const nextPayload = listMode === 'search'
    ? { page: page + 1 }
    : { gender, page: page + 1 };
  const actionPayload = (action) => payload(action, {
    profileId,
    gender,
    page,
    mode: listMode,
  });

  if (page > 0) {
    keyboard.textButton({
      label: '⬅️ Назад',
      payload: payload(prevAction, prevPayload),
      color: Keyboard.SECONDARY_COLOR,
    });
  }

  if (page < total - 1) {
    if (page > 0) {
      keyboard.row();
    }
    keyboard.textButton({
      label: 'Далее ➡️',
      payload: payload(prevAction, nextPayload),
      color: Keyboard.SECONDARY_COLOR,
    });
  }

  keyboard.row();

  if (isBlocked) {
    keyboard.textButton({
      label: '✅ Разблокировать',
      payload: actionPayload('admin_user_unblock'),
      color: Keyboard.POSITIVE_COLOR,
    });
  } else {
    keyboard.textButton({
      label: '🚫 Заблокировать',
      payload: actionPayload('admin_user_block'),
      color: Keyboard.NEGATIVE_COLOR,
    });
  }

  keyboard
    .textButton({
      label: '🗑 Удалить',
      payload: actionPayload('admin_user_delete'),
      color: Keyboard.NEGATIVE_COLOR,
    });

  if (canEdit) {
    keyboard.row().textButton({
      label: '✏️ Изменить',
      payload: actionPayload('admin_user_edit'),
      color: Keyboard.PRIMARY_COLOR,
    });
  }

  keyboard
    .row()
    .textButton({ label: '← К списку', payload: payload('admin_users'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Меню 🕌', payload: payload('menu'), color: Keyboard.SECONDARY_COLOR });

  return keyboard;
}

function adminUserDeleteConfirm(profileId, gender, page, mode = 'gender') {
  return Keyboard.builder()
    .textButton({
      label: 'Да, удалить',
      payload: payload('admin_user_delete_confirm', { profileId, gender, page, mode }),
      color: Keyboard.NEGATIVE_COLOR,
    })
    .textButton({
      label: 'Отмена',
      payload: payload(mode === 'search' ? 'admin_search_page' : 'admin_users_gender', mode === 'search' ? { page } : { gender, page }),
      color: Keyboard.SECONDARY_COLOR,
    });
}

module.exports = {
  admin,
  adminEditGender,
  adminEditProfile,
  adminUserDeleteConfirm,
  adminUserProfile,
  adminUsersMenu,
  adminSearchPrompt,
  browse,
  confirmProfile,
  deleteConfirm,
  editProfile,
  filterAge,
  filterCity,
  filterCountry,
  filtersActions,
  getAgePresetById,
  getDefaultAgeRange,
  welcome,
  gender,
  incomingLike,
  mainMenu,
  paymentUrl,
  payload,
};
