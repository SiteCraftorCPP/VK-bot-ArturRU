function compareBoostedProfiles(a, b) {
  const aBoostedAt = new Date(a.boostedAt || 0).getTime();
  const bBoostedAt = new Date(b.boostedAt || 0).getTime();
  if (aBoostedAt !== bBoostedAt) {
    return bBoostedAt - aBoostedAt;
  }
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function compareRegularProfiles(a, b) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function rankProfilesForBrowse(profiles, isBoosted) {
  return [...profiles].sort((a, b) => {
    const aBoost = isBoosted(a);
    const bBoost = isBoosted(b);

    if (aBoost !== bBoost) {
      return aBoost ? -1 : 1;
    }

    if (aBoost && bBoost) {
      return compareBoostedProfiles(a, b);
    }

    return compareRegularProfiles(a, b);
  });
}

function findNextProfile(user, profiles, likes, isBoosted) {
  const wantedGender = user.gender === 'male' ? 'female' : 'male';
  const skippedIds = new Set(
    likes
      .filter((like) => like.fromId === String(user.id))
      .map((like) => like.toId),
  );

  const matched = profiles
    .filter((profile) => profile.id !== String(user.id))
    .filter((profile) => profile.profileComplete && profile.active)
    .filter((profile) => profile.gender === wantedGender)
    .filter((profile) => !skippedIds.has(profile.id))
    .filter((profile) => {
      if (user.filters.city !== '*') {
        const cityFilter = user.city;
        if (cityFilter && profile.city.toLowerCase() !== cityFilter.toLowerCase()) {
          return false;
        }
      }

      if (user.filters.country && profile.country.toLowerCase() !== user.filters.country.toLowerCase()) {
        return false;
      }

      return profile.age >= user.filters.ageFrom && profile.age <= user.filters.ageTo;
    });

  return rankProfilesForBrowse(matched, isBoosted)[0] || null;
}

module.exports = {
  compareBoostedProfiles,
  findNextProfile,
  rankProfilesForBrowse,
};
