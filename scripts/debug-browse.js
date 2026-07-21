const { Store } = require('../src/store');
const { findNextProfile } = require('../src/browse');

const store = new Store();
const ids = process.argv.slice(2);

const targets = ids.length
  ? ids
  : Object.keys(store.data.users).filter((id) => store.getUser(id)?.profileComplete);

for (const id of targets) {
  const user = store.getUser(id);
  if (!user?.profileComplete) {
    continue;
  }
  const profile = findNextProfile(
    user,
    store.listProfiles(),
    store.data.likes,
    (item) => store.isBoosted(item),
  );
  console.log(JSON.stringify({
    id,
    name: user.name,
    gender: user.gender,
    city: user.city,
    filters: user.filters,
    match: profile ? { id: profile.id, name: profile.name, age: profile.age, city: profile.city } : null,
  }));
}
