const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { Store } = require('../src/store');
const keyboards = require('../src/keyboards');

const LOG_PATH = path.join(__dirname, '..', 'debug-a7623c.log');
const INGEST = 'http://127.0.0.1:7592/ingest/4acb8ae7-3361-4208-8d2c-4ed04750a4c9';

function debugLog(hypothesisId, location, message, data = {}) {
  const entry = {
    sessionId: 'a7623c',
    runId: 'automated-test',
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
  fetch(INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a7623c' },
    body: JSON.stringify(entry),
  }).catch(() => {});
}

function assert(condition, name) {
  if (!condition) {
    throw new Error(`FAIL: ${name}`);
  }
  debugLog('TEST', 'scripts/test-bot.js', 'assert passed', { name });
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

function findNextProfile(store, user) {
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
  store.updateDraft('100', { gender: 'male', age: 25, city: 'Москва', name: 'Ali', about: 'x'.repeat(30), photo: '' });
  store.completeProfile('100');
  const male = store.getUser('100');
  assert(male.profileComplete === true, 'profile completes from draft');

  store.createMockProfile({
    gender: 'female',
    age: 23,
    city: 'Москва',
    name: 'Aisha',
    about: 'y'.repeat(30),
  });

  const match = findNextProfile(store, male);
  assert(Boolean(match), 'findNextProfile finds opposite gender in same city');
  debugLog('H3', 'scripts/test-bot.js', 'browse match', { city: match.city, gender: match.gender });

  assert(parseAgeFilter('18-35')?.ageFrom === 18, 'parseAgeFilter range');
  assert(parseAgeFilter('25')?.ageFrom === 25, 'parseAgeFilter single');
  assert(parseAgeFilter('abc') === null, 'parseAgeFilter invalid');

  const adminMenuMainMenu = keyboards.mainMenu(true).toString();
  const userMenu = keyboards.mainMenu(false).toString();
  assert(adminMenuMainMenu.includes('admin'), 'admin menu has admin button');
  assert(!userMenu.includes('admin'), 'user menu hides admin button');

  const adminMenu = keyboards.admin().toString();
  assert(adminMenu.includes('admin_stats'), 'admin menu has stats');
  assert(adminMenu.includes('admin_users'), 'admin menu has users');
  assert(adminMenu.includes('admin_add'), 'admin menu has add profile');
  assert(adminMenu.includes('admin_moderator'), 'admin menu has moderator link');
  assert(adminMenu.includes('admin_channel'), 'admin menu has channel link');
  
  // Test admin functionality
  const adminId = '100';
  // Test adding mock profile via state machine
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
    photo: '',
  });
  store.updateUser(adminId, { state: 'ready', draft: {} });

  const stats = store.getStats();
  assert(stats.mock === 2, 'mock profiles are added and counted'); // 1 from earlier, 1 just now
  assert(stats.total >= 2, 'total profiles tracked');

  store.updateSettings({ moderatorUrl: 'https://vk.com/mod' });
  assert(store.data.settings.moderatorUrl === 'https://vk.com/mod', 'moderator url updated');
  debugLog('H4', 'scripts/test-bot.js', 'admin keyboard visibility', {
    adminHasButton: adminMenu.includes('admin'),
    userHasButton: userMenu.includes('admin'),
  });

  const broken = store.ensureUser('200');
  store.updateUser('200', {
    gender: 'female',
    age: 22,
    city: 'Казань',
    name: 'Zara',
    about: 'z'.repeat(30),
    photo: '',
    profileComplete: false,
    state: 'ask_gender',
    draft: {},
  });
  const recovered = recoverUserState(store, store.getUser('200'));
  assert(recovered.state === 'confirm_profile', 'recover broken registration state');
  debugLog('H2', 'scripts/test-bot.js', 'registration recovery', {
    beforeState: 'ask_gender',
    afterState: recovered.state,
    hasData: isProfileDataComplete(recovered),
  });

  fs.unlinkSync(tmpDb);
  debugLog('ALL', 'scripts/test-bot.js', 'all automated tests passed', { totalChecks: 8 });
  console.log('All automated tests passed');
}

try {
  if (fs.existsSync(LOG_PATH)) {
    fs.unlinkSync(LOG_PATH);
  }
  runTests();
} catch (error) {
  debugLog('FAIL', 'scripts/test-bot.js', error.message, { stack: error.stack?.split('\n').slice(0, 3) });
  console.error(error.message);
  process.exit(1);
}
