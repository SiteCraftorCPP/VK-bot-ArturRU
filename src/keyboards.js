const { Keyboard } = require('vk-io');

function payload(action, data = {}) {
  return { action, ...data };
}

function mainMenu(isAdmin = false) {
  const keyboard = Keyboard.builder()
    .textButton({ label: 'Моя анкета 🕌', payload: payload('my_profile'), color: Keyboard.POSITIVE_COLOR })
    .textButton({ label: 'Смотреть анкеты 💞', payload: payload('browse'), color: Keyboard.PRIMARY_COLOR })
    .row()
    .textButton({ label: 'Фильтр поиска 🔎', payload: payload('filters'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Лайки ❤️', payload: payload('all_likes'), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Изменить анкету ✏️', payload: payload('edit_profile'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Оплатить бот 💳', payload: payload('pay'), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Наш канал 🌙', payload: payload('channel'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Модератор 🤝', payload: payload('moderator'), color: Keyboard.SECONDARY_COLOR });

  if (isAdmin) {
    keyboard.row().textButton({ label: 'Админ-панель ⚙️', payload: payload('admin'), color: Keyboard.NEGATIVE_COLOR });
  }

  return keyboard;
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

function pay() {
  return Keyboard.builder()
    .textButton({ label: 'Заплатить 600 ₽ 💳', payload: payload('pay_click'), color: Keyboard.POSITIVE_COLOR })
    .row()
    .textButton({ label: 'Назад 🕌', payload: payload('menu'), color: Keyboard.SECONDARY_COLOR });
}

function filters() {
  return Keyboard.builder()
    .textButton({ label: 'Возраст', payload: payload('filter_age'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Город', payload: payload('filter_city'), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Страна', payload: payload('filter_country'), color: Keyboard.SECONDARY_COLOR })
    .textButton({ label: 'Сбросить', payload: payload('filter_reset'), color: Keyboard.NEGATIVE_COLOR })
    .row()
    .textButton({ label: 'Смотреть анкеты 💞', payload: payload('browse'), color: Keyboard.PRIMARY_COLOR });
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
    .textButton({ label: 'Ссылка канала', payload: payload('admin_channel'), color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Меню 🕌', payload: payload('menu'), color: Keyboard.SECONDARY_COLOR });
}

module.exports = {
  admin,
  browse,
  confirmProfile,
  deleteConfirm,
  editProfile,
  filters,
  gender,
  incomingLike,
  mainMenu,
  pay,
  payload,
};
