const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { Store } = require('../src/store');
const keyboards = require('../src/keyboards');
const payments = require('../src/payments');
const { findNextProfile, rankProfilesForBrowse } = require('../src/browse');

function assert(condition, name) {
  if (!condition) {
    throw new Error(`FAIL: ${name}`);
  }
}

function parseAgeFilter(text = '') {
  const value = text.trim().replace(/\s+/g, ' ');
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

function findNextProfileFromStore(store, user) {
  return findNextProfile(
    user,
    store.listProfiles(),
    store.data.likes,
    (profile) => store.isBoosted(profile),
  );
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

function recoverUserState(store, user) {
  if (user.profileComplete || !isProfileDataComplete(user)) {
    return user;
  }
  if (user.state === 'confirm_profile') {
    return user;
  }
  return store.updateUser(user.id, { state: 'confirm_profile' });
}

function runTests() {
  const tmpDb = path.join(os.tmpdir(), `vkbot-test-${Date.now()}.json`);
  const store = new Store(tmpDb);

  store.ensureUser('100');
  store.updateDraft('100', { gender: 'male', age: 25, city: 'Москва', name: 'Ali', about: 'x'.repeat(30), photo: 'photo100_1' });
  store.completeProfile('100');
  const male = store.getUser('100');
  assert(male.profileComplete === true, 'profile completes from draft');

  store.createMockProfile({
    gender: 'female',
    age: 23,
    city: 'Москва',
    name: 'Aisha',
    about: 'y'.repeat(30),
    photo: 'photo200_1',
  });

  assert(store.listAdminPanelUsers('female').length === 1, 'admin panel lists mock profiles');
  assert(store.listRealUsers('female').length === 0, 'real users list excludes mock profiles');

  store.createMockProfile({
    gender: 'male',
    age: 31,
    city: 'Казань',
    name: 'Rustam',
    about: 'z'.repeat(30),
    photo: 'photo400_1',
  });
  const byName = store.searchAdminPanelUsers('rustam');
  assert(byName.length === 1 && byName[0].name === 'Rustam', 'admin search by name');
  const byCity = store.searchAdminPanelUsers('казань');
  assert(byCity.some((user) => user.name === 'Rustam'), 'admin search by city');
  const byAge = store.searchAdminPanelUsers('31');
  assert(byAge.some((user) => user.age === 31), 'admin search by age');

  const match = findNextProfileFromStore(store, male);
  assert(Boolean(match), 'findNextProfile finds opposite gender in same city');

  const cityKb = keyboards.filterCity(male).toString();
  assert(cityKb.includes('filter_city_my'), 'city filter has my city button');
  assert(cityKb.includes('filter_city_all'), 'city filter has all cities button');
  assert(cityKb.includes('✅'), 'city filter marks selected option');

  store.updateUser(male.id, { filters: { ...male.filters, city: '*' } });
  const allCitiesMatch = findNextProfileFromStore(store, store.getUser(male.id));
  assert(Boolean(allCitiesMatch), 'findNextProfile with all cities includes other cities');

  store.createMockProfile({
    gender: 'female',
    age: 24,
    city: 'Москва',
    name: 'BoostedOld',
    about: 'y'.repeat(30),
    photo: 'photo201_1',
  });
  store.createMockProfile({
    gender: 'female',
    age: 25,
    city: 'Москва',
    name: 'Regular',
    about: 'y'.repeat(30),
    photo: 'photo202_1',
  });
  const boostedOld = store.listProfiles().find((user) => user.name === 'BoostedOld');
  store.updateUser(boostedOld.id, {
    boostedUntil: payments.extendUntil(null, 30),
    boostedAt: '2026-01-01T00:00:00.000Z',
  });
  store.ensureUser('200');
  store.updateUser('200', {
    gender: 'female',
    age: 26,
    city: 'Москва',
    name: 'BoostedNew',
    about: 'z'.repeat(30),
    photo: 'photo203_1',
    profileComplete: true,
    active: true,
    state: 'ready',
    boostedUntil: payments.extendUntil(null, 30),
    boostedAt: '2026-06-01T00:00:00.000Z',
  });

  const ranked = rankProfilesForBrowse(
    store.listProfiles().filter((profile) => profile.gender === 'female' && profile.city === 'Москва'),
    (profile) => store.isBoosted(profile),
  );
  assert(ranked[0].name === 'BoostedNew', 'newer boost ranks first');
  assert(ranked[1].name === 'BoostedOld', 'older boost ranks before regular profiles');
  assert(ranked.some((profile) => profile.name === 'Regular'), 'regular profile stays in list');

  const topForMale = findNextProfileFromStore(store, male);
  assert(topForMale.name === 'BoostedNew', 'browse shows freshest boosted profile first');

  assert(parseAgeFilter('18-35')?.ageFrom === 18, 'parseAgeFilter range');
  assert(parseAgeFilter('25')?.ageFrom === 25, 'parseAgeFilter single');
  assert(parseAgeFilter('abc') === null, 'parseAgeFilter invalid');

  const adminMenuMainMenu = keyboards.mainMenu(true, 'male').toString();
  const femaleMenu = keyboards.mainMenu(false, 'female').toString();
  const maleMenu = keyboards.mainMenu(false, 'male').toString();
  assert(adminMenuMainMenu.includes('admin'), 'admin menu has admin button');
  assert(femaleMenu.includes('boost_top'), 'female menu has boost top');
  assert(!femaleMenu.includes('Оплатить бот'), 'female menu hides pay button');
  assert(maleMenu.includes('boost_top'), 'male menu has boost top');
  assert(maleMenu.includes('Оплатить бот'), 'male menu keeps pay button');

  process.env.YOOKASSA_SHOP_ID = '123456';
  process.env.YOOKASSA_SECRET_KEY = 'test_secret';
  process.env.SUBSCRIPTION_AMOUNT = '1';
  process.env.BOOST_AMOUNT = '1';
  assert(payments.isPaymentConfigured(), 'yookassa config is complete');
  assert(payments.formatAmount(1) === '1.00', 'format amount');
  assert(payments.getProductAmount('subscription') === 1, 'subscription amount from env');
  assert(payments.getProductAmount('boost') === 1, 'boost amount from env');

  const payKb = keyboards.paymentUrl('Оплатить 1 ₽', 'https://yookassa.ru/checkout/test').toString();
  assert(payKb.includes('"type":"open_link"'), 'payment keyboard has open_link');
  assert(payKb.includes('yookassa.ru'), 'payment keyboard has payment url');

  const adminMenu = keyboards.admin().toString();
  assert(adminMenu.includes('admin_stats'), 'admin menu has stats');
  assert(adminMenu.includes('admin_users'), 'admin menu has users');
  assert(adminMenu.includes('admin_add'), 'admin menu has add profile');
  assert(adminMenu.includes('admin_moderator'), 'admin menu has moderator link');
  assert(adminMenu.includes('admin_channel'), 'admin menu has channel link');

  const usersMenu = keyboards.adminUsersMenu(2, 1).toString();
  assert(usersMenu.includes('admin_users_gender'), 'admin users menu has gender sections');
  assert(usersMenu.includes('admin_search'), 'admin users menu has search');

  const profileKb = keyboards.adminUserProfile('100', 'male', 0, 3, false, 'gender', true).toString();
  assert(profileKb.includes('admin_user_block'), 'admin profile has block');
  assert(profileKb.includes('admin_user_delete'), 'admin profile has delete');
  assert(profileKb.includes('admin_user_edit'), 'admin profile has edit for mock users');
  assert(profileKb.includes('admin_users_gender'), 'admin profile has pagination');

  const editKb = keyboards.adminEditProfile().toString();
  assert(editKb.includes('admin_edit_field'), 'admin edit profile keyboard');

  const adminId = '100';
  store.updateUser(adminId, { state: 'admin_add_age', draft: { adminProfile: { gender: 'female', country: '' } } });
  store.updateDraft(adminId, { adminProfile: { ...store.getUser(adminId).draft.adminProfile, age: 20 } });
  store.updateUser(adminId, { state: 'admin_add_city' });
  store.updateDraft(adminId, { adminProfile: { ...store.getUser(adminId).draft.adminProfile, city: 'Москва' } });
  store.updateUser(adminId, { state: 'admin_add_name' });
  store.updateDraft(adminId, { adminProfile: { ...store.getUser(adminId).draft.adminProfile, name: 'Anna' } });
  store.updateUser(adminId, { state: 'admin_add_about' });
  store.updateDraft(adminId, { adminProfile: { ...store.getUser(adminId).draft.adminProfile, about: 'test mock profile about text that is long enough' } });
  store.updateUser(adminId, { state: 'admin_add_photo' });
  store.createMockProfile({
    ...store.getUser(adminId).draft.adminProfile,
    photo: 'photo300_1',
  });
  store.updateUser(adminId, { state: 'ready', draft: {} });

  const stats = store.getStats();
  assert(stats.mock === 5, 'mock profiles are added and counted');
  assert(stats.total >= 2, 'total profiles tracked');

  assert(store.data.settings.channelUrl === 'https://vk.com/nikaxbot', 'default channel url');
  assert(store.data.settings.moderatorUrl === 'https://vk.com/rustambek_u', 'default moderator url');

  store.updateSettings({ moderatorUrl: 'https://vk.com/mod' });
  assert(store.data.settings.moderatorUrl === 'https://vk.com/mod', 'moderator url updated');

  store.blockUser('100');
  assert(store.getUser('100').blocked === true, 'user blocked');
  store.unblockUser('100');
  assert(store.getUser('100').blocked === false, 'user unblocked');

  store.deleteUser('100');
  assert(store.getUser('100') === null, 'user deleted');

  store.ensureUser('500');
  store.createPendingPayment({
    yookassaPaymentId: 'pay_test_1',
    userId: '500',
    product: 'subscription',
    amount: 1,
  });
  assert(!store.hasSucceededYookassaPayment('pay_test_1'), 'pending payment is not succeeded yet');
  store.completeYookassaPayment('pay_test_1');
  assert(store.hasSucceededYookassaPayment('pay_test_1'), 'payment marked as succeeded');
  store.updateUser('500', { subscribedUntil: payments.extendUntil(null, 30) });
  assert(store.isSubscribed(store.getUser('500')), 'subscription extension works');
  store.updateUser('500', { boostedUntil: payments.extendUntil(null, 30), boostedAt: new Date().toISOString() });
  assert(store.isBoosted(store.getUser('500')), 'boost extension works');

  const broken = store.ensureUser('200');
  store.updateUser('200', {
    gender: 'female',
    age: 22,
    city: 'Казань',
    name: 'Zara',
    about: 'z'.repeat(30),
    photo: 'photo200_2',
    profileComplete: false,
    state: 'ask_gender',
    draft: {},
  });
  const recovered = recoverUserState(store, store.getUser('200'));
  assert(recovered.state === 'confirm_profile', 'recover broken registration state');

  store.completeProfile('300');
  store.updateUser('300', {
    state: 'admin_add_age',
    draft: { adminProfile: { gender: 'male', country: '' } },
  });
  const adminFlow = recoverUserState(store, store.getUser('300'));
  assert(adminFlow.state === 'admin_add_age', 'recover keeps active admin add flow');
  assert(adminFlow.draft.adminProfile?.gender === 'male', 'recover keeps admin draft');

  fs.unlinkSync(tmpDb);
  console.log('All automated tests passed');
}

try {
  runTests();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
